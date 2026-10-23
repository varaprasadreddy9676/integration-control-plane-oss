'use strict';

/**
 * The recorder: the one path every stage HTTP call takes. It makes the call
 * through the stage HTTP client (destination policy, pinned DNS, checked
 * redirects, credentials only for approved origins, byte caps, deadline,
 * cancellation), keeps a record of it, and at the end of the run produces the
 * record the run stores: masked (mask.js), then capped. Nothing unmasked leaves
 * the recorder.
 *
 * Recording levels:
 *   full         every call with headers and bodies
 *   errors-only  bodies and headers only for failed calls, or when the run failed
 *   summary      method, URL, status and timing; no bodies, headers or logs
 */

const client = require('./http/client');
const { createMasker } = require('./mask');

const DEFAULT_LIMITS = {
  maxCalls: 25, // calls one run may make
  maxRecordedCalls: 20, // calls kept in the record; the rest are counted
  maxBodyChars: 16000, // per recorded body
  maxResultChars: 8000,
  maxErrorChars: 2000,
  maxLogs: 100,
  maxLogChars: 2000,
  maxRequestBytes: 256 * 1024,
  maxResponseBytes: 1024 * 1024,
  maxBinaryBytes: 10 * 1024 * 1024, // http.getBuffer (documents, images)
  callTimeoutMs: 15000,
};

const LEVELS = new Set(['full', 'errors-only', 'summary']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Errors raised before anything was sent.
const CERTAINLY_NOT_SENT = new Set(['DESTINATION_BLOCKED', 'DNS', 'CONNECTION_REFUSED', 'TOO_MANY_CALLS', 'REQUEST_TOO_LARGE', 'RATE_LIMITED', 'QUOTA_EXCEEDED']);

class StageCallError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const LIMIT_CODES = new Set(['RATE_LIMITED', 'QUOTA_EXCEEDED']);
const MAX_RETRY_AFTER_MS = 24 * 3600 * 1000;

/** Retry-After as seconds or an HTTP date, in ms (capped at a day); 0 when absent or invalid. */
function parseRetryAfter(value) {
  if (value === undefined || value === null) return 0;
  const text = Array.isArray(value) ? value[0] : String(value);
  const seconds = Number(text);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(text).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : 0;
}

const hasHeader = (headers, name) => Object.keys(headers).some((key) => key.toLowerCase() === name);

function withParams(url, params) {
  if (!params || typeof params !== 'object') return String(url);
  const target = new URL(String(url));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) target.searchParams.append(key, String(value));
  }
  return target.href;
}

function parseBody(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return text;
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return text;
  }
}

/** A body cut to `max` characters when stored, as { body, cut }. */
function capBody(body, max) {
  if (body === undefined || body === null) return { body };
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > max ? { body: text.slice(0, max), cut: 'recording' } : { body };
}

/**
 * `credential`: { origins: [origin], headers: { name: value } }, resolved by the
 * caller; added only to calls whose origin is approved, and never recorded.
 * `deadline`: epoch ms the whole run must finish by; calls get what is left.
 * `admit({ url, method })`: our own limits (per-host rate, org quota), checked
 * before each call; it throws RATE_LIMITED or QUOTA_EXCEEDED (with retryAfterMs).
 */
function createRecorder({
  level = 'full',
  sensitivePaths = [],
  sensitiveKeys = [],
  credential = null,
  policy = {},
  request = client.request,
  limits = {},
  deadline = null,
  admit = null,
} = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const recording = LEVELS.has(level) ? level : 'full';
  const credentialHeaders = (credential && credential.headers) || {};
  const approvedOrigins = new Set(((credential && credential.origins) || []).map((origin) => new URL(origin).origin));
  const masker = createMasker({ sensitivePaths, sensitiveKeys, secrets: Object.values(credentialHeaders) });
  const calls = [];
  let callCount = 0;

  /**
   * The sandbox's http helper: args are { method, url, body, options: { headers,
   * params, timeout }, responseType }. With responseType 'base64' (http.getBuffer)
   * the answer is { status, base64, contentType }; otherwise { status, headers, data }.
   */
  async function http({ method = 'GET', url, body, options = {}, responseType } = {}, { signal } = {}) {
    const binary = responseType === 'base64';
    callCount += 1;
    if (callCount > lim.maxCalls) {
      throw new StageCallError('TOO_MANY_CALLS', `A stage may make at most ${lim.maxCalls} HTTP calls`);
    }
    const verb = String(method).toUpperCase();
    let target;
    try {
      target = withParams(url, options.params);
    } catch (_error) {
      throw new StageCallError('DESTINATION_BLOCKED', 'Not a valid URL');
    }
    const headers = { ...(options.headers || {}) };
    let payload = body;
    if (payload !== undefined && payload !== null && typeof payload !== 'string') {
      payload = JSON.stringify(payload);
      if (!hasHeader(headers, 'content-type')) headers['content-type'] = 'application/json';
    }
    if (typeof payload === 'string' && Buffer.byteLength(payload) > lim.maxRequestBytes) {
      throw new StageCallError('REQUEST_TOO_LARGE', `The request body is larger than ${lim.maxRequestBytes} bytes`);
    }
    const remaining = deadline ? deadline - Date.now() : lim.callTimeoutMs;
    if (remaining <= 0) throw new StageCallError('TIMEOUT', 'No time left in this stage for another call');
    const timeoutMs = Math.max(1, Math.min(Number(options.timeout) || lim.callTimeoutMs, lim.callTimeoutMs, remaining));

    let credentialApplied = false;
    try {
      credentialApplied = approvedOrigins.has(new URL(target).origin);
    } catch (_error) {
      credentialApplied = false;
    }
    const entry = {
      id: callCount,
      at: new Date().toISOString(),
      method: verb,
      url: target,
      requestHeaders: credentialApplied ? { ...headers, ...credentialHeaders } : headers,
      requestBody: payload,
    };
    calls.push(entry);
    const startedAt = Date.now();
    try {
      if (admit) await admit({ url: target, method: verb });
      const response = await request({
        method: verb,
        url: target,
        headers,
        body: payload,
        timeoutMs,
        maxResponseBytes: binary ? lim.maxBinaryBytes : lim.maxResponseBytes,
        responseType: binary ? 'base64' : 'text',
        credential,
        policy,
        signal,
      });
      const contentType = (response.headers && response.headers['content-type']) || 'application/octet-stream';
      Object.assign(entry, {
        statusCode: response.status,
        responseHeaders: response.headers,
        // Binary bodies are not stored, only described.
        responseBody: binary ? `[binary ${contentType}, ${Math.floor((response.body.length * 3) / 4)} bytes]` : response.body,
        responseBodyCut: response.bodyTruncated ? 'network' : undefined,
        redirects: response.redirects && response.redirects.length ? response.redirects : undefined,
        finalUrl: response.finalUrl !== target ? response.finalUrl : undefined,
        durationMs: response.durationMs,
      });
      if (binary) return { status: response.status, base64: response.body, contentType };
      return {
        status: response.status,
        headers: response.headers,
        data: parseBody(response.body),
        bodyTruncated: Boolean(response.bodyTruncated),
        finalUrl: response.finalUrl,
      };
    } catch (error) {
      entry.error = { code: error.code || 'NETWORK', message: String(error.message || error) };
      if (error.retryAfterMs) entry.error.retryAfterMs = error.retryAfterMs;
      entry.durationMs = Date.now() - startedAt;
      throw error;
    }
  }

  function recordCall(entry, keepDetail) {
    const out = {
      id: entry.id,
      at: entry.at,
      method: entry.method,
      url: masker.maskUrl(entry.url),
      statusCode: entry.statusCode,
      durationMs: entry.durationMs,
      error: entry.error,
      finalUrl: entry.finalUrl ? masker.maskUrl(entry.finalUrl) : undefined,
      redirects: entry.redirects ? entry.redirects.map((hop) => ({ ...hop, url: masker.maskUrl(hop.url) })) : undefined,
    };
    // Mask headers and bodies even when they are not kept: that is how the
    // secrets in them become known, so they are scrubbed everywhere else.
    const requestHeaders = masker.maskHeaders(entry.requestHeaders);
    const responseHeaders = entry.responseHeaders ? masker.maskHeaders(entry.responseHeaders) : undefined;
    const requestBody = entry.requestBody === undefined ? undefined : masker.maskJson(parseBody(entry.requestBody));
    const responseBody = entry.responseBody === undefined ? undefined : masker.maskJson(parseBody(entry.responseBody));
    if (!keepDetail) return { ...out, bodiesOmitted: recording };
    return { ...out, requestHeaders, requestBody, responseHeaders, responseBody, responseBodyCut: entry.responseBodyCut };
  }

  /**
   * The masked, capped record of the run: { calls, callsOmitted, logs,
   * logsOmitted, result, error }. `outcome` decides what errors-only keeps.
   */
  function finish({ outcome, result, error, logs = [] } = {}) {
    const runFailed = outcome === 'error' || outcome === 'timeout';
    const kept = calls.slice(0, lim.maxRecordedCalls).map((entry) => {
      const callFailed = Boolean(entry.error) || (entry.statusCode !== undefined && entry.statusCode >= 400);
      const keepDetail = recording === 'full' || (recording === 'errors-only' && (runFailed || callFailed));
      return recordCall(entry, keepDetail);
    });
    const maskedResult = result === undefined ? undefined : masker.maskJson(result);
    const keptLogs = recording === 'summary' ? [] : logs.slice(0, lim.maxLogs);

    const scrubbed = masker.scrub({ calls: kept, logs: keptLogs, result: maskedResult, error: error || undefined });

    const record = {
      calls: scrubbed.calls.map((call) => {
        if (call.bodiesOmitted) return call;
        const request = capBody(call.requestBody, lim.maxBodyChars);
        const response = capBody(call.responseBody, lim.maxBodyChars);
        return {
          ...call,
          requestBody: request.body,
          requestBodyCut: request.cut,
          responseBody: response.body,
          responseBodyCut: call.responseBodyCut || response.cut,
        };
      }),
      callsOmitted: Math.max(0, calls.length - lim.maxRecordedCalls),
      logs: scrubbed.logs.map((entry) => ({ ...entry, message: String(entry.message).slice(0, lim.maxLogChars) })),
      logsOmitted: recording === 'summary' ? logs.length : Math.max(0, logs.length - lim.maxLogs),
    };
    if (scrubbed.result !== undefined) {
      const text = JSON.stringify(scrubbed.result);
      record.result = text && text.length > lim.maxResultChars ? { truncated: true, preview: text.slice(0, lim.maxResultChars) } : scrubbed.result;
    }
    if (scrubbed.error) record.error = String(scrubbed.error).slice(0, lim.maxErrorChars);
    return record;
  }

  /**
   * Did a call that may change something remotely end without an answer? (A
   * timeout, a cancellation or a dropped connection after sending.) Retrying such
   * a stage could repeat the change, so it is not retried automatically unless
   * the stage allows uncertain side effects.
   */
  function uncertain() {
    return calls.some((entry) => {
      if (SAFE_METHODS.has(entry.method) || entry.statusCode !== undefined) return false;
      if (!entry.error) return true; // still in flight when the run ended
      return !CERTAINLY_NOT_SENT.has(entry.error.code);
    });
  }

  /**
   * How long the provider (Retry-After on a 429 or 503) or our own limits asked
   * to wait, in ms; 0 when nobody asked. `limited` is true when one of our limits
   * (per-host rate, org quota) stopped a call, so the run says nothing about the
   * stage itself.
   */
  function backoff() {
    let retryAfterMs = 0;
    let limited = false;
    for (const entry of calls) {
      if (entry.error && LIMIT_CODES.has(entry.error.code)) {
        limited = true;
        retryAfterMs = Math.max(retryAfterMs, entry.error.retryAfterMs || 0);
      }
      if ((entry.statusCode === 429 || entry.statusCode === 503) && entry.responseHeaders) {
        retryAfterMs = Math.max(retryAfterMs, parseRetryAfter(entry.responseHeaders['retry-after']));
      }
    }
    return { retryAfterMs, limited };
  }

  return {
    http,
    finish,
    uncertain,
    backoff,
    /** Treat a value as secret in this run's record (a sensitive output, for example). */
    addSecret: masker.addSecret,
    /** Mask and scrub any other value with what this run knows to be secret. */
    mask: (value) => masker.scrub(masker.maskJson(value)),
    get callCount() {
      return callCount;
    },
  };
}

module.exports = { createRecorder, StageCallError, DEFAULT_LIMITS };
