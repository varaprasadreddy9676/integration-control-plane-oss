'use strict';

/**
 * stage_runs: one masked record per stage execution (see recorder.js), the only
 * place request and response bodies are kept. Keyed by runId, so projecting a
 * run twice stores it once. Records expire after 30 days.
 */

const mongodb = require('../../mongodb');

const COLLECTION = 'stage_runs';
const RETENTION_DAYS = 30;

const collection = async () => (await mongodb.getDbSafe()).collection(COLLECTION);

// Mongo would store undefined as null; a record is plain JSON plus its dates.
const toDocument = (run) => ({
  ...JSON.parse(JSON.stringify(run)),
  _id: run.runId,
  at: new Date(run.at),
  acceptedAt: run.acceptedAt ? new Date(run.acceptedAt) : undefined,
});

/** Store a run once. Resolves to { inserted }: false when it was already there. */
async function insertRun(run) {
  const col = await collection();
  const doc = toDocument(run);
  if (doc.acceptedAt === undefined) delete doc.acceptedAt;
  try {
    const result = await col.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
    return { inserted: result.upsertedCount === 1 };
  } catch (error) {
    if (error.code === 11000) return { inserted: false };
    throw error;
  }
}

/** A delivery's runs, oldest first; optionally one stage's. */
async function listRuns(orgId, deliveryId, { stageId, limit = 200 } = {}) {
  const col = await collection();
  const query = { orgId, deliveryId: String(deliveryId) };
  if (stageId) query['stage.id'] = stageId;
  return col.find(query).sort({ at: 1 }).limit(limit).toArray();
}

/**
 * Execution metrics per stage, dated by run time: runs, errors, timeouts, retries
 * (runs that were not the first attempt of their check) and average duration.
 * Run records are kept 30 days, so this covers at most that.
 */
async function executionMetrics(orgId, { integrationId, stageId, from, to } = {}) {
  const col = await collection();
  const match = { orgId };
  if (integrationId) match.integrationId = String(integrationId);
  if (stageId) match['stage.id'] = stageId;
  if (from || to) {
    match.at = {};
    if (from) match.at.$gte = new Date(from);
    if (to) match.at.$lte = new Date(to);
  }
  const rows = await col
    .aggregate([
      { $match: match },
      {
        $group: {
          _id: '$stage.id',
          runs: { $sum: 1 },
          errors: { $sum: { $cond: [{ $eq: ['$outcome', 'error'] }, 1, 0] } },
          timeouts: { $sum: { $cond: [{ $eq: ['$outcome', 'timeout'] }, 1, 0] } },
          retries: { $sum: { $cond: [{ $gt: ['$executionAttempt', 1] }, 1, 0] } },
          averageMs: { $avg: '$durationMs' },
        },
      },
    ])
    .toArray();
  return rows.map(({ _id, averageMs, ...rest }) => ({ stageId: _id, ...rest, averageMs: averageMs === null ? null : Math.round(averageMs) }));
}

/**
 * What the stages of an integration did in [from, to], by stage, outcome, error
 * code and status word: the counts behind the canvas's branches. Shadow runs (a
 * migration comparing paths) are left out.
 */
async function flowCounts(orgId, integrationId, { from, to }) {
  const col = await collection();
  const rows = await col
    .aggregate([
      { $match: { orgId, integrationId: String(integrationId), shadow: { $ne: true }, at: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { stageId: '$stage.id', hook: '$stage.hook', outcome: '$outcome', errorCode: '$errorCode', status: '$status' },
          runs: { $sum: 1 },
        },
      },
    ])
    .toArray();
  return rows.map((row) => ({ ...row._id, runs: row.runs }));
}

async function getRun(orgId, runId) {
  const col = await collection();
  return col.findOne({ _id: runId, orgId });
}

module.exports = { insertRun, listRuns, getRun, executionMetrics, flowCounts, COLLECTION, RETENTION_DAYS };
