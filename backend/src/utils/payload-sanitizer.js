/**
 * Payload sanitizer — strips base64 data from any object before it reaches MongoDB.
 *
 * Two patterns are detected and replaced with a short placeholder:
 *   1. Data-URI strings: "data:image/png;base64,AAAA..."
 *   2. Any standalone string that looks like raw base64 and is longer than BASE64_MIN_LENGTH
 *
 * Applied at every collection write path so large images never bloat the DB.
 */

const BASE64_MIN_LENGTH = 500; // chars — short enough to catch real photos, long enough to skip UUIDs/tokens
const BASE64_PATTERN = /^[A-Za-z0-9+/\r\n]+=*$/;

/**
 * Returns true if the string looks like a raw base64 blob (not a normal text string).
 * @param {string} s
 */
function looksLikeBase64(s) {
  if (s.length < BASE64_MIN_LENGTH) return false;
  // Sample the string — checking every char of a 1MB string is expensive
  const sample = s.length > 2000 ? s.slice(0, 1000) + s.slice(-200) : s;
  return BASE64_PATTERN.test(sample.replace(/\s/g, ''));
}

/**
 * Replace base64 content in a string with a placeholder.
 * @param {string} s
 * @returns {string}
 */
function redactString(s) {
  // Data-URI: data:image/png;base64,AAAA...
  if (s.startsWith('data:') && s.includes(';base64,')) {
    const commaIdx = s.indexOf(',');
    const meta = s.slice(0, commaIdx); // e.g. "data:image/png;base64"
    const b64 = s.slice(commaIdx + 1);
    return `${meta},[BASE64_REDACTED: ${b64.length} chars]`;
  }
  // Raw base64 blob
  if (looksLikeBase64(s)) {
    return `[BASE64_REDACTED: ${s.length} chars]`;
  }
  return s;
}

/**
 * Recursively walk an object/array/string and redact any base64 values.
 * Returns a new value — never mutates the original.
 *
 * @param {*} value
 * @returns {*}
 */
function redactBase64(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactBase64);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactBase64(v);
    }
    return out;
  }
  return value;
}

module.exports = { redactBase64 };
