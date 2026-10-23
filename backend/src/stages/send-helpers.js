'use strict';

/** Small helpers both send paths use around stages. */

/** A fetch Response's headers as a plain object. */
function headersObject(resp) {
  const out = {};
  if (resp && resp.headers && typeof resp.headers.forEach === 'function') resp.headers.forEach((value, name) => (out[name] = value));
  return out;
}

/** The URL with extra query parameters (from the Send step's bindings). */
function withQuery(url, query) {
  const entries = Object.entries(query || {});
  if (entries.length === 0) return url;
  const target = new URL(url);
  for (const [name, value] of entries) target.searchParams.set(name, String(value));
  return target.href;
}

module.exports = { headersObject, withQuery };
