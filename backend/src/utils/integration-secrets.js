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
// (CUSTOM_HEADERS auth).
const AUTH_CONFIG_FIELDS = new Set(['outgoingauthconfig', 'inboundauthconfig']);

// Plain custom headers are mostly templates ({{partnerId}}); only these carry secrets.
const SECRET_HEADER = /authorization|api[-_]?key|token|secret|password/i;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

const hasValue = (value) => value !== undefined && value !== null && value !== '';

function isSecretField(key, parentKey, grandparentKey) {
  if (SECRET_FIELDS.has(String(key).toLowerCase())) return true;
  if (String(parentKey).toLowerCase() === 'headers' && AUTH_CONFIG_FIELDS.has(String(grandparentKey).toLowerCase())) {
    return true;
  }
  return String(parentKey).toLowerCase() === 'customheaders' && SECRET_HEADER.test(String(key));
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
  return mapSecretFields(doc, maskValue);
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
      : containsSecretMask(child, key, parentKey)
  );
}

module.exports = {
  SECRET_MASK,
  maskIntegrationSecrets,
  restoreMaskedSecrets,
  containsSecretMask,
  isSecretField,
  mapSecretFields,
  isPlainObject,
};
