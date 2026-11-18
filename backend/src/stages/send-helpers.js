'use strict';

/** Small helpers the send paths use around stages. */

const { deliveryResponse } = require('./delivery-shape');

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

/**
 * after_response stages on a fetch Response (its body read from a clone, so the
 * caller can still read it). { failed: false } when no stage acts.
 */
async function afterHttpResponse(stages, resp) {
  if (!stages.active) return { failed: false };
  const body = await resp
    .clone()
    .text()
    .catch(() => '');
  return stages.afterResponse(deliveryResponse({ status: resp.status, headers: headersObject(resp), body }));
}

module.exports = { headersObject, withQuery, afterHttpResponse };
