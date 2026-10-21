'use strict';

const express = require('express');
const { log } = require('../logger');
const mongodb = require('../mongodb');
const asyncHandler = require('../utils/async-handler');
const dashboardRollups = require('../services/dashboard-analytics-rollups');

const router = express.Router();

const RESPONSE_BUCKETS = [0, 100, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 1000000000];
const RESPONSE_BUCKET_LABELS = [
  '< 100ms',
  '100-500ms',
  '500ms-1s',
  '1-2s',
  '2-5s',
  '5-10s',
  '10-30s',
  '30-60s',
  '1-2m',
  '2-5m',
  '5-10m',
  '> 10m',
];

// ── Analytics cache ────────────────────────────────────────────────────────────
// Cache expensive aggregation results per (orgId + filter params) for 5 minutes.
// Stale-while-revalidate: stale entries are returned immediately while a background
// refresh warms the cache for the next request. Prevents demo-killing cold queries.
const _analyticsCache = new Map();
const ANALYTICS_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const ANALYTICS_CACHE_MAX_SIZE = 500; // one entry per org+filter combo; negligible RAM
const _analyticsRefreshInProgress = new Set();

function _evictAnalyticsCache() {
  if (_analyticsCache.size < ANALYTICS_CACHE_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of _analyticsCache) {
    if (now - entry.ts >= ANALYTICS_CACHE_TTL_MS) _analyticsCache.delete(key);
  }
  // Still over limit — evict oldest entry
  if (_analyticsCache.size >= ANALYTICS_CACHE_MAX_SIZE) {
    let oldest = null;
    for (const [key, entry] of _analyticsCache) {
      if (!oldest || entry.ts < oldest[1].ts) oldest = [key, entry];
    }
    if (oldest) _analyticsCache.delete(oldest[0]);
  }
}

function _analyticsKey(orgId, endpoint, q) {
  return `${orgId}|${endpoint}|${q.days || ''}|${q.startDate || ''}|${q.endDate || ''}|${q.direction || ''}|${q.triggerType || ''}|${q.integrationId || ''}|${q.provider || ''}|${q.interval || ''}`;
}

/**
 * `shouldCache(value)` lets an endpoint skip caching a result. The dashboard
 * uses it for empty results: they are cheap to recompute, and caching them hid
 * an org's first deliveries for up to five minutes.
 */
async function _withAnalyticsCache(key, fetchFn, { shouldCache = () => true } = {}) {
  const cached = _analyticsCache.get(key);
  const now = Date.now();
  if (cached) {
    if (now - cached.ts < ANALYTICS_CACHE_TTL_MS) return cached.value; // fresh
    // Stale-while-revalidate: return old value immediately, refresh in background
    if (!_analyticsRefreshInProgress.has(key)) {
      _analyticsRefreshInProgress.add(key);
      fetchFn()
        .then((value) => {
          _evictAnalyticsCache();
          if (shouldCache(value)) _analyticsCache.set(key, { ts: Date.now(), value });
          else _analyticsCache.delete(key);
        })
        .catch((err) => log('error', 'analytics:bgRefresh failed', { key, err: err.message }))
        .finally(() => _analyticsRefreshInProgress.delete(key));
    }
    return cached.value;
  }
  // Cold start — must wait for the query
  const value = await fetchFn();
  _evictAnalyticsCache();
  if (shouldCache(value)) _analyticsCache.set(key, { ts: Date.now(), value });
  return value;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeStatus(status) {
  if (!status) return '';
  return String(status).toUpperCase();
}

function addCount(map, key, value) {
  if (!key) return;
  map[key] = (map[key] || 0) + value;
}

function mergeBuckets(target, buckets) {
  for (const bucket of buckets) {
    const idx = bucket.index;
    target[idx] = (target[idx] || 0) + bucket.count;
  }
}

function computePercentileFromBuckets(bucketCounts, total, percentile) {
  if (!total || total <= 0) return 0;
  const target = total * percentile;
  let cumulative = 0;
  for (let i = 0; i < bucketCounts.length; i++) {
    cumulative += bucketCounts[i] || 0;
    if (cumulative >= target) {
      return RESPONSE_BUCKETS[i + 1] || RESPONSE_BUCKETS[RESPONSE_BUCKETS.length - 1];
    }
  }
  return RESPONSE_BUCKETS[RESPONSE_BUCKETS.length - 1];
}

function getDateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return { start, end };
}

function parseDateFilters(req) {
  const { startDate, endDate } = req.query;
  let start;
  let end;

  if (startDate) {
    start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      throw new Error('Invalid startDate format');
    }
  }

  if (endDate) {
    end = new Date(endDate);
    if (Number.isNaN(end.getTime())) {
      throw new Error('Invalid endDate format');
    }
  }

  return { start, end };
}

function normalizeTriggerTypeFilter(triggerType) {
  if (!triggerType) return null;
  if (triggerType === 'SCHEDULED') {
    return { $in: ['SCHEDULED', 'SCHEDULE'] };
  }
  return triggerType;
}

async function enrichIntegrationNames(db, orgId, integrations) {
  if (!Array.isArray(integrations) || integrations.length === 0) {
    return integrations;
  }

  const unresolvedIds = Array.from(
    new Set(
      integrations
        .filter((item) => !item.integrationName && item.integrationConfigId)
        .map((item) => String(item.integrationConfigId))
    )
  );

  if (unresolvedIds.length === 0) {
    return integrations;
  }

  const objectIds = unresolvedIds.map((id) => mongodb.toObjectId(id)).filter(Boolean);
  if (objectIds.length === 0) {
    return integrations;
  }

  const configDocs = await db
    .collection('integration_configs')
    .find(
      {
        orgId,
        _id: { $in: objectIds },
      },
      { projection: { _id: 1, name: 1 } }
    )
    .toArray();

  const nameById = new Map(configDocs.map((doc) => [String(doc._id), doc.name || null]));

  return integrations.map((item) => ({
    ...item,
    integrationName: item.integrationName || nameById.get(String(item.integrationConfigId)) || null,
  }));
}

// buildDeliveryMatchStage removed - now using unified buildExecutionMatchStage only

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveProviderIntegrationIds(db, orgId, provider) {
  const normalizedProvider = String(provider || '').trim();
  if (!normalizedProvider) return null;

  const documents = await db
    .collection('integration_configs')
    .find(
      {
        orgId,
        provider: { $regex: `^${escapeRegex(normalizedProvider)}$`, $options: 'i' },
      },
      { projection: { _id: 1 } }
    )
    .toArray();

  return documents.flatMap((document) => {
    const id = document?._id;
    if (!id) return [];
    return [id, String(id)];
  });
}

async function buildExecutionMatchStage(db, req, { start, end }) {
  const matchStage = { orgId: req.orgId };
  const andConditions = [];

  if (start || end) {
    matchStage.startedAt = {};
    if (start) matchStage.startedAt.$gte = start;
    if (end) matchStage.startedAt.$lte = end;
  }

  if (req.query.direction) {
    matchStage.direction = req.query.direction;
  }

  if (req.query.triggerType) {
    matchStage.triggerType = normalizeTriggerTypeFilter(req.query.triggerType);
  }

  const integrationId = req.query.integrationId || req.query.integrationId;
  if (integrationId) {
    const integrationIdObj = mongodb.toObjectId(integrationId);
    if (integrationIdObj) {
      andConditions.push({ $or: [
        { integrationConfigId: integrationIdObj },
        { integrationConfigId: integrationId },
        { integrationConfigId: integrationIdObj },
        { integrationConfigId: integrationId },
      ] });
    } else {
      andConditions.push({ $or: [{ integrationConfigId: integrationId }, { integrationConfigId: integrationId }] });
    }
  }

  if (req.query.provider) {
    const providerIntegrationIds = await resolveProviderIntegrationIds(db, req.orgId, req.query.provider);
    andConditions.push({ integrationConfigId: { $in: providerIntegrationIds || [] } });
  }

  if (andConditions.length > 0) {
    matchStage.$and = andConditions;
  }

  return matchStage;
}

function buildErrorCategories(message, statusCode) {
  if (!message && !statusCode) return 'Other';
  const msg = (message || '').toLowerCase();

  if (statusCode) {
    if (statusCode >= 500) return 'Server Error';
    if (statusCode === 429) return 'Rate Limited';
    if (statusCode >= 400) return 'Client Error';
  }

  if (msg.includes('timeout')) return 'Timeout';
  if (msg.includes('network') || msg.includes('connection')) return 'Network';
  if (msg.includes('dns') || msg.includes('resolve')) return 'DNS';
  if (msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate')) return 'SSL/TLS';
  if (msg.includes('transform') || msg.includes('script')) return 'Transformation';
  if (msg.includes('auth')) return 'Authentication';

  return 'Other';
}

// ── Aggregation helpers ────────────────────────────────────────────────────────
// All aggregate calls use hint: 'org_started_idx' ({orgId:1, startedAt:-1}) so
// MongoDB uses the covered index for the initial $match rather than a collection scan.
// allowDiskUse: false fails fast instead of silently spilling to disk for 80+ seconds.

async function aggregateOverviewCollection(db, collection, match, fields) {
  const [result] = await db
    .collection(collection)
    .aggregate(
      [
        { $match: match },
        {
          $facet: {
            statusAgg: [{ $group: { _id: `$${fields.statusField}`, count: { $sum: 1 } } }],
            totalAgg: [{ $count: 'total' }],
            eventTypeAgg: [
              {
                $group: {
                  _id: `$${fields.eventTypeField}`,
                  total: { $sum: 1 },
                  successful: {
                    $sum: {
                      $cond: [{ $in: [`$${fields.statusField}`, ['SUCCESS', 'success']] }, 1, 0],
                    },
                  },
                  failed: {
                    $sum: {
                      $cond: [
                        {
                          $in: [`$${fields.statusField}`, ['FAILED', 'failed', 'ABANDONED', 'abandoned']],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  skipped: {
                    $sum: {
                      $cond: [{ $in: [`$${fields.statusField}`, ['SKIPPED', 'skipped']] }, 1, 0],
                    },
                  },
                  retrying: {
                    $sum: {
                      $cond: [{ $in: [`$${fields.statusField}`, ['RETRYING', 'retrying']] }, 1, 0],
                    },
                  },
                  pending: {
                    $sum: {
                      $cond: [
                        {
                          $in: [`$${fields.statusField}`, ['PENDING', 'pending', 'QUEUED', 'queued']],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  responseTimeSum: {
                    $sum: {
                      $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, `$${fields.responseTimeField}`, 0],
                    },
                  },
                  responseTimeCount: {
                    $sum: {
                      $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, 1, 0],
                    },
                  },
                },
              },
              { $sort: { total: -1 } },
            ],
            integrationAgg: [
              {
                $group: {
                  _id: `$${fields.integrationIdField}`,
                  total: { $sum: 1 },
                  successful: {
                    $sum: {
                      $cond: [{ $in: [`$${fields.statusField}`, ['SUCCESS', 'success']] }, 1, 0],
                    },
                  },
                  failed: {
                    $sum: {
                      $cond: [
                        {
                          $in: [`$${fields.statusField}`, ['FAILED', 'failed', 'ABANDONED', 'abandoned']],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  skipped: {
                    $sum: {
                      $cond: [{ $in: [`$${fields.statusField}`, ['SKIPPED', 'skipped']] }, 1, 0],
                    },
                  },
                  retrying: {
                    $sum: {
                      $cond: [{ $in: [`$${fields.statusField}`, ['RETRYING', 'retrying']] }, 1, 0],
                    },
                  },
                  pending: {
                    $sum: {
                      $cond: [
                        {
                          $in: [`$${fields.statusField}`, ['PENDING', 'pending', 'QUEUED', 'queued']],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  responseTimeSum: {
                    $sum: {
                      $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, `$${fields.responseTimeField}`, 0],
                    },
                  },
                  responseTimeCount: {
                    $sum: {
                      $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, 1, 0],
                    },
                  },
                  lastSeen: { $max: `$${fields.timeField}` },
                },
              },
            ],
            responseAgg: [
              { $match: { [fields.responseTimeField]: { $gt: 0 } } },
              {
                $group: {
                  _id: null,
                  avgResponseTime: { $avg: `$${fields.responseTimeField}` },
                  responseTimeCount: { $sum: 1 },
                },
              },
            ],
            bucketAgg: [
              { $match: { [fields.responseTimeField]: { $gt: 0 } } },
              {
                $bucket: {
                  groupBy: `$${fields.responseTimeField}`,
                  boundaries: RESPONSE_BUCKETS,
                  default: RESPONSE_BUCKETS[RESPONSE_BUCKETS.length - 1],
                  output: { count: { $sum: 1 } },
                },
              },
            ],
          },
        },
      ],
      { allowDiskUse: false, hint: 'org_started_analytics_covered_idx' }
    )
    .toArray();

  const statusAgg = result?.statusAgg || [];
  const totalAgg = result?.totalAgg || [];
  const eventTypeAgg = result?.eventTypeAgg || [];
  const integrationAgg = result?.integrationAgg || [];
  const responseAgg = result?.responseAgg || [];
  const bucketAgg = result?.bucketAgg || [];

  return {
    statusAgg,
    total: totalAgg[0]?.total || 0,
    eventTypeAgg,
    integrationAgg,
    responseAgg: responseAgg[0] || { avgResponseTime: 0, responseTimeCount: 0 },
    bucketAgg,
  };
}

async function aggregateTimeseriesCollection(db, collection, match, fields, interval) {
  const format = interval === 'day' ? '%Y-%m-%dT00:00:00.000Z' : '%Y-%m-%dT%H:00:00.000Z';

  return db
    .collection(collection)
    .aggregate(
      [
        { $match: match },
        {
          $group: {
            _id: {
              $dateToString: { format, date: `$${fields.timeField}` },
            },
            total: { $sum: 1 },
            successful: {
              $sum: {
                $cond: [{ $in: [`$${fields.statusField}`, ['SUCCESS', 'success']] }, 1, 0],
              },
            },
            failed: {
              $sum: {
                $cond: [
                  {
                    $in: [`$${fields.statusField}`, ['FAILED', 'failed', 'ABANDONED', 'abandoned']],
                  },
                  1,
                  0,
                ],
              },
            },
            skipped: {
              $sum: {
                $cond: [{ $in: [`$${fields.statusField}`, ['SKIPPED', 'skipped']] }, 1, 0],
              },
            },
            responseTimeSum: {
              $sum: {
                $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, `$${fields.responseTimeField}`, 0],
              },
            },
            responseTimeCount: {
              $sum: {
                $cond: [{ $gt: [`$${fields.responseTimeField}`, 0] }, 1, 0],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ],
      { allowDiskUse: false, hint: 'org_started_analytics_covered_idx' }
    )
    .toArray();
}

async function aggregateErrorCollection(db, collection, match, fields) {
  const errorMatch = {
    ...match,
    [fields.statusField]: { $in: ['FAILED', 'failed'] },
  };

  return db
    .collection(collection)
    .aggregate(
      [
        { $match: errorMatch },
        {
          $group: {
            _id: {
              message: { $ifNull: [`$${fields.errorMessageField}`, 'Unknown error'] },
              status: `$${fields.responseStatusField}`,
              integrationId: `$${fields.integrationIdField}`,
              integrationName: `$${fields.integrationNameField}`,
            },
            count: { $sum: 1 },
            lastSeen: { $max: `$${fields.timeField}` },
          },
        },
        { $sort: { count: -1 } },
      ],
      { allowDiskUse: false, hint: 'org_started_analytics_covered_idx' }
    )
    .toArray();
}

// Consolidated into a single $facet to scan matching docs only once
// instead of the original 4 sequential round-trips on the same doc set.
async function aggregatePerformanceCollection(db, collection, match, fields) {
  const [result] = await db
    .collection(collection)
    .aggregate(
      [
        { $match: match },
        {
          $facet: {
            totalAgg: [{ $count: 'totalRequests' }],
            successAgg: [
              { $match: { [fields.statusField]: { $in: ['SUCCESS', 'success'] } } },
              { $count: 'successfulRequests' },
            ],
            responseAgg: [
              { $match: { [fields.statusField]: { $in: ['SUCCESS', 'success'] } } },
              { $match: { [fields.responseTimeField]: { $gt: 0 } } },
              {
                $group: {
                  _id: null,
                  avgResponseTime: { $avg: `$${fields.responseTimeField}` },
                  minResponseTime: { $min: `$${fields.responseTimeField}` },
                  maxResponseTime: { $max: `$${fields.responseTimeField}` },
                  responseTimeCount: { $sum: 1 },
                },
              },
            ],
            bucketAgg: [
              { $match: { [fields.statusField]: { $in: ['SUCCESS', 'success'] } } },
              { $match: { [fields.responseTimeField]: { $gt: 0 } } },
              {
                $bucket: {
                  groupBy: `$${fields.responseTimeField}`,
                  boundaries: RESPONSE_BUCKETS,
                  default: RESPONSE_BUCKETS[RESPONSE_BUCKETS.length - 1],
                  output: { count: { $sum: 1 } },
                },
              },
            ],
          },
        },
      ],
      { allowDiskUse: false, hint: 'org_started_analytics_covered_idx' }
    )
    .toArray();

  return {
    totalRequests: result?.totalAgg[0]?.totalRequests || 0,
    successfulRequests: result?.successAgg[0]?.successfulRequests || 0,
    responseAgg: result?.responseAgg[0] || {
      avgResponseTime: 0,
      minResponseTime: 0,
      maxResponseTime: 0,
      responseTimeCount: 0,
    },
    bucketAgg: result?.bucketAgg || [],
  };
}

function bucketAggToIndexCounts(bucketAgg) {
  return bucketAgg
    .map((bucket) => {
      const idx = RESPONSE_BUCKETS.indexOf(bucket._id);
      return { index: Math.max(0, idx - 1), count: bucket.count || 0 };
    })
    .filter((item) => item.index >= 0);
}

// deliveryFields removed - now using unified executionFields only

const executionFields = {
  statusField: 'status',
  responseTimeField: 'durationMs',
  eventTypeField: 'eventType',
  integrationIdField: 'integrationConfigId',
  integrationNameField: 'integrationName',
  errorMessageField: 'errorMessage',
  responseStatusField: 'response.statusCode',
  timeField: 'startedAt',
};

function canUseHourlyRollup(req, start, end) {
  if (req.query.direction || req.query.triggerType || req.query.integrationId || req.query.provider) return false;
  if (!(start instanceof Date) || !(end instanceof Date)) return false;
  return end.getTime() - start.getTime() >= 7 * 24 * 60 * 60 * 1000;
}

function mergeOverviewAggregates(results) {
  const statusMap = new Map();
  const eventMap = new Map();
  const integrationMap = new Map();
  const bucketMap = new Map();
  let total = 0;
  let responseTimeSum = 0;
  let responseTimeCount = 0;

  for (const result of results) {
    if (!result) continue;
    total += result.total || 0;
    for (const item of result.statusAgg || []) {
      const key = normalizeStatus(item._id);
      statusMap.set(key, (statusMap.get(key) || 0) + (item.count || 0));
    }
    for (const item of result.eventTypeAgg || []) {
      if (!item._id) continue;
      const current = eventMap.get(String(item._id)) || {
        _id: item._id,
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        retrying: 0,
        pending: 0,
        responseTimeSum: 0,
        responseTimeCount: 0,
      };
      for (const field of [
        'total',
        'successful',
        'failed',
        'skipped',
        'retrying',
        'pending',
        'responseTimeSum',
        'responseTimeCount',
      ]) {
        current[field] += item[field] || 0;
      }
      eventMap.set(String(item._id), current);
    }
    for (const item of result.integrationAgg || []) {
      if (!item._id) continue;
      const key = String(item._id);
      const current = integrationMap.get(key) || {
        _id: item._id,
        integrationName: null,
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        retrying: 0,
        pending: 0,
        responseTimeSum: 0,
        responseTimeCount: 0,
        lastSeen: null,
      };
      current.integrationName = current.integrationName || item.integrationName || null;
      for (const field of [
        'total',
        'successful',
        'failed',
        'skipped',
        'retrying',
        'pending',
        'responseTimeSum',
        'responseTimeCount',
      ]) {
        current[field] += item[field] || 0;
      }
      if (item.lastSeen && (!current.lastSeen || new Date(item.lastSeen) > new Date(current.lastSeen))) {
        current.lastSeen = item.lastSeen;
      }
      integrationMap.set(key, current);
    }
    const resultResponseTimeCount = result.responseAgg?.responseTimeCount || 0;
    responseTimeCount += resultResponseTimeCount;
    responseTimeSum += (result.responseAgg?.avgResponseTime || 0) * resultResponseTimeCount;
    for (const item of result.bucketAgg || []) {
      bucketMap.set(item._id, (bucketMap.get(item._id) || 0) + (item.count || 0));
    }
  }

  return {
    statusAgg: Array.from(statusMap.entries()).map(([_id, count]) => ({ _id, count })),
    total,
    eventTypeAgg: Array.from(eventMap.values()),
    integrationAgg: Array.from(integrationMap.values()),
    responseAgg: {
      avgResponseTime: responseTimeCount > 0 ? responseTimeSum / responseTimeCount : 0,
      responseTimeCount,
    },
    bucketAgg: Array.from(bucketMap.entries()).map(([_id, count]) => ({ _id, count })),
  };
}

function mergeTimeseriesAggregates(results) {
  const seriesMap = new Map();
  for (const rows of results) {
    for (const row of rows || []) {
      const key = row._id || row.timestamp;
      if (!key) continue;
      const current = seriesMap.get(key) || {
        _id: key,
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        responseTimeSum: 0,
        responseTimeCount: 0,
      };
      for (const field of ['total', 'successful', 'failed', 'skipped', 'responseTimeSum', 'responseTimeCount']) {
        current[field] += row[field] || 0;
      }
      seriesMap.set(key, current);
    }
  }
  return Array.from(seriesMap.values()).sort((a, b) => new Date(a._id) - new Date(b._id));
}

function mergeErrorAggregates(results) {
  const errorMap = new Map();
  for (const rows of results) {
    for (const row of rows || []) {
      const id = row._id || {};
      const key = JSON.stringify([
        id.message || 'Unknown error',
        id.status ?? null,
        id.integrationId ? String(id.integrationId) : null,
        id.integrationName || null,
      ]);
      const current = errorMap.get(key) || {
        _id: {
          message: id.message || 'Unknown error',
          status: id.status,
          integrationId: id.integrationId,
          integrationName: id.integrationName,
        },
        count: 0,
        lastSeen: null,
      };
      current.count += row.count || 0;
      if (row.lastSeen && (!current.lastSeen || new Date(row.lastSeen) > new Date(current.lastSeen)))
        current.lastSeen = row.lastSeen;
      errorMap.set(key, current);
    }
  }
  return Array.from(errorMap.values()).sort((a, b) => b.count - a.count);
}

function mergePerformanceAggregates(results) {
  const merged = {
    totalRequests: 0,
    successfulRequests: 0,
    responseAgg: { avgResponseTime: 0, minResponseTime: 0, maxResponseTime: 0, responseTimeCount: 0 },
    bucketAgg: [],
  };
  let responseTimeSum = 0;
  const buckets = new Map();
  for (const result of results) {
    if (!result) continue;
    merged.totalRequests += result.totalRequests || 0;
    merged.successfulRequests += result.successfulRequests || 0;
    const response = result.responseAgg || {};
    merged.responseAgg.responseTimeCount += response.responseTimeCount || 0;
    responseTimeSum += (response.avgResponseTime || 0) * (response.responseTimeCount || 0);
    if (
      response.minResponseTime > 0 &&
      (!merged.responseAgg.minResponseTime || response.minResponseTime < merged.responseAgg.minResponseTime)
    ) {
      merged.responseAgg.minResponseTime = response.minResponseTime;
    }
    if (response.maxResponseTime > merged.responseAgg.maxResponseTime)
      merged.responseAgg.maxResponseTime = response.maxResponseTime;
    for (const bucket of result.bucketAgg || [])
      buckets.set(bucket._id, (buckets.get(bucket._id) || 0) + (bucket.count || 0));
  }
  merged.responseAgg.avgResponseTime =
    merged.responseAgg.responseTimeCount > 0 ? responseTimeSum / merged.responseAgg.responseTimeCount : 0;
  merged.bucketAgg = Array.from(buckets.entries()).map(([_id, count]) => ({ _id, count }));
  return merged;
}

async function aggregateWithHourlyRollup({ db, req, start, end, rawLoader, rollupLoader, merge }) {
  if (!canUseHourlyRollup(req, start, end)) return rawLoader(start, end);
  const fullRange = dashboardRollups.getFullHourRange(start, end);
  if (!fullRange || !(await dashboardRollups.hasCoverage(db, req.orgId, fullRange.fullStart, fullRange.fullEnd))) {
    return rawLoader(start, end);
  }

  const parts = [];
  if (start <= fullRange.leftEnd) parts.push(await rawLoader(start, fullRange.leftEnd));
  const rollup = await rollupLoader(fullRange.fullStart, fullRange.fullEnd);
  if (!rollup) return rawLoader(start, end);
  parts.push(rollup);
  if (fullRange.rightStart <= end) parts.push(await rawLoader(fullRange.rightStart, end));
  return merge(parts);
}

// ── Routes ─────────────────────────────────────────────────────────────────────

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    try {
      const cacheKey = _analyticsKey(req.orgId, 'overview', req.query);
      const result = await _withAnalyticsCache(cacheKey, async () => {
        const { days = 30 } = req.query;
        const parsedDays = parseInt(days, 10);
        const { start: startOverride, end: endOverride } = parseDateFilters(req);
        const { start: defaultStart, end: defaultEnd } = getDateRange(parsedDays);
        const start = startOverride || defaultStart;
        const end = endOverride || defaultEnd;

        const db = await mongodb.getDbSafe();
        const execution = await aggregateWithHourlyRollup({
          db,
          req,
          start,
          end,
          rawLoader: async (segmentStart, segmentEnd) => {
            const executionMatch = await buildExecutionMatchStage(db, req, { start: segmentStart, end: segmentEnd });
            return aggregateOverviewCollection(db, 'execution_logs', executionMatch, executionFields);
          },
          rollupLoader: (segmentStart, segmentEnd) =>
            dashboardRollups.getOverviewFromRollups(db, req.orgId, segmentStart, segmentEnd),
          merge: mergeOverviewAggregates,
        });

        const statusCounts = {};
        const eventTypeCounts = {};
        const integrationMap = {};

        for (const item of execution.statusAgg) {
          addCount(statusCounts, normalizeStatus(item._id), item.count);
        }

        const total = execution.total;

        for (const item of execution.eventTypeAgg) {
          if (!item._id) continue;
          eventTypeCounts[item._id] = {
            total: item.total || 0,
            successful: item.successful || 0,
            failed: item.failed || 0,
            skipped: item.skipped || 0,
            retrying: item.retrying || 0,
            pending: item.pending || 0,
            avgResponseTime:
              item.responseTimeCount > 0 ? Math.round((item.responseTimeSum || 0) / item.responseTimeCount) : 0,
          };
        }

        for (const item of execution.integrationAgg) {
          const id = item._id ? String(item._id) : null;
          if (!id) continue;
          if (!integrationMap[id]) {
            integrationMap[id] = {
              integrationConfigId: id,
              integrationName: item.integrationName || null,
              total: 0,
              successful: 0,
              failed: 0,
              skipped: 0,
              retrying: 0,
              pending: 0,
              responseTimeSum: 0,
              responseTimeCount: 0,
              lastSeen: null,
            };
          }
          integrationMap[id].integrationName = integrationMap[id].integrationName || item.integrationName || null;
          integrationMap[id].total += item.total || 0;
          integrationMap[id].successful += item.successful || 0;
          integrationMap[id].failed += item.failed || 0;
          integrationMap[id].skipped += item.skipped || 0;
          integrationMap[id].retrying += item.retrying || 0;
          integrationMap[id].pending += item.pending || 0;
          integrationMap[id].responseTimeSum += item.responseTimeSum || 0;
          integrationMap[id].responseTimeCount += item.responseTimeCount || 0;
          if (!integrationMap[id].lastSeen || new Date(item.lastSeen) > new Date(integrationMap[id].lastSeen)) {
            integrationMap[id].lastSeen = item.lastSeen || integrationMap[id].lastSeen;
          }
        }

        const rawIntegrationPerformance = Object.values(integrationMap)
          .map((perf) => ({
            integrationConfigId: perf.integrationConfigId,
            integrationName: perf.integrationName,
            total: perf.total,
            successful: perf.successful,
            failed: perf.failed,
            skipped: perf.skipped,
            retrying: perf.retrying,
            pending: perf.pending,
            avgResponseTime: perf.responseTimeCount > 0 ? Math.round(perf.responseTimeSum / perf.responseTimeCount) : 0,
            successRate: perf.total > 0 ? Math.round((perf.successful / perf.total) * 10000) / 100 : 0,
            lastSeen: perf.lastSeen || null,
          }))
          .sort((a, b) => b.total - a.total);
        const integrationPerformance = await enrichIntegrationNames(db, req.orgId, rawIntegrationPerformance);

        const mergedBuckets = new Array(RESPONSE_BUCKETS.length - 1).fill(0);
        mergeBuckets(mergedBuckets, bucketAggToIndexCounts(execution.bucketAgg));

        const responseTimeCount = execution.responseAgg.responseTimeCount || 0;
        const responseTimeSum =
          (execution.responseAgg.avgResponseTime || 0) * (execution.responseAgg.responseTimeCount || 0);

        const avgResponseTime = responseTimeCount > 0 ? Math.round(responseTimeSum / responseTimeCount) : 0;
        const p95ResponseTime = computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.95);

        const successful = statusCounts.SUCCESS || 0;
        const failed = (statusCounts.FAILED || 0) + (statusCounts.ABANDONED || 0);
        const skipped = statusCounts.SKIPPED || 0;
        const retrying = statusCounts.RETRYING || 0;
        const pending = (statusCounts.PENDING || 0) + (statusCounts.QUEUED || 0);
        const successRate = total > 0 ? Math.round((successful / total) * 10000) / 100 : 0;

        return {
          period: {
            start: start?.toISOString?.() || null,
            end: end?.toISOString?.() || null,
            days: parsedDays,
          },
          summary: {
            total,
            successful,
            failed,
            skipped,
            retrying,
            pending,
            successRate,
          },
          performance: {
            avgResponseTime,
            p95ResponseTime,
            totalRequests: total,
          },
          eventTypes: eventTypeCounts,
          integrationPerformance,
        };
      }, { shouldCache: (value) => value.summary.total > 0 });
      res.json(result);
    } catch (error) {
      log('error', 'Analytics overview failed', {
        error: error.message,
        orgId: req.orgId,
      });
      res.status(500).json({
        error: 'Analytics overview failed',
        code: 'ANALYTICS_ERROR',
      });
    }
  })
);

router.get(
  '/timeseries',
  asyncHandler(async (req, res) => {
    try {
      const cacheKey = _analyticsKey(req.orgId, 'timeseries', req.query);
      const result = await _withAnalyticsCache(cacheKey, async () => {
        const { days = 7, interval = 'hour' } = req.query;
        const parsedDays = parseInt(days, 10);
        const { start: startOverride, end: endOverride } = parseDateFilters(req);
        const { start: defaultStart, end: defaultEnd } = getDateRange(parsedDays);
        const start = startOverride || defaultStart;
        const end = endOverride || defaultEnd;

        const db = await mongodb.getDbSafe();
        const executionSeries = await aggregateWithHourlyRollup({
          db,
          req,
          start,
          end,
          rawLoader: async (segmentStart, segmentEnd) => {
            const executionMatch = await buildExecutionMatchStage(db, req, { start: segmentStart, end: segmentEnd });
            return aggregateTimeseriesCollection(db, 'execution_logs', executionMatch, executionFields, interval);
          },
          rollupLoader: (segmentStart, segmentEnd) =>
            dashboardRollups.getTimeseriesFromRollups(db, req.orgId, segmentStart, segmentEnd, interval),
          merge: mergeTimeseriesAggregates,
        });

        const seriesMap = new Map();

        for (const row of executionSeries) {
          const ts = row._id;
          if (!seriesMap.has(ts)) {
            seriesMap.set(ts, {
              timestamp: ts,
              total: 0,
              successful: 0,
              failed: 0,
              skipped: 0,
              responseTimeSum: 0,
              responseTimeCount: 0,
            });
          }
          const entry = seriesMap.get(ts);
          entry.total += row.total || 0;
          entry.successful += row.successful || 0;
          entry.failed += row.failed || 0;
          entry.skipped += row.skipped || 0;
          entry.responseTimeSum += row.responseTimeSum || 0;
          entry.responseTimeCount += row.responseTimeCount || 0;
        }

        const timeseries = Array.from(seriesMap.values())
          .map((row) => ({
            timestamp: row.timestamp,
            total: row.total,
            successful: row.successful,
            failed: row.failed,
            skipped: row.skipped,
            avgResponseTime: row.responseTimeCount > 0 ? Math.round(row.responseTimeSum / row.responseTimeCount) : 0,
            successRate: row.total > 0 ? Math.round((row.successful / row.total) * 10000) / 100 : 0,
          }))
          .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        return {
          period: {
            start: start?.toISOString?.() || null,
            end: end?.toISOString?.() || null,
            interval,
          },
          data: timeseries,
        };
      }, { shouldCache: (value) => value.data.length > 0 });
      res.json(result);
    } catch (error) {
      log('error', 'Time series analytics failed', {
        error: error.message,
        orgId: req.orgId,
      });
      res.status(500).json({
        error: 'Time series analytics failed',
        code: 'TIMESERIES_ERROR',
      });
    }
  })
);

router.get(
  '/errors',
  asyncHandler(async (req, res) => {
    try {
      const cacheKey = _analyticsKey(req.orgId, 'errors', req.query);
      const result = await _withAnalyticsCache(cacheKey, async () => {
        const { days = 7 } = req.query;
        const parsedDays = parseInt(days, 10);
        const { start: startOverride, end: endOverride } = parseDateFilters(req);
        const { start: defaultStart, end: defaultEnd } = getDateRange(parsedDays);
        const start = startOverride || defaultStart;
        const end = endOverride || defaultEnd;

        const db = await mongodb.getDbSafe();
        const executionErrors = await aggregateWithHourlyRollup({
          db,
          req,
          start,
          end,
          rawLoader: async (segmentStart, segmentEnd) => {
            const executionMatch = await buildExecutionMatchStage(db, req, { start: segmentStart, end: segmentEnd });
            return aggregateErrorCollection(db, 'execution_logs', executionMatch, executionFields);
          },
          rollupLoader: (segmentStart, segmentEnd) =>
            dashboardRollups.getErrorsFromRollups(db, req.orgId, segmentStart, segmentEnd),
          merge: mergeErrorAggregates,
        });

        const errorCategories = {};
        const errorMap = new Map();
        const integrationBreakdownMap = new Map();

        for (const item of executionErrors) {
          const message = item._id.message || 'Unknown error';
          const statusCode = item._id.status;
          const category = buildErrorCategories(message, statusCode);
          const integrationId = item._id.integrationId ? String(item._id.integrationId) : null;
          const integrationName = item._id.integrationName || null;
          addCount(errorCategories, category, item.count || 0);

          if (!errorMap.has(message)) {
            errorMap.set(message, { message, count: 0, lastSeen: null, category, statusCode });
          }
          const entry = errorMap.get(message);
          entry.count += item.count || 0;
          if (!entry.lastSeen || new Date(item.lastSeen) > new Date(entry.lastSeen)) {
            entry.lastSeen = item.lastSeen;
          }

          if (integrationId) {
            if (!integrationBreakdownMap.has(integrationId)) {
              integrationBreakdownMap.set(integrationId, {
                integrationConfigId: integrationId,
                integrationName: integrationName,
                count: 0,
                lastSeen: null,
                categoryCounts: new Map(),
                messageCounts: new Map(),
              });
            }

            const integrationEntry = integrationBreakdownMap.get(integrationId);
            integrationEntry.integrationName = integrationEntry.integrationName || integrationName || null;
            integrationEntry.count += item.count || 0;
            if (!integrationEntry.lastSeen || new Date(item.lastSeen) > new Date(integrationEntry.lastSeen)) {
              integrationEntry.lastSeen = item.lastSeen;
            }
            integrationEntry.categoryCounts.set(
              category,
              (integrationEntry.categoryCounts.get(category) || 0) + (item.count || 0)
            );
            integrationEntry.messageCounts.set(
              message,
              (integrationEntry.messageCounts.get(message) || 0) + (item.count || 0)
            );
          }
        }

        const topErrors = Array.from(errorMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        const totalErrors = Array.from(errorMap.values()).reduce((sum, e) => sum + e.count, 0);
        const rawIntegrationBreakdown = Array.from(integrationBreakdownMap.values())
          .map((e) => {
            const topCategoryEntry = Array.from(e.categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0];
            const topMessageEntry = Array.from(e.messageCounts.entries()).sort((a, b) => b[1] - a[1])[0];
            return {
              integrationConfigId: e.integrationConfigId,
              integrationName: e.integrationName,
              count: e.count,
              lastSeen: e.lastSeen,
              category: topCategoryEntry?.[0] || null,
              topErrorMessage: topMessageEntry?.[0] || null,
            };
          })
          .sort((a, b) => b.count - a.count);
        const integrationBreakdown = await enrichIntegrationNames(db, req.orgId, rawIntegrationBreakdown);

        return {
          period: {
            start: start?.toISOString?.() || null,
            end: end?.toISOString?.() || null,
          },
          summary: {
            totalErrors,
            errorCategories,
            topErrors,
          },
          topErrors,
          integrationBreakdown,
        };
      });
      res.json(result);
    } catch (error) {
      log('error', 'Error analytics failed', {
        error: error.message,
        orgId: req.orgId,
      });
      res.status(500).json({
        error: 'Error analytics failed',
        code: 'ERROR_ANALYTICS_ERROR',
      });
    }
  })
);

router.get(
  '/performance',
  asyncHandler(async (req, res) => {
    try {
      const cacheKey = _analyticsKey(req.orgId, 'performance', req.query);
      const result = await _withAnalyticsCache(cacheKey, async () => {
        const { days = 30 } = req.query;
        const parsedDays = parseInt(days, 10);
        const { start: startOverride, end: endOverride } = parseDateFilters(req);
        const { start: defaultStart, end: defaultEnd } = getDateRange(parsedDays);
        const start = startOverride || defaultStart;
        const end = endOverride || defaultEnd;

        const db = await mongodb.getDbSafe();
        const executionPerf = await aggregateWithHourlyRollup({
          db,
          req,
          start,
          end,
          rawLoader: async (segmentStart, segmentEnd) => {
            const executionMatch = await buildExecutionMatchStage(db, req, { start: segmentStart, end: segmentEnd });
            return aggregatePerformanceCollection(db, 'execution_logs', executionMatch, executionFields);
          },
          rollupLoader: (segmentStart, segmentEnd) =>
            dashboardRollups.getPerformanceFromRollups(db, req.orgId, segmentStart, segmentEnd),
          merge: mergePerformanceAggregates,
        });

        const totalRequests = executionPerf.totalRequests;
        const successfulRequests = executionPerf.successfulRequests;

        const mergedBuckets = new Array(RESPONSE_BUCKETS.length - 1).fill(0);
        mergeBuckets(mergedBuckets, bucketAggToIndexCounts(executionPerf.bucketAgg));

        const responseTimeCount = executionPerf.responseAgg.responseTimeCount || 0;
        const responseTimeSum =
          (executionPerf.responseAgg.avgResponseTime || 0) * (executionPerf.responseAgg.responseTimeCount || 0);

        const avgResponseTime = responseTimeCount > 0 ? Math.round(responseTimeSum / responseTimeCount) : 0;
        const minResponseTime = executionPerf.responseAgg.minResponseTime || 0;
        const maxResponseTime = executionPerf.responseAgg.maxResponseTime || 0;

        const metrics = {
          totalRequests,
          successfulRequests,
          avgResponseTime,
          minResponseTime: minResponseTime === Infinity ? 0 : minResponseTime,
          maxResponseTime,
          p50ResponseTime: computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.5),
          p90ResponseTime: computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.9),
          p95ResponseTime: computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.95),
          p99ResponseTime: computePercentileFromBuckets(mergedBuckets, responseTimeCount, 0.99),
        };

        const buckets = mergedBuckets.map((count, index) => ({
          label: RESPONSE_BUCKET_LABELS[index] || '> 10m',
          count,
        }));

        return {
          period: { start: start?.toISOString?.() || null, end: end?.toISOString?.() || null },
          metrics,
          distribution: { buckets },
        };
      });
      res.json(result);
    } catch (error) {
      log('error', 'Performance analytics failed', {
        error: error.message,
        orgId: req.orgId,
      });
      res.status(500).json({
        error: 'Performance analytics failed',
        code: 'PERFORMANCE_ERROR',
      });
    }
  })
);

module.exports = router;
