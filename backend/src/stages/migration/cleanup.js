'use strict';

/**
 * Cleanup of the bodies the old delivery follow-up recorded on delivery logs
 * (execution_logs.followUp.history[].httpCalls: headers and response bodies,
 * which can name the recipient). Idempotent:
 *
 *   - checks younger than 30 days are copied into stage_runs, masked like a
 *     stage's records (the recipient keys a provider report carries), so the
 *     console shows them as runs of the "Delivery status check" stage;
 *   - every check then keeps only what it was: method, URL (credentials masked),
 *     status code, duration, error; the log is marked bodiesCleanedAt.
 */

const mongodb = require('../../mongodb');
const store = require('../store');
const { createMasker } = require('../mask');
const { parseBody } = require('../delivery-shape');

const KEEP_DAYS = 30;
const PERSONAL_KEYS = ['to', 'from', 'recipient', 'recipient_id', 'phone', 'mobile', 'msisdn', 'wa_id', 'email'];
const OUTCOMES = { RESULT: 'ok', SKIPPED: 'skipped', ERROR: 'error' };

const hasBodies = { 'followUp.history.httpCalls': { $elemMatch: { $or: [{ responseBody: { $ne: null } }, { headers: { $ne: null } }] } } };

function runFromCheck(logDoc, check) {
  const masker = createMasker({ sensitiveKeys: PERSONAL_KEYS });
  const calls = (check.httpCalls || []).map((call, index) => ({
    id: index + 1,
    method: call.method,
    url: masker.maskUrl(call.url),
    statusCode: call.statusCode === undefined ? null : call.statusCode,
    durationMs: call.durationMs === undefined ? null : call.durationMs,
    error: call.error ? { code: 'NETWORK', message: String(call.error) } : undefined,
    requestHeaders: call.headers ? masker.maskHeaders(call.headers) : undefined,
    responseBody: call.responseBody === null || call.responseBody === undefined ? undefined : masker.maskJson(parseBody(call.responseBody)),
    // The old follow-up kept at most 3000 characters of each body.
    responseBodyCut: typeof call.responseBody === 'string' && call.responseBody.length >= 3000 ? 'recording' : undefined,
  }));
  const record = masker.scrub({
    runId: `followup:${logDoc._id}:${check.check}`,
    orgId: logDoc.orgId,
    deliveryId: String(logDoc._id),
    integrationId: logDoc.integrationConfigId ? String(logDoc.integrationConfigId) : null,
    stage: { id: 'deliveryStatus', name: 'Delivery status check', hook: 'after_delivery', runner: 'script', definitionHash: null },
    seq: check.check,
    executionAttempt: 1,
    at: new Date(check.at).toISOString(),
    durationMs: check.durationMs || null,
    outcome: OUTCOMES[check.outcome] || 'ok',
    status: check.status || null,
    done: false,
    error: check.error || null,
    reason: check.reason || null,
    result: check.status ? { status: check.status, data: { errorCode: check.errorCode || null, errorMessage: check.errorMessage || null } } : undefined,
    calls,
    logs: [],
    fromFollowUp: true,
  });
  return record;
}

const stripCheck = (check) => ({
  ...check,
  httpCalls: (check.httpCalls || []).map((call) => ({
    method: call.method,
    url: createMasker().maskUrl(call.url),
    statusCode: call.statusCode === undefined ? null : call.statusCode,
    durationMs: call.durationMs === undefined ? null : call.durationMs,
    error: call.error || null,
  })),
});

/**
 * Clean the logs of `orgId` (or every org when omitted). Without `commit` it only
 * counts. Resolves to { logs, checksCopied, checksStripped }.
 */
async function cleanFollowUpBodies({ orgId, commit = false, batch = 200, limit = Infinity, now = new Date() } = {}) {
  const db = await mongodb.getDbSafe();
  const col = db.collection('execution_logs');
  const query = { ...(orgId ? { orgId } : {}), 'followUp.bodiesCleanedAt': { $exists: false }, ...hasBodies };
  const cutoff = now.getTime() - KEEP_DAYS * 24 * 3600 * 1000;
  const totals = { logs: 0, checksCopied: 0, checksStripped: 0 };
  const cursor = col.find(query, { projection: { orgId: 1, integrationConfigId: 1, followUp: 1 } }).batchSize(batch);
  for await (const logDoc of cursor) {
    if (totals.logs >= limit) break;
    totals.logs += 1;
    const history = (logDoc.followUp && logDoc.followUp.history) || [];
    const recent = history.filter((check) => check.at && new Date(check.at).getTime() >= cutoff);
    totals.checksCopied += recent.length;
    totals.checksStripped += history.length;
    if (!commit) continue;
    for (const check of recent) await store.runs.insertRun(runFromCheck(logDoc, check));
    await col.updateOne(
      { _id: logDoc._id, 'followUp.bodiesCleanedAt': { $exists: false } },
      { $set: { 'followUp.history': history.map(stripCheck), 'followUp.bodiesCleanedAt': now } }
    );
  }
  return totals;
}

module.exports = { cleanFollowUpBodies, runFromCheck };
