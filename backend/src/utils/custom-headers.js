'use strict';

/**
 * Merge integration customHeaders into outbound headers, substituting {{placeholder}}
 * values from the inbound request headers (case-insensitive lookup).
 *
 * Example: customHeaders = { 'x-partner-id': '{{partnerId}}' }
 *   + inbound header  'partnerid: IN123'  →  outbound 'x-partner-id: IN123'
 */
function resolveCustomHeaders(customHeaders, inboundReqHeaders) {
  if (!customHeaders || typeof customHeaders !== 'object') return {};
  const resolved = {};
  const lowerReqHeaders = {};
  if (inboundReqHeaders && typeof inboundReqHeaders === 'object') {
    for (const [k, v] of Object.entries(inboundReqHeaders)) {
      lowerReqHeaders[k.toLowerCase()] = v;
    }
  }
  for (const [name, value] of Object.entries(customHeaders)) {
    if (typeof value !== 'string') {
      resolved[name] = value;
      continue;
    }
    resolved[name] = value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, key) => {
      const k = String(key).trim();
      return lowerReqHeaders[k.toLowerCase()] ?? lowerReqHeaders[k] ?? '';
    });
  }
  return resolved;
}

/**
 * Same as resolveCustomHeaders, for re-sending a call after the fact. A log that never kept the
 * caller's headers still keeps what was sent upstream, so a header that resolves to nothing
 * falls back to the value from that earlier request (case-insensitive on the header name).
 */
function resolveReplayCustomHeaders(customHeaders, callerHeaders, previouslySentHeaders) {
  const resolved = resolveCustomHeaders(customHeaders, callerHeaders);
  if (!previouslySentHeaders || typeof previouslySentHeaders !== 'object') return resolved;
  const sentLower = {};
  for (const [k, v] of Object.entries(previouslySentHeaders)) sentLower[k.toLowerCase()] = v;
  for (const [name, value] of Object.entries(resolved)) {
    const blank = value === '' || value === null || value === undefined;
    const earlier = sentLower[name.toLowerCase()];
    if (blank && earlier !== undefined && earlier !== '') resolved[name] = earlier;
  }
  return resolved;
}

module.exports = { resolveCustomHeaders, resolveReplayCustomHeaders };
