'use strict';

/**
 * The delivery follow-up queue (collection delivery_follow_ups): one small job
 * per accepted send that is being checked, and the write-back of each result
 * onto the delivery log (execution_logs.followUp).
 *
 * The queue is its own collection so the worker's "what is due" query never
 * touches the very large execution_logs collection. Jobs expire after 30 days.
 */

const mongodb = require('../mongodb');

const COLLECTION = 'delivery_follow_ups';
const LEASE_MS = 2 * 60 * 1000;
const RETENTION_DAYS = 30;

const collection = async () => (await mongodb.getDbSafe()).collection(COLLECTION);

async function enqueue(job) {
  const col = await collection();
  const result = await col.insertOne({ ...job, expiresAt: new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000) });
  return { ...job, _id: result.insertedId };
}

/**
 * Take the next job whose check is due and lease it for LEASE_MS, so two
 * workers never run the same check. A job whose lease ran out (a worker died
 * mid-check) becomes due again.
 */
async function claimDue(now = new Date()) {
  const col = await collection();
  const claimed = await col.findOneAndUpdate(
    {
      status: 'PENDING',
      nextCheckAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
    },
    { $set: { lockedUntil: new Date(now.getTime() + LEASE_MS) } },
    { sort: { nextCheckAt: 1 }, returnDocument: 'after' }
  );
  // Driver 4 returns the document, driver 3 wraps it as { value }.
  return claimed && Object.prototype.hasOwnProperty.call(claimed, 'value') ? claimed.value : claimed;
}

async function saveCheck(jobId, update) {
  const col = await collection();
  await col.updateOne({ _id: jobId }, { $set: update });
}

/** Store the follow-up outcome on the delivery log so the console can show it. */
async function markLog(orgId, logId, followUp) {
  const id = mongodb.toObjectId(logId);
  if (!id) return;
  const db = await mongodb.getDbSafe();
  await db.collection('execution_logs').updateOne({ _id: id, orgId }, { $set: { followUp } });
}

/**
 * Counts by delivery status for a period, optionally for one integration.
 * Read from the queue, which is small, rather than from execution_logs.
 */
async function getStats(orgId, { startDate, endDate, integrationId, integrationIds } = {}) {
  const match = { orgId };
  if (integrationId) match.integrationId = String(integrationId);
  else if (Array.isArray(integrationIds)) match.integrationId = { $in: integrationIds.map(String) };
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = startDate;
    if (endDate) match.createdAt.$lte = endDate;
  }
  const col = await collection();
  const [byStatus, errors] = await Promise.all([
    col.aggregate([{ $match: match }, { $group: { _id: '$deliveryStatus', count: { $sum: 1 } } }]).toArray(),
    col
      .aggregate([
        { $match: { ...match, deliveryStatus: 'FAILED' } },
        { $group: { _id: { code: '$errorCode', message: '$errorMessage' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray(),
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map((row) => [row._id || 'PENDING', row.count])),
    topErrors: errors.map((row) => ({ code: row._id.code || null, message: row._id.message || null, count: row.count })),
  };
}

module.exports = { COLLECTION, enqueue, claimDue, saveCheck, markLog, getStats };
