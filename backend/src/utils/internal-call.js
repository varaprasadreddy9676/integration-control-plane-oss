'use strict';

/**
 * Calls the gateway makes to its own inbound integrations (e.g. alert channels
 * that forward through one). They carry a random token generated at startup and
 * kept only in memory, so the inbound runtime can trust them without the
 * integration's caller credentials. The token never leaves this process: the
 * calls go to 127.0.0.1 and it changes on every restart.
 */

const crypto = require('crypto');

const INTERNAL_CALL_HEADER = 'x-gateway-internal-call';
const TOKEN = crypto.randomBytes(32).toString('hex');

const internalCallToken = () => TOKEN;

function isInternalCall(headers = {}) {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === INTERNAL_CALL_HEADER);
  const value = match ? String(match[1] || '') : '';
  if (value.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(TOKEN));
}

module.exports = { INTERNAL_CALL_HEADER, internalCallToken, isInternalCall };
