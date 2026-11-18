'use strict';

/**
 * Stage storage: definitions (revisions), runs (masked records), state (latest
 * outcome) and the projector that turns a committed run into all of them.
 *
 * projectRun is idempotent and keyed by runId: the run is stored once, state and
 * the delivery log summary advance only for a newer run. A crash at any point
 * repeats only these writes. One known gap: a crash between storing the run and
 * counting it leaves the display count (stage_state.runs) one short; execution
 * metrics come from stage_runs, not from that count.
 */

const definitions = require('./definitions');
const runs = require('./runs');
const state = require('./state');

// Stage IDs become field names (execution_logs.stageSummary.<id>).
const STAGE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function assertProjectable(run) {
  const problems = [];
  if (!run || typeof run !== 'object') throw new Error('A stage run is required');
  if (!Number.isInteger(run.orgId)) problems.push('orgId');
  if (!run.deliveryId) problems.push('deliveryId');
  if (!run.runId) problems.push('runId');
  if (!run.stage || !STAGE_ID.test(String(run.stage.id || ''))) problems.push('stage.id');
  if (!Number.isInteger(run.seq) || run.seq < 0) problems.push('seq');
  if (!run.at || Number.isNaN(new Date(run.at).getTime())) problems.push('at');
  if (problems.length) throw new Error(`Stage run is missing or has invalid: ${problems.join(', ')}`);
}

/** Store a committed run and advance everything derived from it. */
async function projectRun(run) {
  assertProjectable(run);
  const { inserted } = await runs.insertRun(run);
  const { advanced } = await state.advanceState(run, { countRun: inserted });
  // A shadow run (a migration comparing paths) stays off the delivery log's summary.
  if (!run.shadow) await state.advanceSummary(run);
  return { inserted, advanced };
}

/** Index specs, created by mongodb.ensureIndexes (and by tests). */
async function ensureStageIndexes(db, safeCreateIndexes = (col, specs) => col.createIndexes(specs)) {
  await safeCreateIndexes(db.collection(runs.COLLECTION), [
    { key: { orgId: 1, deliveryId: 1, at: 1 }, name: 'org_delivery_at_idx' },
    { key: { orgId: 1, 'stage.id': 1, at: -1 }, name: 'org_stage_at_idx' },
    { key: { orgId: 1, integrationId: 1, at: -1 }, name: 'org_integration_at_idx' },
    { key: { at: 1 }, expireAfterSeconds: runs.RETENTION_DAYS * 24 * 3600, name: 'at_ttl_idx' },
  ]);
  await safeCreateIndexes(db.collection(state.COLLECTION), [
    { key: { orgId: 1, deliveryId: 1, stageId: 1 }, unique: true, name: 'org_delivery_stage_unique' },
    { key: { orgId: 1, stageId: 1, status: 1, acceptedAt: -1 }, name: 'org_stage_status_accepted_idx' },
    { key: { orgId: 1, integrationId: 1, stageId: 1, acceptedAt: -1 }, name: 'org_integration_stage_accepted_idx' },
  ]);
}

module.exports = { definitions, runs, state, projectRun, ensureStageIndexes, STAGE_ID };
