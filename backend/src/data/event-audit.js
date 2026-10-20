'use strict';
const crypto = require('crypto');
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const config = require('../config');
const { useMongo, normalizeOrgId, fallbackDisabledError } = require('./helpers');

function buildEventAuditQuery(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  const query = { orgId: normalizedOrgId };

  if (filters.status) query.status = filters.status;
  if (filters.eventType) query.eventType = filters.eventType;
  if (filters.skipCategory) query.skipCategory = filters.skipCategory;
  if (filters.source) query.source = filters.source;

  if (filters.startDate || filters.endDate) {
    query.receivedAt = {};
    if (filters.startDate) query.receivedAt.$gte = new Date(filters.startDate);
    if (filters.endDate) query.receivedAt.$lte = new Date(filters.endDate);
  }

  if (filters.search) {
    const numericSearch = Number.parseInt(String(filters.search), 10);
    query.$or = [
      { eventId: { $regex: filters.search, $options: 'i' } },
      { sourceId: { $regex: filters.search, $options: 'i' } },
    ];
    if (Number.isFinite(numericSearch) && numericSearch > 0) {
      query.$or.push({ 'payloadSummary.patientRid': numericSearch });
    }
  }

  return query;
}

/**
 * Save processed event to MongoDB for duplicate prevention
 * Uses TTL index to auto-expire after 6 hours
 *
 * @param {string} eventKey - Legacy unique event key (for backward compatibility)
 * @param {number|string} mysqlEventId - Event ID from notification_queue
 * @param {string} eventType - Event type
 * @param {number} orgId - Organization ID
 * @param {string} stableEventId - Stable event ID (orgId-eventType-id)
 * @returns {Promise<boolean>} - True if saved successfully, false if duplicate
 */
async function saveProcessedEvent(eventKey, mysqlEventId, eventType, orgId, stableEventId = null) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return true;

  if (!useMongo()) {
    return true; // Skip MongoDB if not enabled
  }

  try {
    const db = await mongodb.getDbSafe();

    const doc = {
      eventKey,
      eventId: stableEventId || eventKey, // Use stable eventId if provided
      mysqlEventId,
      eventType,
      orgId: normalizedOrgId,
      processedAt: new Date(),
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // Expires in 6 hours
    };

    await db.collection('processed_events').insertOne(doc);
    return true;
  } catch (err) {
    // Duplicate key error (E11000) is expected if event was already processed
    if (err.code === 11000) {
      log('debug', 'Event already processed (duplicate key)', {
        eventKey,
        eventId: stableEventId,
      });
      return false;
    }
    logError(err, { scope: 'saveProcessedEvent', eventKey, eventId: stableEventId });
    return true; // Don't block processing on DB errors
  }
}

/**
 * Check if event has already been processed
 * Checks both legacy eventKey and new stable eventId
 *
 * @param {string} eventKeyOrId - Event key or stable event ID
 * @param {string} stableEventId - Optional stable event ID
 * @returns {Promise<boolean>} - True if already processed, false otherwise
 */
async function isEventAlreadyProcessed(eventKeyOrId, stableEventId = null) {
  if (!useMongo()) {
    return false; // Skip check if MongoDB not enabled
  }

  try {
    const db = await mongodb.getDbSafe();

    // Check both eventKey (legacy) and eventId (new stable ID)
    const query = {
      $or: [{ eventKey: eventKeyOrId }, { eventId: eventKeyOrId }],
    };

    // If stable eventId provided, also check that
    if (stableEventId && stableEventId !== eventKeyOrId) {
      query.$or.push({ eventId: stableEventId });
    }

    const doc = await db.collection('processed_events').findOne(query);
    return !!doc;
  } catch (err) {
    logError(err, {
      scope: 'isEventAlreadyProcessed',
      eventKey: eventKeyOrId,
      eventId: stableEventId,
    });
    return false; // Don't block processing on DB errors
  }
}

/**
 * Create event audit record (with uniqueness safety)
 */
async function recordEventAudit(auditData) {
  if (!useMongo()) {
    return fallbackDisabledError('recordEventAudit:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const doc = {
      ...auditData,
      createdAt: new Date(),
      // No expiresAt — event_audit records are kept forever.
      // Base64 blobs are redacted before storage (utils/payload-sanitizer).
    };

    const result = await db.collection('event_audit').insertOne(doc);
    return result.insertedId;
  } catch (err) {
    // Handle duplicate key error gracefully
    if (err.code === 11000) {
      log('warn', 'Duplicate event audit record', {
        source: auditData.source,
        sourceId: auditData.sourceId,
        eventKey: auditData.eventKey,
      });

      // Return existing record ID
      const db = await mongodb.getDbSafe();
      const hasSourceId = auditData.sourceId !== undefined && auditData.sourceId !== null;
      const existing = hasSourceId
        ? await db.collection('event_audit').findOne({
            source: auditData.source,
            sourceId: auditData.sourceId,
          })
        : await db.collection('event_audit').findOne({
            orgId: auditData.orgId,
            eventKey: auditData.eventKey,
            receivedAtBucket: auditData.receivedAtBucket,
          });
      return existing?._id;
    }

    logError(err, { scope: 'recordEventAudit', auditData });
    throw err;
  }
}

/**
 * Update event audit record (supports timeline append)
 */
async function updateEventAudit(eventId, updates) {
  if (!useMongo()) {
    return fallbackDisabledError('updateEventAudit:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    // Separate timeline updates from field updates
    const { timeline, timelinePush, ...fieldUpdates } = updates;

    const updateDoc = {
      $set: { ...fieldUpdates, updatedAt: new Date() },
    };

    const timelineEntry = timelinePush || timeline;
    if (timelineEntry) {
      updateDoc.$push = {
        timeline: Array.isArray(timelineEntry) ? { $each: timelineEntry } : timelineEntry,
      };
    }

    await db.collection('event_audit').updateOne({ eventId }, updateDoc);

    return true;
  } catch (err) {
    logError(err, { scope: 'updateEventAudit', eventId, updates });
    throw err;
  }
}

/**
 * List events (audit trail) - MUST use orgId
 */
async function listEventAudit(orgId, filters = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('listEventAudit:mongo');
  }

  try {
    const query = buildEventAuditQuery(orgId, filters);
    const limit = filters.limit || 50;
    const page = filters.page || 1;
    // No org, no events. Never hand MongoDB a null filter: older drivers read
    // it as "match everything", across every org.
    if (!query) return { events: [], total: 0, pages: 0, page };

    const db = await mongodb.getDbSafe();

    // Exclude large fields not needed by the list view (payload ~30KB, eventKey ~5KB each).
    // The detail endpoint fetches the full document by _id.
    const listProjection = { payload: 0, eventKey: 0, originalPayload: 0 };

    const [events, total] = await Promise.all([
      db
        .collection('event_audit')
        .find(query, { projection: listProjection })
        .hint('parent_received_idx')
        .sort({ receivedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      db.collection('event_audit').countDocuments(query, { hint: 'parent_received_idx' }),
    ]);

    return {
      events,
      total,
      pages: Math.ceil(total / limit),
      page,
    };
  } catch (err) {
    logError(err, { scope: 'listEventAudit', orgId, filters });
    throw err;
  }
}

async function countEventAudit(orgId, filters = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('countEventAudit:mongo');
  }

  try {
    const query = buildEventAuditQuery(orgId, filters);
    if (!query) return 0;
    const db = await mongodb.getDbSafe();
    return await db.collection('event_audit').countDocuments(query);
  } catch (err) {
    logError(err, { scope: 'countEventAudit', orgId, filters });
    throw err;
  }
}

async function streamEventAuditForExport(orgId, filters = {}, onEvent, options = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('streamEventAuditForExport:mongo');
  }

  let cursor;
  try {
    const query = buildEventAuditQuery(orgId, filters);
    if (!query) return 0;
    const db = await mongodb.getDbSafe();
    let count = 0;

    cursor = db
      .collection('event_audit')
      .find(query, { noCursorTimeout: true })
      .hint('parent_received_idx')
      .sort({ receivedAt: -1 })
      .batchSize(100);

    for await (const event of cursor) {
      if (options.shouldStop && options.shouldStop()) {
        break;
      }
      await onEvent(event);
      count += 1;
    }

    return count;
  } catch (err) {
    logError(err, { scope: 'streamEventAuditForExport', orgId, filters });
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

/**
 * Get event audit by ID (with tenant check)
 */
async function getEventAuditById(orgId, eventId) {
  if (!useMongo()) {
    return fallbackDisabledError('getEventAuditById:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    return db.collection('event_audit').findOne({
      orgId, // CRITICAL: prevent cross-tenant access
      eventId,
    });
  } catch (err) {
    logError(err, { scope: 'getEventAuditById', orgId, eventId });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Stats cache: 30 s TTL, max 500 entries with LRU eviction
// ---------------------------------------------------------------------------
const _statsCache = new Map();
const STATS_CACHE_TTL_MS = 30_000;
const STATS_CACHE_MAX_SIZE = 500;

function _buildStatsCacheKey(orgId, filters) {
  const filterParts = Object.entries(filters)
    .filter(([k, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  return `${orgId}|${filterParts.join('&')}`;
}

function _evictStatsCache() {
  if (_statsCache.size < STATS_CACHE_MAX_SIZE) return;
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

/**
 * Get event audit statistics (with delivery metrics)
 *
 * @param {number} orgId
 * @param {object} [filters] - Same filter shape accepted by buildEventAuditQuery
 *   { status, eventType, source, skipCategory, startDate, endDate, search, hoursBack }
 */
async function getEventAuditStats(orgId, filters = {}) {
  if (!useMongo()) {
    return fallbackDisabledError('getEventAuditStats:mongo');
  }

  const { hoursBack = 24, ...queryFilters } = filters;

  // Build the base match using the shared query builder (respects all filters)
  const baseMatch = buildEventAuditQuery(orgId, queryFilters);
  if (!baseMatch) {
    return {
      totalReceived: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
      stuck: 0,
      avgProcessingTimeMs: 0,
      avgIntegrationsMatched: 0,
      avgDeliveredCount: 0,
      avgFailedCount: 0,
      skipReasons: {},
      duplicateTypes: {},
      bySource: {},
      byEventType: {},
      processingMetrics: {
        avgProcessingTimeMs: 0,
        p50ProcessingTimeMs: 0,
        p95ProcessingTimeMs: 0,
        p99ProcessingTimeMs: 0,
      },
      deliveryMetrics: { avgIntegrationsMatched: 0, avgDeliveredCount: 0, avgFailedCount: 0, successRate: 0 },
    };
  }

  // Add hoursBack date window when no explicit startDate/endDate provided
  let effectiveMatch = baseMatch;
  if (!queryFilters.startDate && !queryFilters.endDate) {
    const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    effectiveMatch = {
      ...baseMatch,
      receivedAt: baseMatch.receivedAt ? { ...baseMatch.receivedAt, $gte: startDate } : { $gte: startDate },
    };
  }

  // Cache lookup
  const cacheKey = _buildStatsCacheKey(orgId, { ...queryFilters, hoursBack });
  const cached = _statsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const db = await mongodb.getDbSafe();

    // Single $facet pass — one index scan instead of 5 sequential aggregations
    const [facetResult] = await db
      .collection('event_audit')
      .aggregate(
        [
          { $match: effectiveMatch },
          {
            $facet: {
              summary: [
                {
                  $group: {
                    _id: null,
                    totalReceived: { $sum: 1 },
                    delivered: { $sum: { $cond: [{ $eq: ['$status', 'DELIVERED'] }, 1, 0] } },
                    skipped: { $sum: { $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0] } },
                    failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
                    stuck: { $sum: { $cond: [{ $eq: ['$status', 'STUCK'] }, 1, 0] } },
                    avgProcessingTimeMs: { $avg: '$processingTimeMs' },
                    avgIntegrationsMatched: { $avg: '$deliveryStatus.integrationsMatched' },
                    avgDeliveredCount: { $avg: '$deliveryStatus.deliveredCount' },
                    avgFailedCount: { $avg: '$deliveryStatus.failedCount' },
                  },
                },
              ],
              skipReasons: [
                { $match: { status: 'SKIPPED' } },
                { $group: { _id: '$skipCategory', count: { $sum: 1 } } },
              ],
              duplicateTypes: [
                { $match: { skipCategory: 'DUPLICATE' } },
                { $group: { _id: '$duplicateType', count: { $sum: 1 } } },
              ],
              bySource: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
              byEventType: [{ $group: { _id: '$eventType', count: { $sum: 1 } } }],
              // Percentiles via $bucket — avoids loading all docs into memory
              processingBuckets: [
                { $match: { processingTimeMs: { $exists: true, $gt: 0 } } },
                {
                  $bucket: {
                    groupBy: '$processingTimeMs',
                    boundaries: [0, 100, 250, 500, 1000, 2500, 5000, 10000],
                    default: 'other',
                    output: { count: { $sum: 1 }, maxMs: { $max: '$processingTimeMs' } },
                  },
                },
              ],
            },
          },
        ],
        { allowDiskUse: true, hint: 'parent_received_idx' }
      )
      .toArray();

    const result = facetResult?.summary?.[0] || {
      totalReceived: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
      stuck: 0,
      avgProcessingTimeMs: 0,
      avgIntegrationsMatched: 0,
      avgDeliveredCount: 0,
      avgFailedCount: 0,
    };

    // Derive approximate percentiles from bucket boundaries
    const buckets = facetResult?.processingBuckets || [];
    const totalWithMs = buckets.reduce((s, b) => s + b.count, 0);
    const _pctBucket = (pct) => {
      const target = Math.ceil(totalWithMs * pct);
      let cumulative = 0;
      for (const b of buckets) {
        cumulative += b.count;
        if (cumulative >= target) return b.maxMs || (typeof b._id === 'number' ? b._id : 0);
      }
      return 0;
    };
    const p50 = totalWithMs > 0 ? _pctBucket(0.5) : 0;
    const p95 = totalWithMs > 0 ? _pctBucket(0.95) : 0;
    const p99 = totalWithMs > 0 ? _pctBucket(0.99) : 0;

    const skipReasons = facetResult?.skipReasons || [];
    const duplicateTypes = facetResult?.duplicateTypes || [];
    const bySource = facetResult?.bySource || [];
    const byEventType = facetResult?.byEventType || [];

    const value = {
      ...result,
      skipReasons: Object.fromEntries(skipReasons.map((r) => [r._id, r.count])),
      duplicateTypes: Object.fromEntries(duplicateTypes.map((r) => [r._id, r.count])),
      bySource: Object.fromEntries(bySource.map((r) => [r._id, r.count])),
      byEventType: Object.fromEntries(byEventType.map((r) => [r._id, r.count])),
      processingMetrics: {
        avgProcessingTimeMs: result.avgProcessingTimeMs || 0,
        p50ProcessingTimeMs: p50,
        p95ProcessingTimeMs: p95,
        p99ProcessingTimeMs: p99,
      },
      deliveryMetrics: {
        avgIntegrationsMatched: result.avgIntegrationsMatched || 0,
        avgDeliveredCount: result.avgDeliveredCount || 0,
        avgFailedCount: result.avgFailedCount || 0,
        successRate: result.avgIntegrationsMatched > 0 ? result.avgDeliveredCount / result.avgIntegrationsMatched : 0,
      },
    };

    _evictStatsCache();
    _statsCache.set(cacheKey, { ts: Date.now(), value });
    return value;
  } catch (err) {
    logError(err, { scope: 'getEventAuditStats', orgId, filters });
    throw err;
  }
}

/**
 * Update source checkpoint (for gap detection)
 */
async function updateSourceCheckpoint(checkpointData) {
  if (!useMongo()) {
    return fallbackDisabledError('updateSourceCheckpoint:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const { source, sourceIdentifier, orgId, lastProcessedId, lastProcessedAt } = checkpointData;

    const existing = await db.collection('source_checkpoints').findOne({
      source,
      sourceIdentifier,
      orgId,
    });

    // Update or insert checkpoint
    await db.collection('source_checkpoints').updateOne(
      { source, sourceIdentifier, orgId },
      {
        $set: {
          lastProcessedId,
          lastProcessedAt,
          updatedAt: new Date(),
        },
        $inc: { eventsProcessedLast5Min: 1 },
      },
      { upsert: true }
    );

    // Detect gaps for sequential sources (MySQL, Kafka offset)
    if (isSequentialSource(source)) {
      const previousId = existing?.lastProcessedId;
      await detectGaps(source, sourceIdentifier, orgId, lastProcessedId, previousId);
    }

    return true;
  } catch (err) {
    logError(err, { scope: 'updateSourceCheckpoint', checkpointData });
    throw err;
  }
}

/**
 * Detect gaps in sequential sources
 */
async function detectGaps(source, sourceIdentifier, orgId, currentId, previousIdOverride) {
  if (!useMongo()) {
    return fallbackDisabledError('detectGaps:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    const prevIdRaw =
      previousIdOverride !== undefined && previousIdOverride !== null
        ? previousIdOverride
        : (
            await db.collection('source_checkpoints').findOne({
              source,
              sourceIdentifier,
              orgId,
            })
          )?.lastProcessedId;

    if (!prevIdRaw) return;

    const prevId = parseInt(prevIdRaw);
    const currId = parseInt(currentId);

    // Gap detected (difference > 1 for sequential IDs)
    if (currId - prevId > 1) {
      const gap = {
        start: prevId + 1,
        end: currId - 1,
        detectedAt: new Date(),
      };

      log('debug', 'Gap detected in event source', {
        source,
        sourceIdentifier,
        orgId,
        gap,
      });

      // Store gap — capped at 200 entries to prevent document hitting 16MB limit
      await db
        .collection('source_checkpoints')
        .updateOne({ source, sourceIdentifier, orgId }, { $push: { detectedGaps: { $each: [gap], $slice: -200 } } });
    }

    return true;
  } catch (err) {
    logError(err, { scope: 'detectGaps', source, sourceIdentifier, orgId, currentId });
    throw err;
  }
}

/**
 * Get source checkpoints (for API)
 */
async function getSourceCheckpoints(orgId) {
  if (!useMongo()) {
    return fallbackDisabledError('getSourceCheckpoints:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();

    const checkpoints = await db.collection('source_checkpoints').find({ orgId }).toArray();

    // Add health status
    const now = Date.now();
    return checkpoints.map((cp) => ({
      ...cp,
      health: {
        eventsProcessedLast5Min: cp.eventsProcessedLast5Min || 0,
        lastHealthCheckAt: cp.updatedAt,
        isHealthy: now - cp.updatedAt.getTime() < 60 * 1000, // Healthy if updated < 1 min ago
        lag: cp.lastProcessedAt ? formatLag(now - cp.lastProcessedAt.getTime()) : 'unknown',
      },
    }));
  } catch (err) {
    logError(err, { scope: 'getSourceCheckpoints', orgId });
    throw err;
  }
}

/**
 * Get gaps for a specific source
 */
async function getSourceGaps(orgId, source, hoursBack = 24) {
  if (!useMongo()) {
    return fallbackDisabledError('getSourceGaps:mongo');
  }

  try {
    const db = await mongodb.getDbSafe();
    const startDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const checkpoint = await db.collection('source_checkpoints').findOne({
      orgId,
      source,
    });

    if (!checkpoint) {
      return {
        source,
        isSequential: false,
        totalGaps: 0,
        gaps: [],
      };
    }

    // Filter gaps within time window
    const recentGaps = (checkpoint.detectedGaps || []).filter((gap) => gap.detectedAt >= startDate);

    return {
      source,
      sourceIdentifier: checkpoint.sourceIdentifier,
      isSequential: checkpoint.isSequential !== false,
      totalGaps: recentGaps.length,
      gaps: recentGaps.map((gap) => ({
        ...gap,
        count: gap.end - gap.start + 1,
      })),
    };
  } catch (err) {
    logError(err, { scope: 'getSourceGaps', orgId, source, hoursBack });
    throw err;
  }
}

// ========================
// Helper Functions
// ========================

/**
 * Check if source has sequential IDs (can detect gaps)
 */
function isSequentialSource(source) {
  return ['mysql', 'kafka'].includes(source);
}

/**
 * Format lag duration in human-readable format
 */
function formatLag(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'unknown';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

/**
 * Hash payload for verification
 */
function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Extract compliance-safe payload fields (allowlist)
 */
function extractSafePayload(payload) {
  const allowedFields = config.eventAudit?.allowedSummaryFields || [
    'patientRid',
    'appointmentId',
    'orgId',
    'orgUnitRid',
    'billId',
    'eventType',
    'timestamp',
  ];

  const safe = {};
  for (const field of allowedFields) {
    if (payload && payload[field] !== undefined) {
      safe[field] = payload[field];
    }
  }
  return safe;
}

/**
 * Bucket timestamp for fallback uniqueness (5-minute buckets)
 */
function getBucketTimestamp(date, minutes = 5) {
  const ms = date.getTime();
  const bucketMs = minutes * 60 * 1000;
  return new Date(Math.floor(ms / bucketMs) * bucketMs);
}

/**
 * Extract source-specific metadata from event
 */
function extractSourceMetadata(event, sourceType) {
  const metadata = {};

  if (sourceType === 'mysql') {
    metadata.table = 'notification_queue';
    if (event.org_unit_rid || event.entity_rid) metadata.orgUnitRid = event.org_unit_rid || event.entity_rid;
    if (event.entity_parent_rid) metadata.orgId = event.entity_parent_rid;
  } else if (sourceType === 'kafka') {
    if (event.topic) metadata.topic = event.topic;
    if (event.partition !== undefined) metadata.partition = event.partition;
    if (event.offset !== undefined) metadata.offset = event.offset;
  } else if (sourceType === 'sqs') {
    if (event.messageId) metadata.messageId = event.messageId;
    if (event.receiptHandle) metadata.receiptHandle = event.receiptHandle;
  }

  return metadata;
}

function resolveOrgIdFromEvent(event) {
  if (!event) return null;
  return normalizeOrgId(event.orgId || event.entity_parent_rid);
}

/**
 * Get source identifier for checkpoint tracking
 */
function getSourceIdentifier(event, sourceType) {
  const type = sourceType || config.eventSource?.type || 'unknown';

  if (type === 'mysql') {
    return 'notification_queue';
  } else if (type === 'kafka') {
    return event.topic || 'integration-events';
  } else if (type === 'sqs') {
    return event.queueName || 'integration-queue';
  }

  return 'unknown';
}

/**
 * Get event type sample payload from event_types collection
 * @param {string} eventType - Event type identifier
 * @returns {Promise<Object|null>} Sample payload or null if not found
 */
async function getEventTypeSamplePayload(eventType, orgId) {
  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');
    const projection = { projection: { samplePayload: 1 } };

    // Prefer org-specific doc, fall back to global template
    if (orgId) {
      const orgDoc = await collection.findOne(
        {
          $or: [
            { type: eventType, orgId, isActive: true },
            { eventType, orgId, isActive: true },
          ],
        },
        projection
      );
      if (orgDoc?.samplePayload) return orgDoc.samplePayload;
    }

    // Global template fallback (also handles legacy docs without orgId field)
    const globalDoc = await collection.findOne(
      {
        $or: [
          { type: eventType, isActive: true },
          { eventType, isActive: true },
        ],
      },
      projection
    );

    if (globalDoc?.samplePayload) {
      log('debug', 'Event type sample payload retrieved', { eventType, hasSamplePayload: true });
      return globalDoc.samplePayload;
    }

    log('debug', 'Event type sample payload not found', { eventType });
    return null;
  } catch (err) {
    logError(err, { scope: 'getEventTypeSamplePayload', eventType });
    return null;
  }
}

async function ensureIndexes() {
  const db = await mongodb.getDbSafe();
  await db.collection('event_audit').createIndexes([
    { key: { orgId: 1, receivedAt: -1 }, name: 'parent_received_idx', background: true },
    { key: { orgId: 1, status: 1, receivedAt: -1 }, name: 'org_status_received_idx', background: true },
    { key: { orgId: 1, eventType: 1, receivedAt: -1 }, name: 'org_type_received_idx', background: true },
    { key: { eventId: 1 }, name: 'event_id_idx', background: true, sparse: true },
  ]);
}

module.exports = {
  ensureIndexes,
  buildEventAuditQuery,
  saveProcessedEvent,
  isEventAlreadyProcessed,
  recordEventAudit,
  updateEventAudit,
  listEventAudit,
  countEventAudit,
  streamEventAuditForExport,
  getEventAuditById,
  getEventAuditStats,
  updateSourceCheckpoint,
  detectGaps,
  getSourceCheckpoints,
  getSourceGaps,
  isSequentialSource,
  formatLag,
  hashPayload,
  extractSafePayload,
  getBucketTimestamp,
  extractSourceMetadata,
  resolveOrgIdFromEvent,
  getSourceIdentifier,
  getEventTypeSamplePayload,
};
