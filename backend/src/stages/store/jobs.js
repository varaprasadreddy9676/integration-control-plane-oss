'use strict';

/**
 * stage_jobs: the deferred stages of a delivery (after_delivery checks,
 * on_failure), generalizing delivery_follow_ups. One job per logical key
 * (orgId, deliveryId, stageId, trigger, failureSeq); the job advances through its
 * checks (seq) itself.
 *
 * Execution is at least once. The commit point is this document:
 *   claim     state PENDING -> RUNNING with a fresh lease token and the
 *             claimedDefinitionHash (a RUNNING job whose lease ran out can be
 *             claimed again: its worker is presumed dead)
 *   commit    one conditional update matching _id, state RUNNING, the lease token
 *             and claimedDefinitionHash sets the next state and stores the masked
 *             run record in `projection`; a stale worker's commit matches nothing
 *   project   the run is projected (store/index.js projectRun), then `projection`
 *             is cleared; the repair worker re-projects any job still holding one
 *
 * Raw execution inputs (`input`: the accepted response and context) live only
 * here, are never returned by an API, and are removed when the job ends.
 */

const crypto = require('crypto');
const mongodb = require('../../mongodb');

const COLLECTION = 'stage_jobs';
const LEASE_MS = 3 * 60 * 1000; // > the longest deferred stage (60 s) with room; no renewal needed
const KEEP_FINISHED_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

const FINAL_STATES = ['COMPLETED', 'FAILED', 'DEAD', 'CANCELLED', 'EXPIRED'];

const collection = async () => (await mongodb.getDbSafe()).collection(COLLECTION);
const unwrap = (result) => (result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result);

/**
 * Create the job for an intent unless it exists (same logical key). Resolves to
 * { created, job }.
 */
async function createJob(job) {
  const col = await collection();
  const key = {
    orgId: job.orgId,
    deliveryId: String(job.deliveryId),
    stageId: job.stageId,
    trigger: job.trigger,
    failureSeq: job.failureSeq || 0,
  };
  const now = new Date();
  const doc = {
    ...key,
    integrationId: job.integrationId,
    integrationRevision: job.integrationRevision || null,
    definitionHash: job.definitionHash,
    // A job handed over from the old follow-up starts where it was (see migration/).
    state: job.state || 'PENDING',
    seq: job.seq || 1,
    executionAttempt: 1,
    checksDone: job.checksDone || 0,
    lastStatus: job.lastStatus || null,
    ...(job.shadow ? { shadow: true, compared: false } : {}),
    nextRunAt: job.firstRunAt,
    acceptedAt: job.acceptedAt,
    input: job.input,
    lease: null,
    claimedDefinitionHash: null,
    createdAt: now,
    updatedAt: now,
    // Kept until well after the last possible check; reset when the job ends.
    purgeAt: new Date((job.lastRunBy || job.firstRunAt).getTime() + KEEP_FINISHED_DAYS * DAY_MS),
  };
  try {
    const result = await col.updateOne(key, { $setOnInsert: doc }, { upsert: true });
    return { created: result.upsertedCount === 1 };
  } catch (error) {
    if (error.code === 11000) return { created: false };
    throw error;
  }
}

/**
 * Claim the next due job (oldest due first), skipping `excludeOrgs`. Resolves to
 * the claimed job (with its lease token) or null.
 */
async function claimDue({ now = new Date(), excludeOrgs = [] } = {}) {
  const col = await collection();
  const token = crypto.randomBytes(12).toString('hex');
  const due = {
    $or: [
      { state: 'PENDING', nextRunAt: { $lte: now } },
      { state: 'RUNNING', 'lease.until': { $lt: now } }, // its worker died
    ],
  };
  if (excludeOrgs.length) due.orgId = { $nin: excludeOrgs };
  const claimed = unwrap(
    await col.findOneAndUpdate(
      due,
      [
        {
          $set: {
            // A reclaimed job is another execution of the same check.
            executionAttempt: { $cond: [{ $eq: ['$state', 'RUNNING'] }, { $add: ['$executionAttempt', 1] }, '$executionAttempt'] },
            state: 'RUNNING',
            lease: { token, until: new Date(now.getTime() + LEASE_MS) },
            claimedDefinitionHash: '$definitionHash',
            updatedAt: now,
          },
        },
      ],
      { sort: { nextRunAt: 1 }, returnDocument: 'after' }
    )
  );
  return claimed || null;
}

/**
 * The fenced commit: applies `update` ($set fields) only if `job` is still held
 * with this lease and definition. Resolves to { committed }.
 */
async function commit(job, set, unset = {}) {
  const col = await collection();
  const update = { $set: { ...set, updatedAt: new Date() } };
  if (Object.keys(unset).length) update.$unset = unset;
  const result = await col.updateOne(
    { _id: job._id, state: 'RUNNING', 'lease.token': job.lease.token, claimedDefinitionHash: job.claimedDefinitionHash },
    update
  );
  return { committed: result.modifiedCount === 1 };
}

async function clearProjection(jobId, runId) {
  const col = await collection();
  await col.updateOne({ _id: jobId, 'projection.runId': runId }, { $unset: { projection: 1 } });
}

/** Jobs whose committed run was not projected yet (a crash right after the commit). */
async function findUnprojected({ limit = 100, olderThan = new Date(Date.now() - 30000) } = {}) {
  const col = await collection();
  return col.find({ projection: { $exists: true }, updatedAt: { $lt: olderThan } }).limit(limit).toArray();
}

const pendingOf = (orgId, integrationId, stageId) => ({
  orgId,
  integrationId: String(integrationId),
  ...(stageId ? { stageId } : {}),
});

/** Disabling a stage or integration pauses its pending work (not marked complete). */
async function pauseJobs(orgId, integrationId, stageId) {
  const col = await collection();
  const result = await col.updateMany(
    { ...pendingOf(orgId, integrationId, stageId), state: 'PENDING' },
    { $set: { state: 'PAUSED', pausedAt: new Date(), updatedAt: new Date() } }
  );
  return result.modifiedCount;
}

/** Resuming runs the next eligible check now; missed slots are not caught up (see schedule.js). */
async function resumeJobs(orgId, integrationId, stageId, now = new Date()) {
  const col = await collection();
  const result = await col.updateMany(
    { ...pendingOf(orgId, integrationId, stageId), state: 'PAUSED' },
    { $set: { state: 'PENDING', nextRunAt: now, resumedAt: now, updatedAt: now }, $unset: { pausedAt: 1 } }
  );
  return result.modifiedCount;
}

/** Deleting a stage cancels its pending work; history (stage_runs) is kept. */
async function cancelJobs(orgId, integrationId, stageId) {
  const col = await collection();
  const now = new Date();
  const result = await col.updateMany(
    { ...pendingOf(orgId, integrationId, stageId), state: { $in: ['PENDING', 'PAUSED', 'HANDOVER'] } },
    { $set: { state: 'CANCELLED', input: null, finishedAt: now, updatedAt: now, purgeAt: new Date(now.getTime() + KEEP_FINISHED_DAYS * DAY_MS) } }
  );
  return result.modifiedCount;
}

/**
 * Re-pin: move a stage's unclaimed pending jobs to its current definition, so a
 * fixed script reaches work already scheduled. A re-pin racing a claim loses (the
 * filter requires PENDING with no lease); keys and idempotency keys are unchanged.
 */
async function repinJobs(orgId, integrationId, stageId, definitionHash) {
  const col = await collection();
  const result = await col.updateMany(
    { ...pendingOf(orgId, integrationId, stageId), state: { $in: ['PENDING', 'PAUSED'] }, lease: null, definitionHash: { $ne: definitionHash } },
    { $set: { definitionHash, repinnedAt: new Date(), updatedAt: new Date() } }
  );
  return result.modifiedCount;
}

/** The stages that have paused work, as { orgId, integrationId, stageId } (small: paused jobs only). */
async function pausedGroups({ limit = 50 } = {}) {
  const col = await collection();
  const rows = await col
    .aggregate([
      { $match: { state: 'PAUSED' } },
      { $group: { _id: { orgId: '$orgId', integrationId: '$integrationId', stageId: '$stageId' } } },
      { $limit: limit },
    ])
    .toArray();
  return rows.map((row) => row._id);
}

/** Counts by state for a stage (console). */
async function countByState(orgId, integrationId, stageId) {
  const col = await collection();
  const rows = await col
    .aggregate([{ $match: pendingOf(orgId, integrationId, stageId) }, { $group: { _id: '$state', count: { $sum: 1 } } }])
    .toArray();
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

/**
 * Unfinished scheduled work of an integration grouped by stage, state and pinned
 * definition, as [{ stageId, state, definitionHash, count }] (what a save would
 * leave behind, edit, pause or cancel). Running jobs are not included: they hold
 * the definition they claimed.
 */
async function hashCounts(orgId, integrationId) {
  const col = await collection();
  const rows = await col
    .aggregate([
      { $match: { ...pendingOf(orgId, integrationId), state: { $in: ['PENDING', 'PAUSED', 'HANDOVER'] } } },
      { $group: { _id: { stageId: '$stageId', state: '$state', definitionHash: '$definitionHash' }, count: { $sum: 1 } } },
    ])
    .toArray();
  return rows.map((row) => ({ ...row._id, count: row.count }));
}

async function ensureJobIndexes(db, safeCreateIndexes = (col, specs) => col.createIndexes(specs)) {
  await safeCreateIndexes(db.collection(COLLECTION), [
    { key: { orgId: 1, deliveryId: 1, stageId: 1, trigger: 1, failureSeq: 1 }, unique: true, name: 'logical_key_unique' },
    { key: { state: 1, nextRunAt: 1 }, name: 'state_next_run_idx' },
    { key: { 'lease.until': 1 }, name: 'lease_until_idx', partialFilterExpression: { state: 'RUNNING' } },
    { key: { orgId: 1, integrationId: 1, stageId: 1 }, name: 'paused_idx', partialFilterExpression: { state: 'PAUSED' } },
    { key: { orgId: 1, integrationId: 1, stageId: 1, state: 1 }, name: 'org_integration_stage_state_idx' },
    { key: { updatedAt: 1 }, name: 'unprojected_idx', partialFilterExpression: { projection: { $exists: true } } },
    { key: { purgeAt: 1 }, expireAfterSeconds: 0, name: 'purge_ttl_idx' },
    { key: { state: 1, updatedAt: 1 }, name: 'shadow_uncompared_idx', partialFilterExpression: { shadow: true, compared: false } },
  ]);
}

module.exports = {
  createJob,
  claimDue,
  commit,
  clearProjection,
  findUnprojected,
  pauseJobs,
  resumeJobs,
  cancelJobs,
  repinJobs,
  pausedGroups,
  countByState,
  hashCounts,
  ensureJobIndexes,
  FINAL_STATES,
  LEASE_MS,
  KEEP_FINISHED_DAYS,
  COLLECTION,
};
