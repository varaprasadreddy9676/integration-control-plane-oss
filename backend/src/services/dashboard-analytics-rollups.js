'use strict';

const crypto = require('crypto');
const { uuidv4 } = require('../utils/runtime');
const { log } = require('../logger');

const ROLLUP_COLLECTION = 'dashboard_analytics_rollups';
const ROLLUP_META_COLLECTION = 'dashboard_analytics_rollup_meta';
const ROLLUP_LOCK_COLLECTION = 'dashboard_analytics_rollup_locks';
const BUCKET_TYPE_HOUR = 'HOUR';
const BUCKET_TYPE_DAY = 'DAY';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RESPONSE_BUCKETS = [0, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 1000000000];
const STATUS_VALUES = {
  successful: ['SUCCESS', 'success'],
  failed: ['FAILED', 'failed', 'ABANDONED', 'abandoned'],
  skipped: ['SKIPPED', 'skipped'],
  retrying: ['RETRYING', 'retrying'],
  pending: ['PENDING', 'pending', 'QUEUED', 'queued'],
};

function bucketFormat(bucketType) {
  return bucketType === BUCKET_TYPE_DAY ? '%Y-%m-%dT00:00:00.000Z' : '%Y-%m-%dT%H:00:00.000Z';
}

function bucketExpression(bucketType) {
  return {
    $dateToString: {
      format: bucketFormat(bucketType),
      date: '$startedAt',
      timezone: 'UTC',
    },
  };
}

function responseBucketExpression() {
  const branches = RESPONSE_BUCKETS.slice(0, -1).map((upperBound, index) => ({
    case: { $lt: [{ $ifNull: ['$durationMs', 0] }, RESPONSE_BUCKETS[index + 1]] },
    then: index,
  }));

  return {
    $switch: {
      branches,
      default: RESPONSE_BUCKETS.length - 2,
    },
  };
}

function statusCount(field, values) {
  return {
    $sum: {
      $cond: [{ $in: [`$${field}`, values] }, 1, 0],
    },
  };
}

function positiveDurationExpression() {
  return { $gt: [{ $ifNull: ['$durationMs', 0] }, 0] };
}

function responseSumExpression(successOnly = false) {
  const condition = successOnly
    ? { $and: [{ $in: ['$status', STATUS_VALUES.successful] }, positiveDurationExpression()] }
    : positiveDurationExpression();
  return {
    $sum: {
      $cond: [condition, { $ifNull: ['$durationMs', 0] }, 0],
    },
  };
}

function responseCountExpression(successOnly = false) {
  const condition = successOnly
    ? { $and: [{ $in: ['$status', STATUS_VALUES.successful] }, positiveDurationExpression()] }
    : positiveDurationExpression();
  return { $sum: { $cond: [condition, 1, 0] } };
}

function responseMinExpression(successOnly = false) {
  const condition = successOnly
    ? { $and: [{ $in: ['$status', STATUS_VALUES.successful] }, positiveDurationExpression()] }
    : positiveDurationExpression();
  // Use a high sentinel instead of null. MongoDB's BSON ordering can make a
  // null win over a real duration when a bucket contains mixed statuses.
  return { $min: { $cond: [condition, '$durationMs', 1000000000000] } };
}

function responseMaxExpression(successOnly = false) {
  const condition = successOnly
    ? { $and: [{ $in: ['$status', STATUS_VALUES.successful] }, positiveDurationExpression()] }
    : positiveDurationExpression();
  return { $max: { $cond: [condition, '$durationMs', null] } };
}

function metricGroup(id) {
  return {
    _id: id,
    total: { $sum: 1 },
    successful: statusCount('status', STATUS_VALUES.successful),
    failed: statusCount('status', STATUS_VALUES.failed),
    skipped: statusCount('status', STATUS_VALUES.skipped),
    retrying: statusCount('status', STATUS_VALUES.retrying),
    pending: statusCount('status', STATUS_VALUES.pending),
    responseTimeSum: responseSumExpression(false),
    responseTimeCount: responseCountExpression(false),
    lastSeen: { $max: '$startedAt' },
  };
}

function buildRollupPipeline({ orgId, start, end, bucketType }) {
  const bucket = bucketExpression(bucketType);
  const responseBucket = responseBucketExpression();

  return [
    {
      $match: {
        orgId,
        startedAt: { $gte: start, $lte: end },
      },
    },
    {
      $facet: {
        summary: [
          {
            $group: {
              ...metricGroup(bucket),
              successfulResponseTimeSum: responseSumExpression(true),
              successfulResponseTimeCount: responseCountExpression(true),
              minResponseTime: responseMinExpression(false),
              maxResponseTime: responseMaxExpression(false),
              successfulMinResponseTime: responseMinExpression(true),
              successfulMaxResponseTime: responseMaxExpression(true),
            },
          },
        ],
        summaryBuckets: [
          { $match: { durationMs: { $gt: 0 } } },
          { $group: { _id: { bucketStart: bucket, bucket: responseBucket }, count: { $sum: 1 } } },
        ],
        successfulBuckets: [
          { $match: { status: { $in: STATUS_VALUES.successful }, durationMs: { $gt: 0 } } },
          { $group: { _id: { bucketStart: bucket, bucket: responseBucket }, count: { $sum: 1 } } },
        ],
        eventTypes: [
          {
            $group: metricGroup({ bucketStart: bucket, eventType: '$eventType' }),
          },
        ],
        integrations: [
          {
            $group: {
              ...metricGroup({
                bucketStart: bucket,
                integrationConfigId: '$integrationConfigId',
                integrationName: '$integrationName',
              }),
            },
          },
        ],
        errors: [
          { $match: { status: { $in: ['FAILED', 'failed'] } } },
          {
            $group: {
              _id: {
                bucketStart: bucket,
                message: { $ifNull: ['$errorMessage', 'Unknown error'] },
                status: '$response.statusCode',
                integrationId: '$integrationConfigId',
                integrationName: '$integrationName',
              },
              count: { $sum: 1 },
              lastSeen: { $max: '$startedAt' },
            },
          },
        ],
      },
    },
  ];
}

function dateFromBucket(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stableDimensionKey(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

function documentId(orgId, bucketType, bucketStart, kind, dimension) {
  return `${orgId}:${bucketType}:${bucketStart.toISOString()}:${kind}:${stableDimensionKey(dimension || {})}`;
}

function zeros() {
  return new Array(RESPONSE_BUCKETS.length - 1).fill(0);
}

function addBucket(target, bucket, count) {
  const index = Number(bucket);
  if (Number.isInteger(index) && index >= 0 && index < target.length) {
    target[index] += count || 0;
  }
}

function baseDocument({ orgId, bucketType, buildId, bucketStart, kind, dimension, metrics }) {
  return {
    _id: documentId(orgId, bucketType, bucketStart, kind, dimension),
    orgId,
    bucketType,
    bucketStart,
    kind,
    dimension: dimension || {},
    metrics,
    buildId,
    updatedAt: new Date(),
  };
}

function copyMetrics(item) {
  const normalizeMin = (value) => (value >= 1000000000000 ? 0 : value || 0);
  return {
    total: item.total || 0,
    successful: item.successful || 0,
    failed: item.failed || 0,
    skipped: item.skipped || 0,
    retrying: item.retrying || 0,
    pending: item.pending || 0,
    responseTimeSum: item.responseTimeSum || 0,
    responseTimeCount: item.responseTimeCount || 0,
    successfulResponseTimeSum: item.successfulResponseTimeSum || 0,
    successfulResponseTimeCount: item.successfulResponseTimeCount || 0,
    minResponseTime: normalizeMin(item.minResponseTime),
    maxResponseTime: item.maxResponseTime || 0,
    successfulMinResponseTime: normalizeMin(item.successfulMinResponseTime),
    successfulMaxResponseTime: item.successfulMaxResponseTime || 0,
    lastSeen: item.lastSeen || null,
  };
}

function buildRollupDocuments(orgId, bucketType, buildId, facets) {
  const responseBuckets = new Map();
  const successfulBuckets = new Map();

  for (const item of facets.summaryBuckets || []) {
    const start = dateFromBucket(item._id?.bucketStart);
    if (!start) continue;
    if (!responseBuckets.has(start.toISOString())) responseBuckets.set(start.toISOString(), zeros());
    addBucket(responseBuckets.get(start.toISOString()), item._id?.bucket, item.count);
  }

  for (const item of facets.successfulBuckets || []) {
    const start = dateFromBucket(item._id?.bucketStart);
    if (!start) continue;
    if (!successfulBuckets.has(start.toISOString())) successfulBuckets.set(start.toISOString(), zeros());
    addBucket(successfulBuckets.get(start.toISOString()), item._id?.bucket, item.count);
  }

  const documents = [];
  for (const item of facets.summary || []) {
    const bucketStart = dateFromBucket(item._id);
    if (!bucketStart) continue;
    const key = bucketStart.toISOString();
    const metrics = copyMetrics(item);
    metrics.responseBuckets = responseBuckets.get(key) || zeros();
    metrics.successfulResponseBuckets = successfulBuckets.get(key) || zeros();
    const doc = baseDocument({ orgId, bucketType, buildId, bucketStart, kind: 'SUMMARY', metrics });
    documents.push(doc);
  }

  for (const item of facets.eventTypes || []) {
    const bucketStart = dateFromBucket(item._id?.bucketStart);
    if (!bucketStart || !item._id?.eventType) continue;
    documents.push(
      baseDocument({
        orgId,
        bucketType,
        buildId,
        bucketStart,
        kind: 'EVENT_TYPE',
        dimension: { eventType: item._id.eventType },
        metrics: copyMetrics(item),
      })
    );
  }

  for (const item of facets.integrations || []) {
    const bucketStart = dateFromBucket(item._id?.bucketStart);
    if (!bucketStart || !item._id?.integrationConfigId) continue;
    documents.push(
      baseDocument({
        orgId,
        bucketType,
        buildId,
        bucketStart,
        kind: 'INTEGRATION',
        dimension: {
          integrationConfigId: item._id.integrationConfigId,
          integrationName: item._id.integrationName || null,
        },
        metrics: copyMetrics(item),
      })
    );
  }

  for (const item of facets.errors || []) {
    const bucketStart = dateFromBucket(item._id?.bucketStart);
    if (!bucketStart) continue;
    documents.push(
      baseDocument({
        orgId,
        bucketType,
        buildId,
        bucketStart,
        kind: 'ERROR',
        dimension: {
          message: item._id.message || 'Unknown error',
          status: item._id.status ?? null,
          integrationId: item._id.integrationId || null,
          integrationName: item._id.integrationName || null,
        },
        metrics: {
          count: item.count || 0,
          lastSeen: item.lastSeen || null,
        },
      })
    );
  }

  return documents;
}

function floorHour(date) {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

function ceilHour(date) {
  return new Date(Math.ceil(date.getTime() / HOUR_MS) * HOUR_MS);
}

function getFullHourRange(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || start >= end) return null;

  const fullStart = ceilHour(start);
  const candidateLastFullStart = floorHour(end);
  const candidateEnd = new Date(candidateLastFullStart.getTime() + HOUR_MS - 1);
  const lastFullStart =
    candidateEnd <= end ? candidateLastFullStart : new Date(candidateLastFullStart.getTime() - HOUR_MS);
  const fullEnd = new Date(lastFullStart.getTime() + HOUR_MS - 1);

  if (fullStart > fullEnd) return null;

  return {
    fullStart,
    fullEnd,
    leftEnd: new Date(fullStart.getTime() - 1),
    rightStart: new Date(fullEnd.getTime() + 1),
  };
}

function metaId(orgId, bucketType) {
  return `${orgId}:${bucketType}`;
}

async function ensureIndexes(db) {
  await Promise.all([
    db.collection(ROLLUP_COLLECTION).createIndexes([
      { key: { orgId: 1, bucketType: 1, bucketStart: 1, buildId: 1 }, name: 'org_bucket_start_build_idx' },
      { key: { orgId: 1, bucketType: 1, kind: 1, bucketStart: 1 }, name: 'org_bucket_kind_start_idx' },
    ]),
    db
      .collection(ROLLUP_META_COLLECTION)
      .createIndex({ orgId: 1, bucketType: 1 }, { unique: true, name: 'org_bucket_meta_unique_idx' }),
    db
      .collection(ROLLUP_LOCK_COLLECTION)
      .createIndex({ lockedUntil: 1 }, { expireAfterSeconds: 0, name: 'rollup_lock_ttl_idx' }),
  ]);
}

async function getRollupMeta(db, orgId, bucketType = BUCKET_TYPE_HOUR) {
  return db.collection(ROLLUP_META_COLLECTION).findOne({ _id: metaId(orgId, bucketType) });
}

async function hasCoverage(db, orgId, start, end, bucketType = BUCKET_TYPE_HOUR) {
  const meta = await getRollupMeta(db, orgId, bucketType);
  if (!meta || meta.state !== 'READY' || meta.refreshInProgress) return false;
  return (
    meta.coverageStart instanceof Date &&
    meta.coverageEnd instanceof Date &&
    meta.coverageStart <= start &&
    meta.coverageEnd >= end
  );
}

async function loadRollupDocuments(db, orgId, start, end, bucketType, kind) {
  const meta = await getRollupMeta(db, orgId, bucketType);
  if (!meta || meta.state !== 'READY' || meta.refreshInProgress) return null;
  if (!(meta.coverageStart instanceof Date) || !(meta.coverageEnd instanceof Date)) return null;
  if (meta.coverageStart > start || meta.coverageEnd < end) return null;

  return db
    .collection(ROLLUP_COLLECTION)
    .find({
      orgId,
      bucketType,
      kind,
      bucketStart: { $gte: start, $lte: end },
    })
    .sort({ bucketStart: 1 })
    .toArray();
}

async function writeDocuments(db, documents) {
  if (documents.length === 0) return;
  const collection = db.collection(ROLLUP_COLLECTION);
  for (let offset = 0; offset < documents.length; offset += 500) {
    const batch = documents.slice(offset, offset + 500);
    await collection.bulkWrite(
      batch.map((document) => ({
        replaceOne: {
          filter: { _id: document._id },
          replacement: document,
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
}

async function rebuildRollupForOrg(db, orgId, { start, end, bucketType, logger = log } = {}) {
  if (!start || !end || start >= end) throw new Error('A valid rollup start and end are required');
  const buildId = uuidv4();
  const collection = db.collection(ROLLUP_COLLECTION);
  const metaCollection = db.collection(ROLLUP_META_COLLECTION);
  const id = metaId(orgId, bucketType);
  const existingMeta = await getRollupMeta(db, orgId, bucketType);

  await metaCollection.updateOne(
    { _id: id },
    {
      $set: {
        orgId,
        bucketType,
        refreshInProgress: true,
        refreshStartedAt: new Date(),
      },
      $setOnInsert: { state: 'BUILDING', createdAt: new Date() },
    },
    { upsert: true }
  );

  try {
    const facets = await db
      .collection('execution_logs')
      .aggregate(buildRollupPipeline({ orgId, start, end, bucketType }), {
        allowDiskUse: true,
        hint: 'org_started_idx',
        maxTimeMS: 120000,
      })
      .toArray();
    const documents = buildRollupDocuments(orgId, bucketType, buildId, facets[0] || {});

    await collection.deleteMany({ orgId, bucketType, bucketStart: { $gte: start, $lte: end } });
    await writeDocuments(db, documents);
    await metaCollection.updateOne(
      { _id: id },
      {
        $set: {
          orgId,
          bucketType,
          buildId,
          state: 'READY',
          coverageStart:
            existingMeta?.coverageStart instanceof Date && existingMeta.coverageStart < start
              ? existingMeta.coverageStart
              : start,
          coverageEnd:
            existingMeta?.coverageEnd instanceof Date && existingMeta.coverageEnd > end
              ? existingMeta.coverageEnd
              : end,
          lastBuiltAt: new Date(),
          refreshInProgress: false,
          refreshCompletedAt: new Date(),
          documentCount: documents.length,
        },
      },
      { upsert: true }
    );
    return { orgId, bucketType, buildId, documentCount: documents.length };
  } catch (error) {
    await metaCollection.updateOne(
      { _id: id },
      { $set: { state: 'ERROR', refreshInProgress: false, lastError: error.message, lastErrorAt: new Date() } }
    );
    logger('error', 'Dashboard analytics rollup rebuild failed', { orgId, bucketType, error: error.message });
    throw error;
  }
}

function mergeMetricDocuments(documents) {
  const result = {
    total: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    retrying: 0,
    pending: 0,
    responseTimeSum: 0,
    responseTimeCount: 0,
    successfulResponseTimeSum: 0,
    successfulResponseTimeCount: 0,
    minResponseTime: 0,
    maxResponseTime: 0,
    successfulMinResponseTime: 0,
    successfulMaxResponseTime: 0,
    responseBuckets: zeros(),
    successfulResponseBuckets: zeros(),
    lastSeen: null,
  };

  for (const document of documents) {
    const metrics = document.metrics || {};
    for (const field of [
      'total',
      'successful',
      'failed',
      'skipped',
      'retrying',
      'pending',
      'responseTimeSum',
      'responseTimeCount',
      'successfulResponseTimeSum',
      'successfulResponseTimeCount',
    ]) {
      result[field] += metrics[field] || 0;
    }
    for (let i = 0; i < result.responseBuckets.length; i += 1) {
      result.responseBuckets[i] += metrics.responseBuckets?.[i] || 0;
      result.successfulResponseBuckets[i] += metrics.successfulResponseBuckets?.[i] || 0;
    }
    for (const field of ['minResponseTime', 'successfulMinResponseTime']) {
      if (metrics[field] > 0 && (!result[field] || metrics[field] < result[field])) result[field] = metrics[field];
    }
    for (const field of ['maxResponseTime', 'successfulMaxResponseTime']) {
      if (metrics[field] > result[field]) result[field] = metrics[field];
    }
    if (metrics.lastSeen && (!result.lastSeen || new Date(metrics.lastSeen) > new Date(result.lastSeen))) {
      result.lastSeen = metrics.lastSeen;
    }
  }
  return result;
}

async function getOverviewFromRollups(db, orgId, start, end) {
  const documents = await loadRollupDocuments(db, orgId, start, end, BUCKET_TYPE_HOUR, 'SUMMARY');
  if (!documents) return null;
  const metrics = mergeMetricDocuments(documents);
  const eventDocuments = await loadRollupDocuments(db, orgId, start, end, BUCKET_TYPE_HOUR, 'EVENT_TYPE');
  const integrationDocuments = await loadRollupDocuments(db, orgId, start, end, BUCKET_TYPE_HOUR, 'INTEGRATION');

  const eventMap = new Map();
  for (const document of eventDocuments || []) {
    const key = document.dimension?.eventType;
    if (!key) continue;
    const current = eventMap.get(key) || { ...copyMetrics({}), responseTimeSum: 0, responseTimeCount: 0 };
    const combined = mergeMetricDocuments([{ metrics: current }, document]);
    eventMap.set(key, combined);
  }

  const integrationMap = new Map();
  for (const document of integrationDocuments || []) {
    const key = document.dimension?.integrationConfigId ? String(document.dimension.integrationConfigId) : null;
    if (!key) continue;
    const current = integrationMap.get(key) || { ...copyMetrics({}), responseTimeSum: 0, responseTimeCount: 0 };
    const combined = mergeMetricDocuments([{ metrics: current }, document]);
    combined.integrationConfigId = key;
    combined.integrationName = combined.integrationName || document.dimension.integrationName || null;
    integrationMap.set(key, combined);
  }

  return {
    statusAgg: [
      { _id: 'SUCCESS', count: metrics.successful },
      { _id: 'FAILED', count: metrics.failed },
      { _id: 'SKIPPED', count: metrics.skipped },
      { _id: 'RETRYING', count: metrics.retrying },
      { _id: 'PENDING', count: metrics.pending },
    ].filter((item) => item.count > 0),
    total: metrics.total,
    eventTypeAgg: Array.from(eventMap.entries()).map(([eventType, value]) => ({ _id: eventType, ...value })),
    integrationAgg: Array.from(integrationMap.values()).map((value) => ({
      _id: value.integrationConfigId,
      integrationName: value.integrationName,
      ...value,
    })),
    responseAgg: {
      avgResponseTime: metrics.responseTimeCount > 0 ? metrics.responseTimeSum / metrics.responseTimeCount : 0,
      responseTimeCount: metrics.responseTimeCount,
    },
    bucketAgg: metrics.responseBuckets
      .map((count, index) => ({ _id: RESPONSE_BUCKETS[index + 1], count }))
      .filter((item) => item.count > 0),
  };
}

async function getTimeseriesFromRollups(db, orgId, start, end, interval) {
  const documents = await loadRollupDocuments(db, orgId, start, end, BUCKET_TYPE_HOUR, 'SUMMARY');
  if (!documents) return null;
  const series = new Map();
  for (const document of documents) {
    const key =
      interval === 'day'
        ? new Date(
            Date.UTC(
              document.bucketStart.getUTCFullYear(),
              document.bucketStart.getUTCMonth(),
              document.bucketStart.getUTCDate()
            )
          ).toISOString()
        : document.bucketStart.toISOString();
    const current = series.get(key) || { _id: key, metrics: [] };
    current.metrics.push(document);
    series.set(key, current);
  }
  return Array.from(series.values()).map((item) => {
    const metrics = mergeMetricDocuments(item.metrics);
    return {
      _id: item._id,
      total: metrics.total,
      successful: metrics.successful,
      failed: metrics.failed,
      skipped: metrics.skipped,
      responseTimeSum: metrics.responseTimeSum,
      responseTimeCount: metrics.responseTimeCount,
    };
  });
}

async function getErrorsFromRollups(db, orgId, start, end) {
  const documents = await loadRollupDocuments(db, orgId, start, end, BUCKET_TYPE_HOUR, 'ERROR');
  if (!documents) return null;
  return documents.map((document) => ({
    _id: {
      message: document.dimension?.message || 'Unknown error',
      status: document.dimension?.status,
      integrationId: document.dimension?.integrationId,
      integrationName: document.dimension?.integrationName,
    },
    count: document.metrics?.count || 0,
    lastSeen: document.metrics?.lastSeen || null,
  }));
}

async function getPerformanceFromRollups(db, orgId, start, end) {
  const documents = await loadRollupDocuments(db, orgId, start, end, BUCKET_TYPE_HOUR, 'SUMMARY');
  if (!documents) return null;
  const metrics = mergeMetricDocuments(documents);
  return {
    totalRequests: metrics.total,
    successfulRequests: metrics.successful,
    responseAgg: {
      avgResponseTime:
        metrics.successfulResponseTimeCount > 0
          ? metrics.successfulResponseTimeSum / metrics.successfulResponseTimeCount
          : 0,
      minResponseTime: metrics.successfulMinResponseTime || 0,
      maxResponseTime: metrics.successfulMaxResponseTime || 0,
      responseTimeCount: metrics.successfulResponseTimeCount,
    },
    bucketAgg: metrics.successfulResponseBuckets
      .map((count, index) => ({ _id: RESPONSE_BUCKETS[index + 1], count }))
      .filter((item) => item.count > 0),
  };
}

async function acquireLock(db, key, ttlMs = 10 * 60 * 1000) {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + ttlMs);
  try {
    const result = await db.collection(ROLLUP_LOCK_COLLECTION).findOneAndUpdate(
      {
        _id: key,
        $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }],
      },
      { $set: { lockedUntil: lockUntil, acquiredAt: now } },
      { upsert: true, returnDocument: 'after' }
    );
    return Boolean(result.value);
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

async function releaseLock(db, key) {
  await db
    .collection(ROLLUP_LOCK_COLLECTION)
    .updateOne({ _id: key }, { $set: { lockedUntil: new Date(0), releasedAt: new Date() } });
}

function getConfigNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseOrgFilter() {
  const raw = String(process.env.DASHBOARD_ANALYTICS_ROLLUP_ORGS || '').trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => (Number.isNaN(Number(value)) ? value : Number(value)))
  );
}

function startDashboardAnalyticsRollupWorker({ mongodb, config, logger = log } = {}) {
  // Opt in during rollout. Routes always retain their raw aggregation fallback,
  // so enabling the worker is an operational change rather than a correctness risk.
  if (String(process.env.DASHBOARD_ANALYTICS_ROLLUPS_ENABLED || 'false').toLowerCase() !== 'true') {
    return () => {
      // Disabled until explicitly enabled during rollout.
    };
  }

  const intervalMs = getConfigNumber(process.env.DASHBOARD_ANALYTICS_ROLLUP_INTERVAL_MS, 5 * 60 * 1000);
  const lookbackDays = getConfigNumber(process.env.DASHBOARD_ANALYTICS_ROLLUP_LOOKBACK_DAYS, 100);
  const refreshHours = getConfigNumber(process.env.DASHBOARD_ANALYTICS_ROLLUP_REFRESH_HOURS, 48);
  let stopped = false;
  let running = false;
  let timer = null;

  async function runCycle() {
    if (stopped || running) return;
    running = true;
    try {
      const db = await mongodb.getDbSafe();
      await ensureIndexes(db);
      const orgFilter = parseOrgFilter();
      const orgIds = (await db.collection('execution_logs').distinct('orgId')).filter(
        (orgId) => !orgFilter || orgFilter.has(orgId) || orgFilter.has(String(orgId))
      );
      const now = new Date();
      for (const orgId of orgIds) {
        if (stopped) break;
        const lockKey = `dashboard-rollup:${orgId}`;
        if (!(await acquireLock(db, lockKey))) continue;
        try {
          const existing = await getRollupMeta(db, orgId, BUCKET_TYPE_HOUR);
          const start =
            existing?.state === 'READY' && existing.coverageStart
              ? new Date(Math.max(existing.coverageStart.getTime(), now.getTime() - refreshHours * HOUR_MS))
              : new Date(now.getTime() - lookbackDays * DAY_MS);
          const hourlyResult = await rebuildRollupForOrg(db, orgId, {
            start,
            end: now,
            bucketType: BUCKET_TYPE_HOUR,
            logger,
          });
          logger('info', 'Dashboard analytics hourly rollup rebuilt', hourlyResult);

          const existingDay = await getRollupMeta(db, orgId, BUCKET_TYPE_DAY);
          const dayStart =
            existingDay?.state === 'READY' && existingDay.coverageStart
              ? new Date(Math.max(existingDay.coverageStart.getTime(), now.getTime() - refreshHours * HOUR_MS))
              : new Date(now.getTime() - lookbackDays * DAY_MS);
          const dailyResult = await rebuildRollupForOrg(db, orgId, {
            start: dayStart,
            end: now,
            bucketType: BUCKET_TYPE_DAY,
            logger,
          });
          logger('info', 'Dashboard analytics daily rollup rebuilt', dailyResult);
        } finally {
          await releaseLock(db, lockKey);
        }
      }
    } catch (error) {
      logger('error', 'Dashboard analytics rollup cycle failed', { error: error.message });
    } finally {
      running = false;
    }
  }

  timer = setTimeout(() => {
    runCycle();
    timer = setInterval(runCycle, intervalMs);
  }, 15000);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
    }
  };
}

module.exports = {
  ROLLUP_COLLECTION,
  ROLLUP_META_COLLECTION,
  ROLLUP_LOCK_COLLECTION,
  BUCKET_TYPE_HOUR,
  BUCKET_TYPE_DAY,
  RESPONSE_BUCKETS,
  buildRollupPipeline,
  buildRollupDocuments,
  getFullHourRange,
  ensureIndexes,
  getRollupMeta,
  hasCoverage,
  loadRollupDocuments,
  rebuildRollupForOrg,
  getOverviewFromRollups,
  getTimeseriesFromRollups,
  getErrorsFromRollups,
  getPerformanceFromRollups,
  acquireLock,
  releaseLock,
  startDashboardAnalyticsRollupWorker,
};
