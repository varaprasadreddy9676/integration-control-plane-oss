'use strict';

/**
 * Questions the console asks of the delivery log that are about many deliveries
 * at once: how a time window of one integration's deliveries ended (the workflow
 * canvas's branch counts), and which other deliveries failed the same way as a
 * given one. The logs are read in place; nothing is stored.
 */

const mongodb = require('../mongodb');

const FAILED_STATUSES = ['FAILED', 'ABANDONED'];
const MAX_SIMILAR_SAMPLE = 10;
const MAX_SIMILAR_COUNT = 1000;
const MAX_WINDOW_MINUTES = 7 * 24 * 60;

/** Logs keep the integration as an ObjectId or its text, depending on when they were written. */
function integrationIdClause(integrationId) {
  const objectId = mongodb.toObjectId(integrationId);
  return objectId ? { $in: [objectId, String(integrationId)] } : String(integrationId);
}

const collection = async () => (await mongodb.getDbSafe()).collection('execution_logs');

/**
 * How the deliveries of one integration created in [from, to] ended, per delivery
 * target (actionIndex: null for an integration that sends once) and status, with the
 * attempts made and the retries among them (attempts after the first).
 */
async function deliveryCounts(orgId, integrationId, { from, to }) {
  const col = await collection();
  const attempts = { $ifNull: ['$attemptCount', 1] };
  const rows = await col
    .aggregate([
      { $match: { orgId, integrationConfigId: integrationIdClause(integrationId), createdAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { actionIndex: { $ifNull: ['$actionIndex', null] }, status: '$status' },
          deliveries: { $sum: 1 },
          attempts: { $sum: attempts },
          retries: { $sum: { $max: [{ $subtract: [attempts, 1] }, 0] } },
        },
      },
    ])
    .toArray();
  return rows.map((row) => ({ actionIndex: row._id.actionIndex, status: row._id.status, deliveries: row.deliveries, attempts: row.attempts, retries: row.retries }));
}

/**
 * The other deliveries that failed the same way as `log` (same integration and
 * delivery target, the same error code, or error category when there is no code)
 * within `minutes` of it, either side. Resolves to
 * { matchedOn, windowMinutes, count, capped, sample: [log id] }; matchedOn is null
 * when the log has nothing to match on.
 */
async function similarFailures(orgId, log, { minutes = 60 } = {}) {
  const windowMinutes = Math.min(Math.max(Math.floor(Number(minutes)) || 60, 1), MAX_WINDOW_MINUTES);
  const matchedOn = log.errorCode ? { errorCode: log.errorCode } : log.errorCategory ? { errorCategory: log.errorCategory } : null;
  const at = new Date(log.createdAt || log.startedAt || Date.now());
  if (!matchedOn || !log.integrationConfigId) return { matchedOn: null, windowMinutes, count: 0, capped: false, sample: [] };

  const filter = {
    orgId,
    integrationConfigId: integrationIdClause(log.integrationConfigId),
    status: { $in: FAILED_STATUSES },
    createdAt: { $gte: new Date(at.getTime() - windowMinutes * 60000), $lte: new Date(at.getTime() + windowMinutes * 60000) },
    _id: { $ne: log._id },
    ...matchedOn,
    ...(log.actionIndex === undefined || log.actionIndex === null ? {} : { actionIndex: log.actionIndex }),
  };
  const col = await collection();
  const [count, sample] = await Promise.all([
    col.countDocuments(filter, { limit: MAX_SIMILAR_COUNT + 1 }),
    col.find(filter, { projection: { _id: 1 } }).sort({ createdAt: -1 }).limit(MAX_SIMILAR_SAMPLE).toArray(),
  ]);
  return {
    matchedOn: Object.keys(matchedOn)[0],
    windowMinutes,
    count: Math.min(count, MAX_SIMILAR_COUNT),
    capped: count > MAX_SIMILAR_COUNT,
    sample: sample.map((doc) => String(doc._id)),
  };
}

module.exports = { deliveryCounts, similarFailures, integrationIdClause, FAILED_STATUSES, MAX_WINDOW_MINUTES };
