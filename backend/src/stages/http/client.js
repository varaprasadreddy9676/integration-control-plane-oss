'use strict';

/**
 * The HTTP client every stage call goes through.
 *
 * - The destination policy is applied to the URL and to every address the name
 *   resolves to, and the connection is made to the address that was checked (the
 *   name is resolved once per hop), so DNS rebinding cannot switch it.
 * - Redirects are followed by hand so each hop gets the same checks. Credentials
 *   are added only for approved origins, and auth headers are dropped when a
 *   redirect leaves the origin they were set for.
 * - The response body is read up to a byte cap; the rest is not read.
 * - One deadline covers the whole call, redirects included, and a caller's
 *   signal can cancel it.
 *
 * Works on Node 14 (no fetch, no global AbortController needed).
 */

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { checkUrl, isBlockedAddress } = require('./destination-policy');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const AUTH_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

class StageHttpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StageHttpError';
    this.code = code;
  }
}

const systemResolve = (hostname) =>
  new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses.map((entry) => entry.address));
    });
  });

const lowerKeys = (headers) =>
  Object.fromEntries(Object.entries(headers || {}).map(([name, value]) => [name.toLowerCase(), String(value)]));

const isPrivateAllowed = (policy, hostname) =>
  Boolean(policy.allowPrivate) || (policy.allowHosts || []).map((h) => h.toLowerCase()).includes(hostname.toLowerCase());

/** Check a hop and find the address to connect to. */
async function resolveHop(url, policy, resolve) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const privateOk = isPrivateAllowed(policy, hostname);
  const checked = checkUrl(url.href, { allowPrivate: privateOk });
  if (!checked.ok) throw new StageHttpError('DESTINATION_BLOCKED', checked.reason);

  if (net.isIP(hostname)) return hostname;
  let addresses;
  try {
    addresses = await resolve(hostname);
  } catch (error) {
    throw new StageHttpError('DNS', `Could not resolve ${hostname}: ${error.message}`);
  }
  if (!addresses || addresses.length === 0) throw new StageHttpError('DNS', `No address for ${hostname}`);
  if (!privateOk && addresses.some((address) => isBlockedAddress(address))) {
    throw new StageHttpError('DESTINATION_BLOCKED', `Destination not allowed: ${hostname} resolves to a private or reserved address`);
  }
  return addresses[0];
}

/** One HTTP exchange to a pinned address. Resolves to { status, headers, body, bodyTruncated }. */
function exchange({ url, address, method, headers, body, maxResponseBytes, responseType, signalState }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const family = net.isIP(address);
    const pinnedLookup = (_hostname, options, callback) => {
      if (options && options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    };
    const req = transport.request({
      method,
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers,
      lookup: pinnedLookup,
      agent: false,
    });
    signalState.current = req;

    req.on('response', (res) => {
      const chunks = [];
      let received = 0;
      let truncated = false;
      res.on('data', (chunk) => {
        if (truncated) return;
        const room = maxResponseBytes - received;
        if (chunk.length > room) {
          chunks.push(chunk.slice(0, room));
          received += room;
          truncated = true;
          res.destroy(); // stop reading the rest
          finish();
          return;
        }
        chunks.push(chunk);
        received += chunk.length;
      });
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(responseType === 'base64' ? 'base64' : 'utf8'),
          bodyTruncated: truncated,
        });
      };
      res.on('end', finish);
      res.on('error', (error) => (truncated ? finish() : reject(error)));
    });
    req.on('error', reject);
    if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') req.write(body);
    req.end();
  });
}

/**
 * Make a stage HTTP call. Options: method, url, headers, body, timeoutMs,
 * maxResponseBytes, responseType ('text' or 'base64'), maxRedirects,
 * credential { origins: [origin], headers },
 * policy { allowPrivate, allowHosts }, signal (AbortSignal-like), resolve (tests).
 * Resolves to { status, headers, body, bodyTruncated, redirects, finalUrl, durationMs };
 * rejects with StageHttpError (DESTINATION_BLOCKED, TIMEOUT, ABORTED,
 * TOO_MANY_REDIRECTS, DNS and CONNECTION_REFUSED (nothing was sent), NETWORK).
 */
async function request({
  method = 'GET',
  url,
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  responseType = 'text',
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  credential = null,
  policy = {},
  signal = null,
  resolve = systemResolve,
} = {}) {
  const startedAt = Date.now();
  const signalState = { current: null, reason: null };
  const stop = (code, message) => {
    if (signalState.reason) return;
    signalState.reason = new StageHttpError(code, message);
    if (signalState.current) signalState.current.destroy(signalState.reason);
  };
  const timer = setTimeout(() => stop('TIMEOUT', `No complete response within ${timeoutMs} ms`), timeoutMs);
  const onAbort = () => stop('ABORTED', 'The call was cancelled');
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
  }

  const approvedOrigins = new Set(((credential && credential.origins) || []).map((origin) => new URL(origin).origin));
  let currentUrl;
  try {
    currentUrl = new URL(String(url));
  } catch (_error) {
    clearTimeout(timer);
    throw new StageHttpError('DESTINATION_BLOCKED', 'Not a valid URL');
  }
  let currentMethod = String(method).toUpperCase();
  let currentBody = body;
  let currentHeaders = lowerKeys(headers);
  const startOrigin = currentUrl.origin;
  const redirects = [];

  try {
    for (;;) {
      if (signalState.reason) throw signalState.reason;
      const address = await resolveHop(currentUrl, policy, resolve);
      if (signalState.reason) throw signalState.reason;

      const hopHeaders = { ...currentHeaders, host: currentUrl.host };
      if (credential && approvedOrigins.has(currentUrl.origin)) Object.assign(hopHeaders, lowerKeys(credential.headers));
      if (currentBody !== undefined && currentBody !== null && !hopHeaders['content-length']) {
        hopHeaders['content-length'] = String(Buffer.byteLength(String(currentBody)));
      }

      let response;
      try {
        response = await exchange({
          url: currentUrl,
          address,
          method: currentMethod,
          headers: hopHeaders,
          body: currentBody,
          maxResponseBytes,
          responseType,
          signalState,
        });
      } catch (error) {
        if (signalState.reason) throw signalState.reason;
        // Refused: the connection never opened, so nothing was sent.
        throw new StageHttpError(error.code === 'ECONNREFUSED' ? 'CONNECTION_REFUSED' : 'NETWORK', error.message);
      }

      const location = response.headers.location;
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        return { ...response, redirects, finalUrl: currentUrl.href, durationMs: Date.now() - startedAt };
      }
      if (redirects.length >= maxRedirects) {
        throw new StageHttpError('TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects`);
      }
      const next = new URL(location, currentUrl);
      redirects.push({ status: response.status, url: next.href });
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET';
        currentBody = undefined;
        delete currentHeaders['content-length'];
        delete currentHeaders['content-type'];
      }
      if (next.origin !== startOrigin) {
        // Leaving the origin the caller set headers for: never carry auth along.
        currentHeaders = Object.fromEntries(Object.entries(currentHeaders).filter(([name]) => !AUTH_HEADERS.has(name)));
      }
      currentUrl = next;
    }
  } finally {
    clearTimeout(timer);
    if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort);
  }
}

module.exports = { request, StageHttpError };
