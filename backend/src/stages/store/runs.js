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

async function getRun(orgId, runId) {
  const col = await collection();
  return col.findOne({ _id: runId, orgId });
}

module.exports = { insertRun, listRuns, getRun, COLLECTION, RETENTION_DAYS };
