'use strict';

/**
 * Delivery follow-up.
 *
 * A send that the provider accepts (HTTP 2xx) is logged SUCCESS, but accepted
 * is not delivered: a WhatsApp or SMS provider reports later whether the
 * message arrived, was read, or failed. When an integration has a follow-up
 * script, each accepted send is checked again on a schedule. The script is the
 * same kind of JavaScript as a transform script (same helpers, including
 * `http`) and returns what became of the message:
 *
 *   // delivery: { statusCode, response, check, sentAt }
 *   // context.headers: the integration's own auth and custom headers
 *   const id = delivery.response?.data?.[0]?.id;
 *   if (!id) return skip('No message id in the response');
 *   const res = await http.get('https://provider.example/v1/messages?msgid=' + id, { headers: context.headers });
 *   const m = res.data?.message?.payload?.message;
 *   return { status: m?.status, deliveredAt: m?.deliveredAt, readAt: m?.readAt, errorCode: m?.errorCode };
 *
 * The answer is normalized to a small fixed vocabulary and stored beside the
 * delivery log. The log's own status is left alone: SUCCESS keeps meaning
 * "accepted".
 */

const queue = require('../data/delivery-follow-ups');
const transformer = require('./transformer');
const { log } = require('../logger');

const {
  SCRIPT_STATUSES,
  FINAL_STATUSES,
  DEFAULT_SCHEDULE_SECONDS,
  validateDeliveryFollowUp,
  normalizeDeliveryFollowUp,
  isActive,
} = require('./delivery-follow-up-config');

const MAX_STORED_RESPONSE_CHARS = 50000;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A date from epoch seconds, epoch milliseconds or a date string; null when unusable. */
function toDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * What a script returned, as { status, deliveredAt, readAt, errorCode,
 * errorMessage }. Nothing means "no answer yet". A status the script made up
 * throws, so a typo shows as a failed check instead of a wrong number.
 */
function normalizeFollowUpResult(raw) {
  if (raw === undefined || raw === null) return { status: 'PENDING' };
  const input = typeof raw === 'string' ? { status: raw } : raw;
  if (!isPlainObject(input)) throw new Error('The follow-up script must return an object like { status: "DELIVERED" }');

  const status = String(input.status === undefined || input.status === null ? 'PENDING' : input.status)
    .trim()
    .toUpperCase();
  if (!SCRIPT_STATUSES.includes(status)) {
    throw new Error(`Unknown status "${status}". Use one of ${SCRIPT_STATUSES.join(', ')}`);
  }
  const text = (value) => (value === undefined || value === null || value === '' ? null : String(value).slice(0, 500));
  return {
    status,
    deliveredAt: toDate(input.deliveredAt),
    readAt: toDate(input.readAt),
    errorCode: text(input.errorCode),
    errorMessage: text(input.errorMessage),
  };
}

/** A JSON text as the value it holds; anything else (or text cut off mid-way) as it is. */
function parseJsonText(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return value;
  }
}

/** The response as stored with the job: small enough not to duplicate a large body. */
function snapshotResponse(rawBody) {
  const body = parseJsonText(rawBody);
  let text;
  try {
    text = typeof body === 'string' ? body : JSON.stringify(body);
  } catch (_error) {
    return null;
  }
  if (text === undefined || text.length <= MAX_STORED_RESPONSE_CHARS) return body === undefined ? null : body;
  return { truncated: true, preview: text.slice(0, 2000) };
}

const integrationId = (integration) => String(integration.id || integration._id);

/**
 * Queue the first check for an accepted send. Never throws: a problem here
 * must not touch the delivery that already succeeded.
 */
async function scheduleFollowUp({ orgId, logId, integration, statusCode, responseBody }) {
  try {
    const config = integration && integration.deliveryFollowUp;
    if (!isActive(config) || !logId) return;
    const schedule = normalizeDeliveryFollowUp(config).checkAfterSeconds;
    const sentAt = new Date();
    const nextCheckAt = new Date(sentAt.getTime() + schedule[0] * 1000);

    await queue.enqueue({
      orgId,
      logId: String(logId),
      integrationId: integrationId(integration),
      integrationName: integration.name || null,
      eventType: integration.eventType || integration.type || null,
      sentAt,
      createdAt: sentAt,
      delivery: { statusCode: statusCode ?? null, response: snapshotResponse(responseBody) },
      checkIndex: 0,
      nextCheckAt,
      status: 'PENDING',
      deliveryStatus: 'PENDING',
      lockedUntil: null,
    });
    await queue.markLog(orgId, String(logId), {
      status: 'PENDING',
      done: false,
      checks: 0,
      nextCheckAt,
    });
  } catch (error) {
    log('warn', 'Could not schedule delivery follow-up', { orgId, logId, error: error.message });
  }
}

/** The headers the integration sends: its auth plus its custom headers. */
async function integrationHeaders(integration) {
  if (!integration) return {};
  const { buildAuthHeaders } = require('../processor/auth-helper');
  const headers = { ...(await buildAuthHeaders(integration, 'GET', integration.targetUrl)) };
  for (const [name, value] of Object.entries(integration.customHeaders || {})) {
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

/** Run the script once. Resolves to { result } or { skipped } or { error }. */
async function runScript(job, integration, config, checkNumber, spans = null) {
  try {
    const delivery = {
      statusCode: job.delivery?.statusCode ?? null,
      response: job.delivery?.response ?? null,
      sentAt: new Date(job.sentAt).toISOString(),
      check: checkNumber,
    };
    const context = {
      orgId: job.orgId,
      integrationId: job.integrationId,
      eventType: job.eventType || null,
      headers: await integrationHeaders(integration),
    };
    const raw = await transformer.applyScriptTransform(
      `const delivery = payload;\n${config.script}`,
      delivery,
      context,
      integration,
      spans
    );
    if (transformer.isTransformationSkipped(raw)) {
      return { skipped: transformer.getTransformationSkipReason(raw) || 'Not tracked' };
    }
    return { result: normalizeFollowUpResult(raw) };
  } catch (error) {
    return { error: String(error.message || error).slice(0, 500) };
  }
}

/**
 * Do one check of a queued follow-up and store the outcome on the job and on
 * the delivery log. `now` is injectable for tests.
 */
async function processFollowUp(job, now = new Date()) {
  const integration = await require('../data').getIntegration(job.integrationId);
  const config = integration && integration.deliveryFollowUp;

  const finish = async ({ deliveryStatus, done, extra = {}, nextCheckAt = null }) => {
    const checks = (job.checkIndex || 0) + 1;
    const update = {
      deliveryStatus,
      status: done ? 'DONE' : 'PENDING',
      checkIndex: checks,
      lastCheckedAt: now,
      nextCheckAt: done ? null : nextCheckAt,
      lockedUntil: null,
      ...extra.job,
    };
    await queue.saveCheck(job._id, update);
    await queue.markLog(job.orgId, job.logId, {
      status: deliveryStatus,
      done,
      checks,
      lastCheckedAt: now,
      nextCheckAt: update.nextCheckAt,
      ...extra.log,
    });
  };

  if (!integration || !isActive(config)) {
    return finish({ deliveryStatus: 'NOT_TRACKED', done: true, extra: { log: { reason: 'Follow-up is switched off' } } });
  }

  const schedule = normalizeDeliveryFollowUp(config).checkAfterSeconds;
  const checkNumber = (job.checkIndex || 0) + 1;
  const outcome = await runScript(job, integration, config, checkNumber);

  if (outcome.skipped !== undefined) {
    return finish({ deliveryStatus: 'NOT_TRACKED', done: true, extra: { log: { reason: outcome.skipped } } });
  }

  const known = job.deliveryStatus && job.deliveryStatus !== 'PENDING' ? job.deliveryStatus : null;
  const result = outcome.result;
  // PENDING never overwrites something already learned (a later check that finds nothing).
  const status = result && result.status !== 'PENDING' ? result.status : known || 'PENDING';
  const exhausted = checkNumber >= schedule.length;
  const done = FINAL_STATUSES.has(status) || exhausted;
  const finalStatus = done && status === 'PENDING' ? 'UNKNOWN' : status;

  const nextAt = new Date((job.sentAt ? new Date(job.sentAt).getTime() : now.getTime()) + (schedule[checkNumber] || 0) * 1000);
  const details = {
    deliveredAt: (result && result.deliveredAt) || job.deliveredAt || null,
    readAt: (result && result.readAt) || job.readAt || null,
    errorCode: (result && result.errorCode) || null,
    errorMessage: (result && result.errorMessage) || null,
    lastError: outcome.error || null,
  };
  return finish({
    deliveryStatus: finalStatus,
    done,
    nextCheckAt: nextAt.getTime() > now.getTime() ? nextAt : now,
    extra: { job: details, log: details },
  });
}

/**
 * Run a follow-up script once against a sample delivery, for the console's
 * "Test" button. Stores nothing. Resolves to { outcome: RESULT | SKIPPED | ERROR, ... }
 * with the http calls the script made, so a script can be debugged before it is saved.
 */
async function testFollowUpScript({ integration, script, delivery }) {
  const startedAt = Date.now();
  const spans = [];
  const job = {
    orgId: integration && integration.orgId,
    integrationId: integration && integrationId(integration),
    eventType: integration ? integration.eventType || integration.type || null : null,
    sentAt: new Date(),
    delivery: { statusCode: delivery.statusCode ?? null, response: delivery.response ?? null },
  };
  const outcome = await runScript(job, integration, { script }, 1, spans);
  const httpCalls = spans
    .filter((span) => span.name === 'script_http')
    .map(({ method, url, statusCode, duration, status, error, responseBody }) => ({
      method,
      url,
      statusCode: statusCode ?? null,
      durationMs: duration ?? null,
      error: error || (status === 'error' ? 'Request failed' : null),
      responseBody: responseBody ?? null,
    }));
  const base = { durationMs: Date.now() - startedAt, httpCalls };
  if (outcome.skipped !== undefined) return { ...base, outcome: 'SKIPPED', reason: outcome.skipped };
  if (outcome.error) return { ...base, outcome: 'ERROR', error: outcome.error };
  return { ...base, outcome: 'RESULT', result: outcome.result };
}

module.exports = {
  SCRIPT_STATUSES,
  DEFAULT_SCHEDULE_SECONDS,
  validateDeliveryFollowUp,
  normalizeDeliveryFollowUp,
  normalizeFollowUpResult,
  scheduleFollowUp,
  processFollowUp,
  testFollowUpScript,
};
