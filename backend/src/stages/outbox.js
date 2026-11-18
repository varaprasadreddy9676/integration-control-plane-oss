'use strict';

/**
 * Draining a delivery log's stage outbox (written with the attempt's status by
 * data/logs.js recordLog, see attempt.js):
 *
 *   stageOutbox      intents -> stage_jobs (one per logical key; creating twice
 *                    creates once)
 *   stageProjection  inline run records -> stage_runs, stage_state, the log's
 *                    summary (projectRun is idempotent)
 *
 * Each item is removed only after its effect is stored, so a crash at any point
 * repeats only idempotent writes. The send path drains right after its write;
 * the outbox worker drains whatever a crash left behind.
 *
 * on_failure intents get their failureSeq here, all intents of one terminal
 * failure the same number, in one atomic update of the log: the log's counter
 * and the intents change together, so a number is never given twice.
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');
const store = require('./store');
const jobs = require('./store/jobs');
const { normalizeStage } = require('./config');
const { firstRunAt, lastRunBy } = require('./schedule');

const LOGS = 'execution_logs';

async function assignFailureSeq(col, id, orgId, groupId) {
  await col.updateOne(
    { _id: id, orgId, stageOutbox: { $elemMatch: { groupId, failureSeq: { $exists: false } } } },
    [
      { $set: { stageFailureSeq: { $add: [{ $ifNull: ['$stageFailureSeq', 0] }, 1] } } },
      {
        $set: {
          stageOutbox: {
            $map: {
              input: '$stageOutbox',
              as: 'intent',
              in: {
                $cond: [
                  { $eq: ['$$intent.groupId', { $literal: groupId }] },
                  { $mergeObjects: ['$$intent', { failureSeq: '$stageFailureSeq' }] },
                  '$$intent',
                ],
              },
            },
          },
        },
      },
    ]
  );
}

async function jobFromIntent(orgId, deliveryId, intent) {
  const definition = await store.definitions.getDefinition(orgId, intent.definitionHash);
  const startedAt = new Date(intent.at);
  const base = {
    orgId,
    deliveryId,
    stageId: intent.stageId,
    // A shadow job (a migration comparing paths) has its own key, never the real one's.
    trigger: intent.shadow ? 'shadow' : intent.hook === 'after_delivery' ? 'accepted' : 'failure',
    failureSeq: intent.hook === 'on_failure' ? intent.failureSeq : 0,
    integrationId: intent.integrationId,
    integrationRevision: intent.integrationRevision,
    definitionHash: intent.definitionHash,
    acceptedAt: startedAt,
    input: intent.input,
    ...(intent.shadow ? { shadow: true } : {}),
  };
  if (!definition) {
    // Never expected (the send path stores definitions before writing intents);
    // keep it visible rather than retrying forever.
    log('error', 'Stage definition missing for an outbox intent', { orgId, deliveryId, stageId: intent.stageId });
    return { ...base, firstRunAt: startedAt, lastRunBy: startedAt, missingDefinition: true };
  }
  const stage = normalizeStage({ id: intent.stageId, name: intent.stageId, ...definition });
  return { ...base, firstRunAt: firstRunAt(stage, startedAt), lastRunBy: lastRunBy(stage, startedAt) };
}

/** Drain one delivery log's outbox. Safe to run concurrently and repeatedly. */
async function drainLog(orgId, logId) {
  const id = mongodb.toObjectId(logId);
  if (!id) return { jobs: 0, runs: 0 };
  const db = await mongodb.getDbSafe();
  const col = db.collection(LOGS);
  const projection = { stageOutbox: 1, stageProjection: 1 };

  let doc = await col.findOne({ _id: id, orgId }, { projection });
  if (!doc) return { jobs: 0, runs: 0 };

  const groups = new Set(
    (doc.stageOutbox || []).filter((intent) => intent.hook === 'on_failure' && !intent.failureSeq).map((intent) => intent.groupId)
  );
  for (const groupId of groups) await assignFailureSeq(col, id, orgId, groupId);
  if (groups.size) doc = await col.findOne({ _id: id, orgId }, { projection });

  const deliveryId = String(id);
  let created = 0;
  for (const intent of doc.stageOutbox || []) {
    if (intent.hook === 'on_failure' && !intent.failureSeq) continue; // assigned on the next pass
    const job = await jobFromIntent(orgId, deliveryId, intent);
    if (job.missingDefinition) {
      await col.updateOne({ _id: id, orgId }, { $pull: { stageOutbox: { intentId: intent.intentId } } });
      continue;
    }
    const result = await jobs.createJob(job);
    if (result.created) created += 1;
    await col.updateOne({ _id: id, orgId }, { $pull: { stageOutbox: { intentId: intent.intentId } } });
  }

  let projected = 0;
  for (const record of doc.stageProjection || []) {
    await store.projectRun({ ...record, orgId, deliveryId });
    await col.updateOne({ _id: id, orgId }, { $pull: { stageProjection: { runId: record.runId } } });
    projected += 1;
  }

  const empty = (field) => ({ $or: [{ [field]: { $exists: false } }, { [field]: { $size: 0 } }] });
  await col.updateOne(
    { _id: id, orgId, $and: [empty('stageOutbox'), empty('stageProjection')] },
    { $unset: { stageOutbox: 1, stageProjection: 1, stagePendingAt: 1 } }
  );
  return { jobs: created, runs: projected };
}

/** Logs with outbox work left behind (older than `olderThan`), for the outbox worker. */
async function findPendingLogs({ olderThan = new Date(Date.now() - 15000), limit = 100 } = {}) {
  const db = await mongodb.getDbSafe();
  return db
    .collection(LOGS)
    .find({ stagePendingAt: { $lt: olderThan } }, { projection: { _id: 1, orgId: 1 } })
    .limit(limit)
    .toArray();
}

async function ensureOutboxIndexes(db, safeCreateIndexes = (c, specs) => c.createIndexes(specs)) {
  // Partial: only logs with outbox work are in it, so it stays tiny.
  await safeCreateIndexes(db.collection(LOGS), [
    { key: { stagePendingAt: 1 }, name: 'stage_pending_idx', partialFilterExpression: { stagePendingAt: { $exists: true } } },
  ]);
}

module.exports = { drainLog, findPendingLogs, ensureOutboxIndexes };
