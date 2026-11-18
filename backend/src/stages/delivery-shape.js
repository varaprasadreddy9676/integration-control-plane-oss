'use strict';

/**
 * What a stage sees of the delivery: one shape for every kind of send.
 *
 *   delivery.request   { protocol, target, method, body }
 *   delivery.response  { protocol, ok, status, code, message, providerMessageId, headers, body }
 *
 * `target` is where it went (a URL, mllp://host:port, email:SMTP...); `status` is
 * the HTTP status for HTTP and null otherwise; `code` is the answer's own code
 * (the HTTP status as text, an HL7 ACK code, SENT...). Each send path fills these
 * from its own result; stages never need to know which kind of send it was.
 */

const { protocolOf } = require('./targets');

/**
 * A body as stages see it: JSON objects and arrays parsed, anything else kept as
 * it is (a plain-text answer stays text). Every stage path reads bodies this way.
 */
function parseBody(body) {
  if (typeof body !== 'string') return body === undefined ? null : body;
  const trimmed = body.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return body;
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return body;
  }
}

const orNull = (value) => (value === undefined ? null : value);

function deliveryRequest({ protocol = 'http', target = null, method = null, body = null } = {}) {
  return { protocol, target: orNull(target), method: orNull(method), body: orNull(body) };
}

function deliveryResponse({
  protocol = 'http',
  ok,
  status = null,
  code = null,
  message = null,
  providerMessageId = null,
  headers = {},
  body = null,
} = {}) {
  const httpOk = typeof status === 'number' ? status >= 200 && status < 300 : false;
  return {
    protocol,
    ok: typeof ok === 'boolean' ? ok : httpOk,
    status: orNull(status),
    code:
      code === null || code === undefined
        ? status === null || status === undefined
          ? null
          : String(status)
        : String(code),
    message: orNull(message),
    providerMessageId: orNull(providerMessageId),
    headers: headers || {},
    body: parseBody(body),
  };
}

// Logs of sends that are not HTTP keep their kind in httpMethod (see delivery-engine).
const LOGGED_KIND = { COMMUNICATION: 'COMMUNICATION', HL7_MLLP: 'HL7_MLLP' };

/**
 * The request and response as a delivery log recorded them (for deferred stages,
 * replay and tests against a real delivery). A log written before this shape
 * existed is read the same way.
 */
function fromLog(logDoc = {}) {
  const kind = LOGGED_KIND[logDoc.httpMethod] || 'HTTP';
  const channel = kind === 'COMMUNICATION' ? String(logDoc.targetUrl || '').split(':')[0] : null;
  const protocol = protocolOf({ kind, communicationConfig: { channel } });
  const http = protocol === 'http';
  const status = logDoc.responseStatus === undefined ? null : logDoc.responseStatus;
  return {
    request: deliveryRequest({
      protocol,
      target: logDoc.targetUrl,
      method: http ? logDoc.httpMethod : null,
      body: logDoc.requestPayload,
    }),
    response: deliveryResponse({
      protocol,
      ok: logDoc.status === 'SUCCESS',
      status: http ? status : null,
      code: http
        ? null
        : (logDoc.metadata && logDoc.metadata.hl7 && logDoc.metadata.hl7.ackCode) ||
          logDoc.errorCode ||
          (logDoc.status === 'SUCCESS' ? 'SENT' : null),
      message: logDoc.errorMessage || null,
      providerMessageId: logDoc.messageId && !http ? logDoc.messageId : null,
      body: logDoc.responseBody,
    }),
  };
}

module.exports = { deliveryRequest, deliveryResponse, fromLog, parseBody };
