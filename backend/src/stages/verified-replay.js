'use strict';

/**
 * "Check status, then replay": sending a failed delivery again is only safe when the
 * provider does not already have the message (a send that timed out may have
 * arrived). So the delivery's own check is run first, once, against the delivery
 * log, and the answer decides:
 *
 *   safe_to_resend    the check returned a status the stage lists in
 *                     verification.resendWhen (the provider says it does not have it)
 *   provider_has_it   the check returned any other status: refused, always
 *   unverifiable      the check failed, returned no status, or the delivery has no
 *                     check marked with `verification`: refused unless the caller
 *                     accepts the risk (acceptUnverified), which is audited
 *
 * The check's run is recorded like any other (stage_runs, latest state) and the
 * replay itself is the ordinary manual replay.
 */

const mongodb = require('../mongodb');
const store = require('./store');
const { executeStage } = require('./executor');
const { normalizeStage } = require('./config');
const { targetOf } = require('./targets');
const { scopeFromLog, ReplayError } = require('./replay');

const REPLAYABLE = ['FAILED', 'ABANDONED'];

/** The check that asks the provider about this delivery: the first enabled one marked `verification`. */
function verifyingStage(integration, actionIndex) {
  const target = targetOf(integration, actionIndex);
  const stages = (target && target.stages) || [];
  return stages.find((stage) => stage && stage.hook === 'after_delivery' && stage.enabled !== false && stage.verification && Array.isArray(stage.verification.resendWhen) && stage.verification.resendWhen.length > 0) || null;
}

/** Run the check once. Resolves to { verdict, stage, status, reason, run } (run is the stored record, or null). */
async function verifyDelivery(orgId, logDoc, integration, deps) {
  const actionIndex = Number.isInteger(logDoc.actionIndex) ? logDoc.actionIndex : null;
  const configured = verifyingStage(integration, actionIndex);
  if (!configured) return { verdict: 'unverifiable', stage: null, status: null, reason: 'No check is set up to ask the provider about this delivery', run: null };

  const stage = normalizeStage(configured);
  const deliveryId = String(logDoc._id);
  const latest = (await store.state.getStates(orgId, deliveryId)).find((state) => state.stageId === stage.id);
  const seq = latest && Number.isInteger(latest.seq) ? latest.seq : 1;
  const definitionHash = await store.definitions.saveDefinition(orgId, stage);
  const result = await executeStage({
    stage,
    integration,
    scope: scopeFromLog(logDoc, integration, { stage: { hook: stage.hook }, seq, runId: latest ? latest.lastRunId : null }),
    deadline: Date.now() + stage.timeoutMs,
    meta: {
      orgId,
      deliveryId,
      integrationId: String(integration._id || integration.id),
      definitionHash,
      seq,
      executionAttempt: 1,
      replayOfRunId: latest ? latest.lastRunId : null,
      acceptedAt: latest ? latest.acceptedAt : null,
    },
    deps,
  });
  await store.projectRun(result.record);

  const base = { stage: { id: stage.id, name: stage.name }, run: result.record };
  if (result.outcome !== 'ok' || !result.status) {
    return { ...base, verdict: 'unverifiable', status: result.status || null, reason: result.record.error || 'The check gave no status' };
  }
  const safe = configured.verification.resendWhen.includes(result.status);
  return { ...base, verdict: safe ? 'safe_to_resend' : 'provider_has_it', status: result.status, reason: null };
}

/**
 * checkAndReplay(orgId, logId, { reason, acceptUnverified, user }, deps)
 * deps: { loadIntegration, executeDeps, audit, replay(logId, orgId, options) }
 * Resolves to { verdict, status, stage, replayed: true }; throws ReplayError
 * (400 no reason, 404, 409 with code PROVIDER_HAS_MESSAGE / UNVERIFIED / NOT_REPLAYABLE).
 */
async function checkAndReplay(orgId, logId, { reason, acceptUnverified = false, user = null } = {}, deps) {
  if (!reason || !String(reason).trim()) throw new ReplayError(400, 'Say why the delivery is sent again');
  const id = mongodb.toObjectId(logId);
  const db = await mongodb.getDbSafe();
  const logDoc = id ? await db.collection('execution_logs').findOne({ _id: id, orgId }) : null;
  if (!logDoc) throw new ReplayError(404, 'Delivery not found');
  if (!REPLAYABLE.includes(logDoc.status)) {
    throw new ReplayError(409, 'Only a failed or abandoned delivery can be sent again', { code: 'NOT_REPLAYABLE' });
  }
  const integration = await deps.loadIntegration(orgId, String(logDoc.integrationConfigId));
  if (!integration) throw new ReplayError(409, 'The integration no longer exists', { code: 'NOT_REPLAYABLE' });

  const check = await verifyDelivery(orgId, logDoc, integration, deps.executeDeps);
  const summary = { verdict: check.verdict, status: check.status, stage: check.stage, runId: check.run ? check.run.runId : null, reason: check.reason };
  const audited = (action, extra = {}) =>
    deps.audit({ action, resourceType: 'delivery', resourceId: String(logDoc._id), user, orgId, metadata: { ...summary, reason: String(reason), ...extra } });

  if (check.verdict === 'provider_has_it') {
    await audited('delivery_replay_refused');
    throw new ReplayError(409, `The provider reports this message as ${check.status}, so it was not sent again`, { code: 'PROVIDER_HAS_MESSAGE', details: summary });
  }
  if (check.verdict === 'unverifiable' && acceptUnverified !== true) {
    await audited('delivery_replay_refused');
    throw new ReplayError(409, `Could not confirm whether the provider has the message: ${check.reason}`, { code: 'UNVERIFIED', details: summary });
  }
  await audited('delivery_replay_after_check', { acceptedUnverified: check.verdict === 'unverifiable' });
  await deps.replay(String(logDoc._id), orgId, { reason: String(reason) });
  return { ...summary, replayed: true };
}

module.exports = { checkAndReplay, verifyDelivery, verifyingStage };
