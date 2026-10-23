'use strict';

/**
 * Manual replay of a stage run: run the stage again for the same delivery and
 * check (same seq), on purpose, recording who asked and why (audit log) and
 * linking the new run to the old (replayOfRunId).
 *
 * - It uses the revision the original run used, unless the caller explicitly asks
 *   for the stage's current definition.
 * - Its input comes from the delivery log (the event, the request and the
 *   target's answer), as kept there.
 * - It never changes the delivery's result, and does not touch pending jobs: a
 *   replay's outcome becomes the stage's latest state, nothing more.
 */

const mongodb = require('../mongodb');
const store = require('./store');
const { executeStage } = require('./executor');
const { normalizeStage } = require('./config');

class ReplayError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parse(value) {
  if (typeof value !== 'string') return value === undefined ? null : value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

/** The scope a stage sees, rebuilt from the delivery log. */
function scopeFromLog(logDoc, integration, run) {
  return {
    event: logDoc.originalPayload || {},
    delivery: {
      request: { url: logDoc.targetUrl || null, method: logDoc.httpMethod || null, body: logDoc.requestPayload || null },
      response: { status: logDoc.responseStatus === undefined ? null : logDoc.responseStatus, headers: {}, body: parse(logDoc.responseBody) },
      attempt: logDoc.attemptCount || null,
      status: logDoc.status || null,
      errorMessage: logDoc.errorMessage || null,
      failureSeq: run.stage.hook === 'on_failure' ? run.seq : null,
      replayOf: run.runId,
    },
    stages: {},
    vars: (integration && integration.variables) || {},
    run: { seq: run.seq, executionAttempt: 1 },
  };
}

/**
 * replayRun(orgId, runId, { useCurrentRevision, user, reason }, deps)
 * deps: { executeDeps, loadIntegration, audit }
 * Resolves to the new run's record; throws ReplayError (404, 409, 400).
 */
async function replayRun(orgId, runId, { useCurrentRevision = false, user = null, reason } = {}, deps) {
  if (!reason || !String(reason).trim()) throw new ReplayError(400, 'Say why the stage is replayed');
  const original = await store.runs.getRun(orgId, runId);
  if (!original) throw new ReplayError(404, 'Stage run not found');

  const integration = await deps.loadIntegration(orgId, original.integrationId);
  const current = integration && (integration.stages || []).find((stage) => stage && stage.id === original.stage.id);
  let definition;
  let definitionHash;
  if (useCurrentRevision) {
    if (!current) throw new ReplayError(409, 'The stage no longer exists, so it has no current revision');
    definition = current;
    definitionHash = await store.definitions.saveDefinition(orgId, normalizeStage(current));
  } else {
    definitionHash = original.stage.definitionHash;
    definition = definitionHash ? await store.definitions.getDefinition(orgId, definitionHash) : null;
    if (!definition) throw new ReplayError(409, 'The revision this run used is not available; replay with the current revision');
  }
  const stage = normalizeStage({ ...definition, id: original.stage.id, name: (current && current.name) || original.stage.name });

  const db = await mongodb.getDbSafe();
  const logId = mongodb.toObjectId(original.deliveryId);
  const logDoc = logId ? await db.collection('execution_logs').findOne({ _id: logId, orgId }) : null;
  if (!logDoc) throw new ReplayError(409, 'The delivery log is gone, so there is nothing to replay against');

  const result = await executeStage({
    stage,
    integration: integration || {},
    scope: scopeFromLog(logDoc, integration, original),
    deadline: Date.now() + stage.timeoutMs,
    meta: {
      orgId,
      deliveryId: original.deliveryId,
      integrationId: original.integrationId,
      integrationRevision: original.integrationRevision,
      definitionHash,
      seq: original.seq,
      executionAttempt: 1,
      replayOfRunId: original.runId,
      acceptedAt: original.acceptedAt,
    },
    deps: deps.executeDeps,
  });
  await store.projectRun(result.record);
  await deps.audit({
    action: 'stage_replayed',
    resourceType: 'stage',
    resourceId: `${original.integrationId}:${original.stage.id}`,
    user,
    orgId,
    metadata: { runId: original.runId, newRunId: result.record.runId, deliveryId: original.deliveryId, useCurrentRevision, reason: String(reason) },
  });
  return result.record;
}

module.exports = { replayRun, scopeFromLog, ReplayError };
