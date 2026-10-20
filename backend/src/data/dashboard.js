'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const db = require('../db');
const config = require('../config');
const { useMongo, fallbackDisabledError, mapLogFromMongo } = require('./helpers');
const { uuidv4 } = require('../utils/runtime');

const useMysql = () => db.isConfigured();

// ── Dashboard summary cache ───────────────────────────────────────────────────
// The 24h aggregation is the most expensive query on the dashboard. Cache the
// result per orgId for 5 minutes. stale-while-revalidate: if an entry is stale
// we immediately return the old value and kick off a background refresh so the
// next request is already warm. This keeps the dashboard fast even on cold starts.
const _dashboardCache = new Map();
const DASHBOARD_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const DASHBOARD_CACHE_MAX_SIZE = 200; // one entry per org; 200 orgs ≈ negligible RAM

// Track in-progress background refreshes so we don't spawn duplicates.
const _refreshInProgress = new Set();

function _evictDashboardCache() {
  if (_dashboardCache.size < DASHBOARD_CACHE_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of _dashboardCache) {
    if (now - entry.ts >= DASHBOARD_CACHE_TTL_MS) _dashboardCache.delete(key);
  }
  // Still over limit — evict the oldest entry
  if (_dashboardCache.size >= DASHBOARD_CACHE_MAX_SIZE) {
    let oldest = null;
    for (const [key, entry] of _dashboardCache) {
      if (!oldest || entry.ts < oldest[1].ts) oldest = [key, entry];
    }
    if (oldest) _dashboardCache.delete(oldest[0]);
  }
}

// Minimal fields needed by the dashboard recentFailures panel.
// Excludes originalPayload, requestPayload, requestHeaders, responseBody, metadata
// — those fields can be multi-KB (base64 PDFs, full event data) and are never
// displayed on the dashboard card. Fetch them on the detail page instead.
const RECENT_FAILURES_PROJECTION = {
  _id: 1,
  integrationConfigId: 1,
  integrationName: 1,
  eventType: 1,
  integrationType: 1,
  direction: 1,
  status: 1,
  errorCategory: 1,
  errorMessage: 1,
  responseStatus: 1,
  responseTimeMs: 1,
  attemptCount: 1,
  createdAt: 1,
  targetUrl: 1,
  httpMethod: 1,
};

function _mapRecentFailure(doc) {
  return {
    id: doc._id.toString(),
    integrationConfigId: doc.integrationConfigId?.toString() || null,
    integrationName: doc.integrationName || null,
    eventType: doc.eventType,
    integrationType: doc.integrationType || doc.eventType,
    direction: doc.direction || 'OUTBOUND',
    status: doc.status,
    errorCategory: doc.errorCategory || null,
    errorMessage: doc.errorMessage || null,
    responseStatus: doc.responseStatus ?? null,
    responseTimeMs: doc.responseTimeMs ?? null,
    attemptCount: doc.attemptCount ?? 1,
    createdAt: doc.createdAt?.toISOString?.() || null,
    targetUrl: doc.targetUrl || null,
    httpMethod: doc.httpMethod || null,
  };
}

async function _fetchDashboardFromDb(orgId) {
  const dbClient = await mongodb.getDbSafe();
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Run all three DB queries in parallel — they are fully independent
  const [stats, integrationDocs, recentFailureDocs] = await Promise.all([
    // 1. 24h aggregation.
    //    Uses covered index hint {orgId,createdAt,status} so MongoDB reads only
    //    index data and never touches the documents themselves (no disk I/O per doc).
    dbClient
      .collection('execution_logs')
      .aggregate(
        [
          { $match: { orgId, createdAt: { $gte: last24h } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              successful: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $in: ['$status', ['FAILED', 'ABANDONED']] }, 1, 0] } },
              skipped: { $sum: { $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0] } },
              avgResponseTime: { $avg: '$responseTimeMs' },
            },
          },
        ],
        { allowDiskUse: true, hint: 'org_created_status_rt_covered_idx' }
      )
      .toArray(),

    // 2. Integration health — minimal projection
    dbClient
      .collection('integration_configs')
      .find({ orgId, direction: { $ne: 'INBOUND' } }, { projection: { _id: 1, name: 1, isActive: 1 } })
      .sort({ updatedAt: -1 })
      .limit(5)
      .toArray(),

    // 3. Recent failures — project only the fields the dashboard card needs.
    //    Excludes heavy fields (originalPayload, requestPayload, responseBody, etc.)
    //    Reduces per-doc transfer from ~10–50 KB to ~200 bytes.
    dbClient
      .collection('execution_logs')
      .find({ orgId, status: { $in: ['FAILED', 'ABANDONED'] } }, { projection: RECENT_FAILURES_PROJECTION })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray(),
  ]);

  const result = stats[0] || { total: 0, successful: 0, failed: 0, skipped: 0, avgResponseTime: 0 };

  const integrationHealth = integrationDocs.map((doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    status: doc.isActive ? 'GREEN' : 'RED',
    failureCount24h: 0,
  }));

  return {
    totalDeliveries24h: result.total,
    successRate24h: result.total > 0 ? Number(((result.successful / result.total) * 100).toFixed(1)) : 100,
    failedCount24h: result.failed,
    skippedCount24h: result.skipped,
    avgResponseTimeMs24h: Math.round(result.avgResponseTime || 0),
    integrationHealth,
    recentFailures: recentFailureDocs.map(_mapRecentFailure),
  };
}

async function getDashboardSummary(orgId) {
  if (useMongo()) {
    const cached = _dashboardCache.get(orgId);
    const now = Date.now();

    if (cached) {
      const age = now - cached.ts;
      if (age < DASHBOARD_CACHE_TTL_MS) {
        // Fresh — return immediately
        return cached.value;
      }
      // Stale-while-revalidate: return old value immediately, refresh in background
      if (!_refreshInProgress.has(orgId)) {
        _refreshInProgress.add(orgId);
        _fetchDashboardFromDb(orgId)
          .then((summary) => {
            _evictDashboardCache();
            _dashboardCache.set(orgId, { ts: Date.now(), value: summary });
          })
          .catch((err) => logError(err, { scope: 'dashboardSummary:bgRefresh', orgId }))
          .finally(() => _refreshInProgress.delete(orgId));
      }
      return cached.value;
    }

    // No cache at all (cold start) — must wait for the query
    try {
      const summary = await _fetchDashboardFromDb(orgId);
      _evictDashboardCache();
      _dashboardCache.set(orgId, { ts: Date.now(), value: summary });
      return summary;
    } catch (err) {
      logError(err, { scope: 'dashboardSummary' });
    }
  }
  return fallbackDisabledError('getDashboardSummary:fallback');
}

function mapOrgUnitDoc(doc) {
  if (!doc) return null;
  return {
    rid: doc.rid,
    name: doc.name || `ENT-${doc.rid}`,
    code: doc.code || `ENT-${doc.rid}`,
    email: doc.email || null,
    phone: doc.phone || null,
    address: doc.address || null,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    region: doc.region || 'default',
    timezone: doc.timezone || 'UTC',
  };
}

function mapOrganizationToTenant(orgDoc, units = []) {
  return {
    orgId: orgDoc.orgId,
    tenantName: orgDoc.name || `Org ${orgDoc.orgId}`,
    tenantCode: orgDoc.code || `ORG-${orgDoc.orgId}`,
    tenantEmail: orgDoc.email || null,
    tenantPhone: orgDoc.phone || null,
    tenantAddress: orgDoc.address || null,
    tenantTags: Array.isArray(orgDoc.tags) ? orgDoc.tags : [],
    region: orgDoc.region || 'default',
    timezone: orgDoc.timezone || 'UTC',
    childEntities: units.map(mapOrgUnitDoc).filter(Boolean),
  };
}

async function listOrgUnitsByOrgId(orgId) {
  const dbClient = await mongodb.getDbSafe();
  return dbClient.collection('org_units').find({ orgId }).sort({ rid: 1 }).toArray();
}

async function getTenant(orgId) {
  if (useMongo()) {
    try {
      const dbClient = await mongodb.getDbSafe();

      const org = await dbClient.collection('organizations').findOne({ orgId });
      if (org) {
        const units = await listOrgUnitsByOrgId(orgId);
        return mapOrganizationToTenant(org, units);
      }

      const unit = await dbClient.collection('org_units').findOne({ rid: orgId });
      if (unit) {
        return {
          orgId: unit.rid,
          tenantName: unit.name || `ENT-${unit.rid}`,
          tenantCode: unit.code || `ENT-${unit.rid}`,
          tenantEmail: unit.email || null,
          tenantPhone: unit.phone || null,
          tenantAddress: unit.address || null,
          tenantTags: Array.isArray(unit.tags) ? unit.tags : [],
          region: unit.region || 'default',
          timezone: unit.timezone || 'UTC',
          childEntities: [],
        };
      }
    } catch (err) {
      logError(err, { scope: 'getTenant:mongo', orgId });
      throw err;
    }
    return null;
  }

  return fallbackDisabledError('getTenant:mongo');
}

async function getPendingEvents(limit = 5) {
  // This reads from MySQL event source table (configured via adapter)
  if (useMysql()) {
    try {
      const checkpoint = await getWorkerCheckpoint();
      const maxEventAgeDays = Number(config.worker?.maxEventAgeDays ?? 0);
      const cutoff = maxEventAgeDays > 0 ? new Date(Date.now() - maxEventAgeDays * 24 * 60 * 60 * 1000) : null;
      const { getAllowedParentRids } = require('./integrations');
      const allowedParents = await getAllowedParentRids();

      if (Array.isArray(allowedParents) && allowedParents.length === 0) {
        log('info', 'No active parent entities configured; skipping event poll');
        return [];
      }

      // Do not filter by STATUS; other services may mutate it after insert, which would
      // cause us to skip records. We rely on monotonic id ordering instead.
      const whereParts = ['id > :lastId'];
      const params = { lastId: checkpoint };

      if (cutoff) {
        whereParts.push('created_at >= :cutoff');
        // Convert Date to MySQL datetime format (YYYY-MM-DD HH:MM:SS)
        // MySQL doesn't handle ISO 8601 timestamps with timezone well
        params.cutoff = cutoff.toISOString().slice(0, 19).replace('T', ' ');
      }

      if (Array.isArray(allowedParents)) {
        const parentParams = allowedParents.map((_, index) => `:parent${index}`);
        whereParts.push(`entity_parent_rid IN (${parentParams.join(', ')})`);
        allowedParents.forEach((parentRid, index) => {
          params[`parent${index}`] = parentRid;
        });
      }

      const query = `SELECT id, entity_rid, entity_parent_rid, transaction_type, message, created_at FROM notification_queue WHERE ${whereParts.join(' AND ')} ORDER BY id ASC LIMIT ${limit}`;

      log('debug', 'Querying notification_queue for pending events', {
        query,
        params,
      });

      const [rows] = await db.query(query, params);

      log('debug', 'Pending events query result', {
        rowsFound: rows.length,
        limit,
      });

      return rows.map((row) => {
        const eventType = row.transaction_type || row.event_type;
        return {
          id: row.id,
          orgUnitRid: row.entity_rid,
          orgId: row.entity_parent_rid, // Renamed from entity_parent_rid
          event_type: eventType,
          // Stable idempotency key for all event sources (MySQL, Kafka, SQS)
          eventId: `${row.entity_parent_rid}-${eventType}-${row.id}`,
          created_at: row.created_at,
          payload: (() => {
            const rawPayload = row.message ?? row.payload;
            if (typeof rawPayload === 'string') {
              try {
                return JSON.parse(rawPayload || '{}');
              } catch (err) {
                log('warn', 'Failed to parse event payload JSON', {
                  error: err.message,
                  rowId: row.id,
                });
                return {};
              }
            }
            return rawPayload ?? {};
          })(),
        };
      });
    } catch (err) {
      logError(err, { scope: 'getPendingEvents' });
      throw err;
    }
  }

  return fallbackDisabledError('getPendingEvents:fallback');
}

async function markEventComplete(id, status = 'COMPLETED', errorMessage) {
  if (useMysql()) {
    // No-op for DB mode to keep notification_queue untouched (read-only for other apps).
    return true;
  }
  return true;
}

function cryptoRandom() {
  return uuidv4().replace(/-/g, '').slice(0, 16);
}

async function getMaxNotificationQueueId() {
  if (!useMysql()) {
    return fallbackDisabledError('getMaxNotificationQueueId:mysql');
  }
  const [rows] = await db.query('SELECT MAX(id) AS maxId FROM notification_queue');
  return rows && rows[0] && rows[0].maxId ? Number(rows[0].maxId) : 0;
}

async function getWorkerCheckpoint() {
  if (useMongo()) {
    try {
      const dbClient = await mongodb.getDbSafe();
      const checkpoint = await dbClient.collection('worker_checkpoint').findOne({ workerId: 'main_worker' });
      if (!checkpoint && config.worker?.bootstrapCheckpoint) {
        const maxId = await getMaxNotificationQueueId();
        await setWorkerCheckpoint(maxId);
        log('info', 'Bootstrapped worker checkpoint to latest notification_queue id', {
          maxId,
        });
        return maxId;
      }
      return checkpoint?.lastProcessedId || 0;
    } catch (err) {
      logError(err, { scope: 'getWorkerCheckpoint' });
      throw err;
    }
  }
  return fallbackDisabledError('getWorkerCheckpoint:fallback');
}

async function setWorkerCheckpoint(lastProcessedId) {
  if (useMongo()) {
    try {
      const dbClient = await mongodb.getDbSafe();
      await dbClient.collection('worker_checkpoint').updateOne(
        { workerId: 'main_worker' },
        {
          $set: {
            lastProcessedId,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
      return;
    } catch (err) {
      logError(err, { scope: 'setWorkerCheckpoint' });
    }
  }
  return fallbackDisabledError('setWorkerCheckpoint:fallback');
}

module.exports = {
  getDashboardSummary,
  mapOrgUnitDoc,
  mapOrganizationToTenant,
  listOrgUnitsByOrgId,
  getTenant,
  getPendingEvents,
  markEventComplete,
  cryptoRandom,
  getMaxNotificationQueueId,
  getWorkerCheckpoint,
  setWorkerCheckpoint,
};
