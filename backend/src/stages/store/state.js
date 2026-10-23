'use strict';

/**
 * The latest committed outcome of each stage of each delivery, in two places:
 *
 *   stage_state                 one document per (orgId, deliveryId, stageId); the
 *                               source of truth for results and filters, kept
 *                               like delivery logs (no TTL)
 *   execution_logs.stageSummary a tiny copy per stage on the delivery log, so list
 *                               rows show a tag without a join; never bodies
 *
 * Both advance only for a newer run: a higher seq (the logical check), or the
 * same seq run later (a replay). A late or repeated projection of an older run
 * changes nothing, so projecting is idempotent. A run that errored or timed out
 * says nothing new about the delivery: it updates the outcome and error, and the
 * last status and done stay as they were.
 */

const mongodb = require('../../mongodb');

const COLLECTION = 'stage_state';

const collection = async () => (await mongodb.getDbSafe()).collection(COLLECTION);

/** Mongo filter: the stored seq/at at `prefix` are older than this run's. */
function olderThan(prefix, seq, at) {
  return [{ [`${prefix}seq`]: { $exists: false } }, { [`${prefix}seq`]: { $lt: seq } }, { [`${prefix}seq`]: seq, [`${prefix}at`]: { $lt: at } }];
}

const failedRun = (run) => (run.outcome === 'error' || run.outcome === 'timeout') && (run.status === undefined || run.status === null);

const summaryOf = (run, at) => ({
  ...(failedRun(run) ? {} : { status: run.status === undefined ? null : run.status, done: Boolean(run.done) }),
  outcome: run.outcome,
  seq: run.seq,
  at,
});

/**
 * Advance stage_state for a run. `countRun` adds the run to the stage's run
 * count (pass it only when the run was newly stored, so a re-projection does
 * not count twice). Resolves to { advanced }.
 */
async function advanceState(run, { countRun = false } = {}) {
  const col = await collection();
  const at = new Date(run.at);
  const key = { orgId: run.orgId, deliveryId: String(run.deliveryId), stageId: run.stage.id };
  let advanced = false;
  try {
    const result = await col.updateOne(
      { ...key, $or: olderThan('', run.seq, at) },
      {
        $set: {
          ...summaryOf(run, at),
          integrationId: run.integrationId === undefined ? null : String(run.integrationId),
          hook: run.stage.hook,
          stageName: run.stage.name,
          definitionHash: run.stage.definitionHash,
          lastRunId: run.runId,
          error: run.error || null,
          ...(run.acceptedAt ? { acceptedAt: new Date(run.acceptedAt) } : {}),
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date(), runs: 0 },
      },
      { upsert: true }
    );
    advanced = result.modifiedCount === 1 || result.upsertedCount === 1;
  } catch (error) {
    if (error.code !== 11000) throw error; // the stored state is newer
  }
  if (countRun) await col.updateOne(key, { $inc: { runs: 1 } });
  return { advanced };
}

/** Advance the delivery log's summary for a run's stage. */
async function advanceSummary(run) {
  const id = mongodb.toObjectId(run.deliveryId);
  if (!id) return { advanced: false };
  const db = await mongodb.getDbSafe();
  const at = new Date(run.at);
  const field = `stageSummary.${run.stage.id}`;
  const result = await db
    .collection('execution_logs')
    .updateOne(
      { _id: id, orgId: run.orgId, $or: olderThan(`${field}.`, run.seq, at) },
      {
        $set: Object.fromEntries(
          Object.entries({ ...summaryOf(run, at), name: run.stage.name }).map(([key, value]) => [`${field}.${key}`, value])
        ),
      }
    );
  return { advanced: result.modifiedCount === 1 };
}

/**
 * Delivery outcomes: how many deliveries ended in each status, per stage (the
 * latest state, so three PENDING checks then DELIVERED count once, as DELIVERED).
 * Dated by the accepted-send time, or by the run time for inline stages.
 */
async function outcomeCounts(orgId, { integrationId, stageId, from, to } = {}) {
  const col = await collection();
  const match = { orgId };
  if (integrationId) match.integrationId = String(integrationId);
  if (stageId) match.stageId = stageId;
  if (from || to) {
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    match.$or = [{ acceptedAt: range }, { acceptedAt: { $exists: false }, at: range }];
  }
  const rows = await col
    .aggregate([{ $match: match }, { $group: { _id: { stageId: '$stageId', status: '$status', outcome: '$outcome' }, count: { $sum: 1 } } }])
    .toArray();
  return rows.map((row) => ({ stageId: row._id.stageId, status: row._id.status, outcome: row._id.outcome, deliveries: row.count }));
}

/** The latest state of each stage of a delivery. */
async function getStates(orgId, deliveryId) {
  const col = await collection();
  return col.find({ orgId, deliveryId: String(deliveryId) }).toArray();
}

module.exports = { advanceState, advanceSummary, getStates, outcomeCounts, COLLECTION };
