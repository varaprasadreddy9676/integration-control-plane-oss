'use strict';

/**
 * Integration configs keep their credentials inline (auth configs, HMAC
 * secrets, SMTP passwords). API responses carry SECRET_MASK in their place;
 * a save that sends SECRET_MASK back keeps the stored value. Deliveries read
 * the stored document directly and never see the mask.
 */

const SECRET_MASK = '********';

// Exact field names (case-insensitive) that hold credentials. Deliberately not
// substring matching: tokenEndpoint, outgoingAuthType, tokenHeaderName and
// _tokenExpiresAt are settings the edit forms need to show.
const SECRET_FIELDS = new Set(
  [
    'password',
    'secret',
    'secrets',
    'apiKey',
    'api_key',
    'token',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'authToken',
    'clientSecret',
    'client_secret',
    'consumerSecret',
    'tokenSecret',
    'privateKey',
    'private_key',
    'tokenRequestBody',
    '_cachedToken',
    '_tokenRefreshToken',
  ].map((field) => field.toLowerCase())
);

// Inside an auth config, every value under `headers` is a credential
// (CUSTOM_HEADERS auth). `authConfig` is the name templates and some API
// responses use for the outgoing auth config.
const AUTH_CONFIG_FIELDS = new Set(['outgoingauthconfig', 'inboundauthconfig', 'authconfig']);

// Plain headers are mostly templates ({{partnerId}}); only these carry secrets.
const SECRET_HEADER = /auth|api[-_]?key|(^|[-_])key$|token|secret|passw|signature|cookie|session/i;
// Objects of header name -> value: custom headers, a data source's headers, logged request headers.
const HEADER_FIELDS = new Set(['customheaders', 'headers', 'requestheaders']);
const isSecretHeader = (key, parentKey) =>
  HEADER_FIELDS.has(String(parentKey).toLowerCase()) && SECRET_HEADER.test(String(key));

// Fields holding a URL that can carry a credential (a webhook token in the path,
// ?api_key=, user:password@). Only those parts are masked, so the URL stays readable.
const URL_FIELDS = new Set(['targeturl', 'url', 'connectionstring', 'requesturl']);
const SECRET_QUERY_PARAM =
  /^(api[-_]?key|apikey|key|token|access[-_]?token|auth|authorization|secret|client[-_]?secret|password|pass|pwd|sig|signature|code)$/i;
// Webhook services whose URL path itself is the credential: [prefix, secret segment(s)].
const SECRET_PATH_URLS = [
  /^(https:\/\/hooks\.slack\.com\/services\/[^/?#]+\/[^/?#]+\/)([^/?#]+)/i,
  /^(https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/)([^/?#]+)/i,
  /^(https:\/\/[^/?#]+\.webhook\.office\.com\/webhookb2\/[^/?#]+\/IncomingWebhook\/)([^/?#]+)\/([^/?#]+)/i,
];

const isUrlField = (key) => URL_FIELDS.has(String(key).toLowerCase());

/**
 * Split a URL into its masked form and the secret parts that were masked, in
 * the order they appear. A URL without secrets comes back unchanged.
 */
function splitUrlSecrets(url) {
  if (typeof url !== 'string' || !url) return { masked: url, secrets: [] };
  const secrets = [];
  let masked = url;

  // user:password@ (also database connection strings)
  masked = masked.replace(/^([a-z][a-z0-9+.-]*:\/\/[^:@/?#\s]+:)([^@/?#\s]+)(@)/i, (_, head, password, at) => {
    secrets.push(password);
    return `${head}${SECRET_MASK}${at}`;
  });

  for (const pattern of SECRET_PATH_URLS) {
    const match = masked.match(pattern);
    if (!match) continue;
    const [whole, prefix, ...parts] = match;
    secrets.push(...parts);
    masked = `${prefix}${parts.map(() => SECRET_MASK).join('/')}${masked.slice(whole.length)}`;
    break;
  }

  const queryStart = masked.indexOf('?');
  if (queryStart !== -1) {
    const hashStart = masked.indexOf('#', queryStart);
    const end = hashStart === -1 ? masked.length : hashStart;
    const query = masked
      .slice(queryStart + 1, end)
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq <= 0) return pair;
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        if (!value || value === SECRET_MASK || !SECRET_QUERY_PARAM.test(name)) return pair;
        secrets.push(value);
        return `${name}=${SECRET_MASK}`;
      })
      .join('&');
    masked = `${masked.slice(0, queryStart + 1)}${query}${masked.slice(end)}`;
  }

  return { masked, secrets };
}

/** The URL with any embedded credential replaced by SECRET_MASK. */
const maskUrlSecrets = (url) => splitUrlSecrets(url).masked;

/**
 * A URL sent back from the console: each mask is replaced, in order, by the
 * secret stored at the same place. A URL whose masks do not line up with the
 * stored secrets is returned as is (containsSecretMask then flags it).
 */
function restoreUrl(incoming, stored) {
  if (typeof incoming !== 'string' || !incoming.includes(SECRET_MASK)) return incoming;
  const { secrets } = splitUrlSecrets(typeof stored === 'string' ? stored : '');
  const maskCount = incoming.split(SECRET_MASK).length - 1;
  if (maskCount !== secrets.length) return incoming;
  let index = 0;
  return incoming.split(SECRET_MASK).reduce((out, piece, i) => (i === 0 ? piece : out + secrets[index++] + piece), '');
}

/** Copy of `value` with every URL field passed through `transform`. */
function mapUrlFields(value, transform) {
  if (Array.isArray(value)) return value.map((item) => mapUrlFields(item, transform));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isUrlField(key) && typeof child === 'string' ? transform(child) : mapUrlFields(child, transform);
  }
  return out;
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

const hasValue = (value) => value !== undefined && value !== null && value !== '';

// Older API_KEY auth configs keep the key under a generic name.
const AUTH_CONFIG_VALUE_FIELDS = new Set(['value', 'key']);

function isSecretField(key, parentKey, grandparentKey) {
  if (SECRET_FIELDS.has(String(key).toLowerCase())) return true;
  if (AUTH_CONFIG_FIELDS.has(String(parentKey).toLowerCase()) && AUTH_CONFIG_VALUE_FIELDS.has(String(key).toLowerCase())) {
    return true;
  }
  if (String(parentKey).toLowerCase() === 'headers' && AUTH_CONFIG_FIELDS.has(String(grandparentKey).toLowerCase())) {
    return true;
  }
  return isSecretHeader(key, parentKey);
}

function maskValue(value) {
  if (Array.isArray(value)) return value.map((item) => (hasValue(item) ? SECRET_MASK : item));
  return hasValue(value) ? SECRET_MASK : value;
}

/**
 * Copy of `value` with `transform` applied to the value of every secret field.
 * `parentKey`/`grandparentKey` give the context for a value that sits below
 * the top level (e.g. the object stored at a dotted update path).
 */
function mapSecretFields(value, transform, parentKey = '', grandparentKey = '') {
  if (Array.isArray(value)) return value.map((item) => mapSecretFields(item, transform, parentKey, grandparentKey));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isSecretField(key, parentKey, grandparentKey)
      ? transform(child)
      : mapSecretFields(child, transform, key, parentKey);
  }
  return out;
}

/** Copy of `doc` with every credential replaced by SECRET_MASK. */
function maskIntegrationSecrets(doc) {
  return mapUrlFields(mapSecretFields(doc, maskValue), maskUrlSecrets);
}

function restoreValue(incoming, stored) {
  if (Array.isArray(incoming)) {
    const storedList = Array.isArray(stored) ? stored : [];
    return incoming
      .map((item, index) => (item === SECRET_MASK ? storedList[index] : item))
      .filter((item) => item !== undefined);
  }
  return incoming === SECRET_MASK ? stored : incoming;
}

function walkRestore(incoming, stored, parentKey, grandparentKey) {
  if (Array.isArray(incoming)) {
    const storedList = Array.isArray(stored) ? stored : [];
    return incoming.map((item, index) => walkRestore(item, storedList[index], parentKey, grandparentKey));
  }
  if (!isPlainObject(incoming)) return incoming;
  const storedObject = isPlainObject(stored) ? stored : {};
  const out = {};
  for (const [key, child] of Object.entries(incoming)) {
    const next = isSecretField(key, parentKey, grandparentKey)
      ? restoreValue(child, storedObject[key])
      : isUrlField(key) && typeof child === 'string'
        ? restoreUrl(child, storedObject[key])
        : walkRestore(child, storedObject[key], key, parentKey);
    // Never persist the mask itself as a credential.
    if (next !== undefined) out[key] = next;
  }
  return out;
}

/**
 * Copy of `incoming` where each SECRET_MASK is replaced by the value stored at
 * the same place in `stored`. A mask with nothing stored behind it is dropped.
 */
function restoreMaskedSecrets(incoming, stored) {
  return walkRestore(incoming, stored, '', '');
}

/**
 * True if any secret field anywhere in `value` still holds the literal mask
 * (or an array of secrets containing it). Used after restoreMaskedSecrets to
 * tell whether a masked value had nothing to restore from — e.g. an imported
 * integration with no matching stored one — so the caller can flag it.
 */
function containsSecretMask(value, parentKey = '', grandparentKey = '') {
  if (Array.isArray(value)) return value.some((item) => containsSecretMask(item, parentKey, grandparentKey));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    isSecretField(key, parentKey, grandparentKey)
      ? Array.isArray(child)
        ? child.includes(SECRET_MASK)
        : child === SECRET_MASK
      : isUrlField(key) && typeof child === 'string'
        ? child.includes(SECRET_MASK)
        : containsSecretMask(child, key, parentKey)
  );
}

/**
 * Copy of a log entry (delivery, scheduled run, system log) with the
 * credentials in its URL fields and request headers masked. Payloads and
 * response bodies are left as they are.
 */
function maskLogSecrets(value, parentKey = '') {
  if (Array.isArray(value)) return value.map((item) => maskLogSecrets(item, parentKey));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] =
      isUrlField(key) && typeof child === 'string'
        ? maskUrlSecrets(child)
        : String(key).toLowerCase() === 'curlcommand' && typeof child === 'string'
          ? child.replace(/https?:\/\/[^\s"']+/g, maskUrlSecrets)
          : isSecretHeader(key, parentKey)
          ? maskValue(child)
          : maskLogSecrets(child, key);
  }
  return out;
}

module.exports = {
  SECRET_MASK,
  maskUrlSecrets,
  maskLogSecrets,
  maskIntegrationSecrets,
  restoreMaskedSecrets,
  containsSecretMask,
  isSecretField,
  mapSecretFields,
  isPlainObject,
};
