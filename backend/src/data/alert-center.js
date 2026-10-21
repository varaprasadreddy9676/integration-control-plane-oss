'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const { useMongo, normalizeOrgId, buildOrgScopeQuery, fallbackDisabledError, mapAlertCenterLog } = require('./helpers');

function buildAlertCenterQuery(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  const query = buildOrgScopeQuery(normalizedOrgId);

  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.channel) {
    query.channel = filters.channel;
  }
  if (filters.type) {
    query.type = filters.type;
  }
  if (filters.search) {
    const searchTerm = String(filters.search).trim();
    if (searchTerm) {
      query.$text = { $search: searchTerm };
    }
  }

  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) {
      query.createdAt.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.createdAt.$lte = new Date(filters.endDate);
    }
  }

  return query;
}

async function countAlertCenterLogs(orgId, filters = {}) {
  const query = buildAlertCenterQuery(orgId, filters);
  if (!query) return 0;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      return await db.collection('alert_center_logs').countDocuments(query);
    } catch (err) {
      logError(err, { scope: 'countAlertCenterLogs', filters });
      throw err;
    }
  }
  return fallbackDisabledError('countAlertCenterLogs:fallback');
}

async function listAlertCenterLogs(orgId, filters = {}) {
  const query = buildAlertCenterQuery(orgId, filters);
  if (!query) return [];

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      const logs = await db
        .collection('alert_center_logs')
        .find(query)
        .hint('alert_org_created_idx')
        .sort({ createdAt: -1 })
        .limit(filters.limit || 10000)
        .toArray();

      return logs.map(mapAlertCenterLog);
    } catch (err) {
      logError(err, { scope: 'listAlertCenterLogs', filters });
      throw err;
    }
  }
  return fallbackDisabledError('listAlertCenterLogs:fallback');
}

async function streamAlertCenterLogsForExport(orgId, filters = {}, onLog, options = {}) {
  const query = buildAlertCenterQuery(orgId, filters);
  if (!query) return 0;

  if (useMongo()) {
    let cursor;
    try {
      const db = await mongodb.getDbSafe();
      let count = 0;

      cursor = db
        .collection('alert_center_logs')
        .find(query, { noCursorTimeout: true })
        .hint('alert_org_created_idx')
        .sort({ createdAt: -1 })
        .batchSize(100);

      for await (const doc of cursor) {
        if (options.shouldStop && options.shouldStop()) {
          break;
        }
        await onLog(mapAlertCenterLog(doc));
        count += 1;
      }

      return count;
    } catch (err) {
      logError(err, { scope: 'streamAlertCenterLogsForExport', filters });
      throw err;
    } finally {
      if (cursor) {
        try {
          await cursor.close();
        } catch (_closeErr) {
          // Ignore cursor cleanup failures.
        }
      }
    }
  }
  return fallbackDisabledError('streamAlertCenterLogsForExport:fallback');
}

async function recordAlertCenterLog(orgId, logPayload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return false;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const logDoc = {
        orgId: normalizedOrgId,
        type: logPayload.type,
        channel: logPayload.channel,
        status: logPayload.status,
        subject: logPayload.subject || null,
        recipients: logPayload.recipients || [],
        totalFailures: logPayload.totalFailures ?? null,
        windowStart: logPayload.windowStart || null,
        windowEnd: logPayload.windowEnd || null,
        errorMessage: logPayload.errorMessage || null,
        errorStack: logPayload.errorStack || null,
        payload: logPayload.payload || null,
        providerUrl: logPayload.providerUrl || null,
        providerResponse: logPayload.providerResponse || null,
        searchableText: [
          logPayload.subject,
          ...(Array.isArray(logPayload.recipients) ? logPayload.recipients : []),
          logPayload.errorMessage,
          logPayload.providerUrl,
        ]
          .filter(Boolean)
          .join(' '),
        createdAt: logPayload.createdAt || new Date(),
      };

      await db.collection('alert_center_logs').insertOne(logDoc);
      return true;
    } catch (err) {
      logError(err, { scope: 'recordAlertCenterLog' });
      return false;
    }
  }
  return fallbackDisabledError('recordAlertCenterLog:fallback');
}

/**
 * Stats summary cache with 30s TTL and LRU eviction (max 500 entries).
 * Mirrors the _statsCache pattern in logs.js.
 */
const _statsCache = new Map();
const STATS_CACHE_TTL_MS = 30_000;
const STATS_CACHE_MAX_SIZE = 500;

function _buildStatsCacheKey(orgId, filters) {
  const filterParts = Object.entries(filters)
    .filter(([k, v]) => v !== undefined && v !== null && k !== 'status')
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return `${orgId}|${filterParts.join('&')}`;
}

async function getAlertCenterStatsSummary(orgId, filters = {}) {
  // Strip status filter so stats always reflect ALL statuses
  const { status, ...filtersWithoutStatus } = filters;
  const cacheKey = _buildStatsCacheKey(orgId, filtersWithoutStatus);

  const cached = _statsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
    return cached.value;
  }

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = buildAlertCenterQuery(orgId, filtersWithoutStatus);
      if (!query) {
        return { total: 0, sent: 0, failed: 0, skipped: 0 };
      }

      const pipeline = [
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            sent: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
            skipped: { $sum: { $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0] } },
          },
        },
      ];

      const results = await db
        .collection('alert_center_logs')
        .aggregate(pipeline, { allowDiskUse: true, hint: 'alert_org_created_idx' })
        .toArray();
      const row = results[0] || { total: 0, sent: 0, failed: 0, skipped: 0 };
      const summary = {
        total: row.total || 0,
        sent: row.sent || 0,
        failed: row.failed || 0,
        skipped: row.skipped || 0,
      };

      // LRU eviction when cache is full
      if (_statsCache.size >= STATS_CACHE_MAX_SIZE) {
        const now = Date.now();
        for (const [key, entry] of _statsCache) {
          if (now - entry.ts >= STATS_CACHE_TTL_MS) _statsCache.delete(key);
        }
        if (_statsCache.size >= STATS_CACHE_MAX_SIZE) {
          let oldest = null;
          for (const [key, entry] of _statsCache) {
            if (!oldest || entry.ts < oldest[1].ts) oldest = [key, entry];
          }
          if (oldest) _statsCache.delete(oldest[0]);
        }
      }
      _statsCache.set(cacheKey, { ts: Date.now(), value: summary });
      return summary;
    } catch (err) {
      logError(err, { scope: 'getAlertCenterStatsSummary', filters });
      throw err;
    }
  }
  return fallbackDisabledError('getAlertCenterStatsSummary:fallback');
}

/**
 * Whether an integration's failing alert was already raised since `since`, so a
 * restarted process does not raise the same failure episode again.
 */
async function wasIntegrationAlertedSince(integrationId, orgId, since) {
  if (!useMongo()) return false;
  const db = await mongodb.getDbSafe();
  const found = await db.collection('alert_center_logs').findOne(
    {
      orgId: normalizeOrgId(orgId),
      type: 'INTEGRATION_DELIVERY_FAILING',
      'payload.integrationId': String(integrationId),
      createdAt: { $gte: new Date(since) },
    },
    { projection: { _id: 1 } }
  );
  return Boolean(found);
}

/** The type of the organization's most recent alert among `types`, or null. */
async function latestAlertType(orgId, types) {
  if (!useMongo()) return null;
  const db = await mongodb.getDbSafe();
  const [latest] = await db
    .collection('alert_center_logs')
    .find({ orgId: normalizeOrgId(orgId), type: { $in: types } }, { projection: { type: 1 } })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();
  return latest ? latest.type : null;
}

module.exports = {
  latestAlertType,
  wasIntegrationAlertedSince,
  buildAlertCenterQuery,
  countAlertCenterLogs,
  listAlertCenterLogs,
  streamAlertCenterLogsForExport,
  recordAlertCenterLog,
  getAlertCenterStatsSummary,
};
