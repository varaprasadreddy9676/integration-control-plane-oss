'use strict';

/**
 * Masking for everything a stage records, applied before anything is stored or
 * shown. A value is secret when it is:
 *   - a credential the parent resolved for the stage (passed in),
 *   - under a header whose name looks like a credential,
 *   - under a JSON key that names a credential (access_token, password...),
 *   - at one of the stage's declared sensitive paths, or under one of its
 *     declared sensitive key names at any depth (personal data such as a
 *     recipient's phone number),
 *   - a credential embedded in a URL (user:password@, ?api_key=...).
 * Those places are replaced with REDACTED, and every secret value found is also
 * scrubbed from every string of the record (logs, errors, raw bodies, URLs, the
 * result), so a token copied into a log line or an error does not survive.
 *
 * Nothing here mutates its input.
 */

const REDACTED = '[REDACTED]';

// Credentials can be short (a PIN-like API key); values found by key or path must
// be long enough that scrubbing them elsewhere does not mangle ordinary text.
const MIN_CREDENTIAL_LENGTH = 4;
const MIN_FOUND_LENGTH = 6;

const SECRET_HEADER = /auth|api[-_]?key|(^|[-_])key$|token|secret|passw|signature|cookie|session/i;
const SECRET_KEY =
  /^(access[-_]?token|refresh[-_]?token|id[-_]?token|token|auth[-_]?token|bearer|password|passwd|pwd|secret|client[-_]?secret|api[-_]?key|apikey|private[-_]?key|authorization|session[-_]?id|otp)$/i;
const SECRET_QUERY_PARAM =
  /^(api[-_]?key|apikey|key|token|access[-_]?token|auth|authorization|secret|client[-_]?secret|password|pass|pwd|sig|signature|code)$/i;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** "data[*].phone", "$.data.0.phone", "message.payload.to" -> ['data', '*', 'phone'] */
function parsePath(path) {
  return String(path)
    .replace(/^\$\.?/, '')
    .replace(/\[(\*|\d+)\]/g, '.$1')
    .replace(/\[["']([^"']+)["']\]/g, '.$1')
    .split('.')
    .filter((segment) => segment !== '');
}

function remember(secrets, value, minLength) {
  if (value === null || value === undefined || typeof value === 'object') return;
  const text = String(value);
  if (text.length >= minLength && text !== REDACTED) secrets.add(text);
}

function maskAtPath(value, segments, secrets) {
  if (segments.length === 0) {
    if (value === undefined) return value;
    collectLeaves(value, secrets);
    return REDACTED;
  }
  const [head, ...rest] = segments;
  if (Array.isArray(value)) {
    if (head === '*') return value.map((item) => maskAtPath(item, rest, secrets));
    const index = Number(head);
    if (!Number.isInteger(index) || index < 0 || index >= value.length) return value;
    return value.map((item, i) => (i === index ? maskAtPath(item, rest, secrets) : item));
  }
  if (isPlainObject(value)) {
    const keys = head === '*' ? Object.keys(value) : Object.prototype.hasOwnProperty.call(value, head) ? [head] : [];
    if (keys.length === 0) return value;
    const out = { ...value };
    for (const key of keys) out[key] = maskAtPath(value[key], rest, secrets);
    return out;
  }
  return value;
}

function collectLeaves(value, secrets) {
  if (Array.isArray(value)) value.forEach((item) => collectLeaves(item, secrets));
  else if (isPlainObject(value)) Object.values(value).forEach((item) => collectLeaves(item, secrets));
  else remember(secrets, value, MIN_FOUND_LENGTH);
}

function maskSecretKeys(value, secrets, extraKeys) {
  if (Array.isArray(value)) return value.map((item) => maskSecretKeys(item, secrets, extraKeys));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const named = SECRET_KEY.test(key) || extraKeys.has(key.toLowerCase());
    if (named && child !== null && child !== undefined && typeof child !== 'object') {
      remember(secrets, child, MIN_FOUND_LENGTH);
      out[key] = REDACTED;
    } else if (named && child !== null && typeof child === 'object') {
      collectLeaves(child, secrets);
      out[key] = REDACTED;
    } else {
      out[key] = maskSecretKeys(child, secrets, extraKeys);
    }
  }
  return out;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A masker for one stage run. `sensitivePaths` and `sensitiveKeys` are the
 * stage's declarations (applied to every JSON document recorded: bodies and the
 * result); `secrets` are the resolved credential values.
 */
function createMasker({ sensitivePaths = [], sensitiveKeys = [], secrets = [] } = {}) {
  const found = new Set();
  const extraKeys = new Set(sensitiveKeys.map((key) => String(key).toLowerCase()));
  const paths = sensitivePaths.map(parsePath).filter((segments) => segments.length > 0);
  for (const value of secrets) remember(found, value, MIN_CREDENTIAL_LENGTH);

  /** A JSON document with credential keys and sensitive paths masked. */
  function maskJson(doc) {
    let out = maskSecretKeys(doc, found, extraKeys);
    for (const segments of paths) out = maskAtPath(out, segments, found);
    return out;
  }

  /** Header values masked when the name looks like a credential. */
  function maskHeaders(headers) {
    const out = {};
    for (const [name, value] of Object.entries(headers || {})) {
      if (SECRET_HEADER.test(name)) {
        const text = Array.isArray(value) ? value.join(', ') : String(value);
        remember(found, text, MIN_CREDENTIAL_LENGTH);
        // "Bearer abc" also hides "abc" wherever it is copied on its own.
        const parts = text.split(/\s+/);
        if (parts.length === 2) remember(found, parts[1], MIN_CREDENTIAL_LENGTH);
        out[name] = REDACTED;
      } else {
        out[name] = value;
      }
    }
    return out;
  }

  /** The URL with user:password@ and credential query parameters masked. */
  function maskUrl(url) {
    if (typeof url !== 'string') return url;
    let out = url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^:@/?#\s]+:)([^@/?#\s]+)(@)/i, (_m, head, password, at) => {
      remember(found, password, MIN_CREDENTIAL_LENGTH);
      return `${head}${REDACTED}${at}`;
    });
    const queryStart = out.indexOf('?');
    if (queryStart === -1) return out;
    const hashStart = out.indexOf('#', queryStart);
    const end = hashStart === -1 ? out.length : hashStart;
    const query = out
      .slice(queryStart + 1, end)
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq <= 0) return pair;
        const name = decodeURIComponentSafe(pair.slice(0, eq));
        const value = pair.slice(eq + 1);
        if (!value || !SECRET_QUERY_PARAM.test(name)) return pair;
        remember(found, decodeURIComponentSafe(value), MIN_CREDENTIAL_LENGTH);
        return `${pair.slice(0, eq)}=${REDACTED}`;
      })
      .join('&');
    out = `${out.slice(0, queryStart + 1)}${query}${out.slice(end)}`;
    return out;
  }

  /** Every string in `value` with every secret found so far replaced. */
  function scrub(value) {
    if (found.size === 0) return value;
    const variants = new Set();
    for (const secret of found) {
      variants.add(secret);
      const encoded = encodeURIComponent(secret);
      if (encoded !== secret) variants.add(encoded);
      const quoted = JSON.stringify(secret).slice(1, -1);
      if (quoted !== secret) variants.add(quoted);
    }
    const pattern = new RegExp([...variants].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g');
    const walk = (item) => {
      if (typeof item === 'string') return item.replace(pattern, REDACTED);
      if (Array.isArray(item)) return item.map(walk);
      if (isPlainObject(item)) {
        const out = {};
        for (const [key, child] of Object.entries(item)) out[key] = walk(child);
        return out;
      }
      return item;
    };
    return walk(value);
  }

  return {
    maskJson,
    maskHeaders,
    maskUrl,
    scrub,
    /** Treat another value as secret from now on (a token a script obtained, for example). */
    addSecret: (value) => remember(found, value, MIN_CREDENTIAL_LENGTH),
    hasSecrets: () => found.size > 0,
  };
}

function decodeURIComponentSafe(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch (_error) {
    return text;
  }
}

module.exports = { createMasker, parsePath, REDACTED };
