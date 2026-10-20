'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  normalizeOrgId,
  scheduledOrgQuery,
  fallbackDisabledError,
  mapScheduledIntegrationFromMongo,
} = require('./helpers');
const {
  findLifecycleRule,
  INVALIDATING_ACTIONS,
  normalizeLifecycleRules,
  normalizeSubjectExtraction,
} = require('../services/lifecycle-config');
const { matchSubjects, normalizeEventSubject } = require('../processor/event-normalizer');
const { applyCursorHint } = require('../utils/index-hints');

/**
 * Create a scheduled integration
 * @param {Object} data - Scheduled integration data
 * @returns {Promise<Object>} Created scheduled integration
 */
async function createScheduledIntegration(data) {
  if (!useMongo()) {
    throw new Error('MongoDB required for scheduled integrations');
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();
    const integrationConfigId = data.integrationConfigId || data.webhookConfigId;
    const integrationName = data.integrationName || data.webhookName;
    const orgId = normalizeOrgId(data.orgId || data.orgUnitRid || data.entityRid);
    if (!orgId) throw new Error('orgId is required for scheduled integration');
    const integrationConfigObjectId = mongodb.toObjectId(integrationConfigId) || integrationConfigId;

    const scheduledForDate = new Date(data.scheduledFor);
    const status = scheduledForDate <= now ? 'OVERDUE' : 'PENDING';

    const scheduledIntegration = {
      integrationConfigId: integrationConfigObjectId,
      integrationName,
      webhookConfigId: integrationConfigObjectId,
      webhookName: integrationName,
      orgId,
      orgUnitRid: data.orgUnitRid || data.entityRid || orgId,
      originalEventId: data.originalEventId,
      eventType: data.eventType,
      scheduledFor: scheduledForDate, // Unix timestamp to Date
      status, // PENDING | SENT | FAILED | CANCELLED | OVERDUE
      payload: data.payload, // Pre-transformed payload ready to send
      originalPayload: data.originalPayload || data.payload, // CRITICAL: Store original payload for recurring integrations
      targetUrl: data.targetUrl,
      httpMethod: data.httpMethod,
      // Snapshot lifecycle data so already-scheduled rows remain matchable even if
      // the integration config changes later.
      subject: data.subject || null,
      subjectExtraction: normalizeSubjectExtraction(data.subjectExtraction) || null,
      lifecycleRules: normalizeLifecycleRules(data.lifecycleRules),
      cancelOnEvents: data.cancelOnEvents || [],
      // Recurring integration metadata
      recurringConfig: data.recurringConfig || null, // { interval, count, endDate, occurrenceNumber }
      createdAt: now,
      updatedAt: now,
    };

    const dedupeQuery = buildScheduledReminderDedupeQuery(scheduledIntegration, data, integrationConfigObjectId, orgId);

    if (dedupeQuery) {
      const collection = db.collection('scheduled_integrations');
      const existing = await collection.findOne(dedupeQuery, {
        sort: { updatedAt: -1, createdAt: -1 },
      });

      if (existing?.status === 'SENT') {
        log('warn', 'Suppressing duplicate scheduled integration already delivered', {
          existingId: existing._id?.toString?.(),
          integrationName: integrationName,
          orgId,
          originalEventId: data.originalEventId,
          bookingNumber: data.originalPayload?.appt?.bookingNumber,
          messageType: data.payload?.metadata?.messageType,
        });

        return mapScheduledIntegrationFromMongo(existing);
      }

      if (existing && ['PENDING', 'OVERDUE'].includes(existing.status)) {
        const nextStatus = scheduledForDate <= now ? 'OVERDUE' : 'PENDING';
        const updated = await collection.findOneAndUpdate(
          { _id: existing._id, status: { $in: ['PENDING', 'OVERDUE'] } },
          {
            $set: {
              originalEventId: data.originalEventId,
              eventType: data.eventType,
              scheduledFor: scheduledForDate,
              status: nextStatus,
              payload: data.payload,
              originalPayload: data.originalPayload || data.payload,
              targetUrl: data.targetUrl,
              httpMethod: data.httpMethod,
              subject: data.subject || null,
              subjectExtraction: normalizeSubjectExtraction(data.subjectExtraction) || null,
              lifecycleRules: normalizeLifecycleRules(data.lifecycleRules),
              cancelOnEvents: data.cancelOnEvents || [],
              recurringConfig: data.recurringConfig || null,
              updatedAt: now,
            },
            $unset: {
              processingStartedAt: '',
              deliveredAt: '',
              deliveryLogId: '',
              errorMessage: '',
              cancelledAt: '',
              cancelReason: '',
            },
          },
          {
            returnDocument: 'after',
          }
        );

        const updatedDoc = updated?.value || updated;
        if (updatedDoc?._id) {
          log('info', 'Updated existing scheduled integration instead of inserting duplicate', {
            id: updatedDoc._id.toString(),
            integrationName: integrationName,
            orgId,
            originalEventId: data.originalEventId,
            bookingNumber: data.originalPayload?.appt?.bookingNumber,
            messageType: data.payload?.metadata?.messageType,
          });

          return mapScheduledIntegrationFromMongo(updatedDoc);
        }
      }

      if (existing?.status === 'PROCESSING') {
        log('warn', 'Suppressing duplicate scheduled integration while existing row is processing', {
          existingId: existing._id?.toString?.(),
          integrationName: integrationName,
          orgId,
          originalEventId: data.originalEventId,
        });
        return mapScheduledIntegrationFromMongo(existing);
      }
    }

    const result = await db.collection('scheduled_integrations').insertOne(scheduledIntegration);
    scheduledIntegration._id = result.insertedId;

    log('info', 'Scheduled integration created', {
      id: result.insertedId.toString(),
      integrationName: integrationName,
      scheduledFor: data.scheduledFor,
      eventType: data.eventType,
    });

    return {
      id: result.insertedId.toString(),
      ...scheduledIntegration,
      scheduledFor: scheduledIntegration.scheduledFor.toISOString(),
      orgId: scheduledIntegration.orgId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  } catch (err) {
    logError(err, { scope: 'createScheduledIntegration' });
    throw err;
  }
}

function buildScheduledReminderDedupeQuery(scheduledIntegration, sourceData, integrationConfigObjectId, orgId) {
  if (sourceData?.recurringConfig) {
    return null;
  }

  const messageType = sourceData?.payload?.metadata?.messageType;
  const bookingNumber =
    sourceData?.originalPayload?.appt?.bookingNumber ||
    sourceData?.payload?.metadata?.bookingNumber ||
    sourceData?.payload?.bookingNumber;
  const appointmentDate =
    sourceData?.payload?.metadata?.appointmentDate ||
    sourceData?.originalPayload?.appt?.apptDate ||
    sourceData?.originalPayload?.appt?.fromDate;

  const baseQuery = {
    orgId,
    integrationConfigId: integrationConfigObjectId,
    status: { $in: ['PENDING', 'OVERDUE', 'PROCESSING', 'SENT'] },
  };

  if (messageType && bookingNumber && appointmentDate) {
    return {
      ...baseQuery,
      'payload.metadata.messageType': messageType,
      'originalPayload.appt.bookingNumber': bookingNumber,
      $or: [
        { 'payload.metadata.appointmentDate': appointmentDate },
        { 'originalPayload.appt.apptDate': appointmentDate },
      ],
    };
  }

  if (scheduledIntegration.originalEventId) {
    return {
      ...baseQuery,
      originalEventId: scheduledIntegration.originalEventId,
      eventType: scheduledIntegration.eventType,
    };
  }

  return null;
}

/**
 * List scheduled integrations with filters
 * @param {number} orgId - Entity parent RID
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} List of scheduled integrations
 */
async function listScheduledIntegrations(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const query = scheduledOrgQuery(normalizedOrgId);

      if (filters.status) {
        query.status = filters.status;
      }
      if (filters.integrationConfigId || filters.integrationConfigId || filters.webhookConfigId) {
        query.integrationConfigId = mongodb.toObjectId(
          filters.integrationConfigId || filters.integrationConfigId || filters.webhookConfigId
        );
      }
      if (filters.eventType) {
        query.eventType = filters.eventType;
      }

      // Add a time-based filter to only show upcoming or recently overdue events
      // Avoids loading the entire collection
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      query.scheduledFor = { $gte: twoDaysAgo };

      const limit = filters.limit || 500;

      const integrations = await db
        .collection('scheduled_integrations')
        .find(query)
        .hint('org_status_scheduled_idx')
        .sort({ scheduledFor: 1 })
        .limit(limit)
        .toArray();

      return integrations.map(mapScheduledIntegrationFromMongo);
    } catch (err) {
      logError(err, { scope: 'listScheduledIntegrations', orgId, filters });
      throw err;
    }
  }
  return fallbackDisabledError('listScheduledIntegrations:fallback');
}

/**
 * Stream every scheduled delivery matching the supplied filters for exports.
 * Unlike the operational list, exports intentionally include historical rows.
 */
async function streamScheduledIntegrationsForExport(orgId, filters = {}, onRow, { shouldStop } = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return;
  if (!useMongo()) {
    return fallbackDisabledError('streamScheduledIntegrationsForExport:fallback');
  }

  try {
    const db = await mongodb.getDbSafe();
    const query = scheduledOrgQuery(normalizedOrgId);

    if (filters.status) query.status = filters.status;
    if (filters.integrationConfigId || filters.webhookConfigId) {
      query.integrationConfigId = mongodb.toObjectId(filters.integrationConfigId || filters.webhookConfigId);
    }
    if (filters.eventType) query.eventType = filters.eventType;

    const cursor = db.collection('scheduled_integrations').find(query).sort({ scheduledFor: -1 });
    try {
      for await (const scheduledIntegration of cursor) {
        if (shouldStop?.()) break;
        await onRow(mapScheduledIntegrationFromMongo(scheduledIntegration));
      }
    } finally {
      await cursor.close?.();
    }
  } catch (err) {
    logError(err, { scope: 'streamScheduledIntegrationsForExport', orgId, filters });
    throw err;
  }
}

/**
 * Get pending scheduled integrations ready to be sent
 * @param {number} limit - Max number to fetch
 * @returns {Promise<Array>} Integrations ready to send
 */
async function getPendingScheduledIntegrations(limit = 10) {
  if (!useMongo()) {
    return [];
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();
    const claimedIntegrations = [];

    // ATOMIC CLAIM: Use findOneAndUpdate to atomically claim each integration
    // This prevents race conditions where multiple worker cycles process the same integration
    for (let i = 0; i < limit; i++) {
      const result = await db.collection('scheduled_integrations').findOneAndUpdate(
        {
          status: { $in: ['PENDING', 'OVERDUE'] },
          scheduledFor: { $lte: now },
        },
        {
          $set: {
            status: 'PROCESSING',
            processingStartedAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          sort: { scheduledFor: 1 },
          returnDocument: 'after',
        }
      );

      // No more pending integrations found
      // MongoDB findOneAndUpdate returns {value: document} structure
      if (!result || !result.value) {
        break;
      }

      const doc = result.value;
      const integrationConfigId = doc.integrationConfigId?.toString?.() || doc.integrationConfigId;
      claimedIntegrations.push({
        id: doc._id.toString(),
        integrationConfigId,
        webhookConfigId:
          doc.webhookConfigId?.toString?.() ||
          integrationConfigId,
        webhookName: doc.webhookName || doc.integrationName,
        integrationName: doc.integrationName,
        orgId: doc.orgId || doc.entityRid,
        orgUnitRid: doc.orgUnitRid || doc.entityRid || doc.orgId,
        originalEventId: doc.originalEventId,
        eventType: doc.eventType,
        scheduledFor: doc.scheduledFor.toISOString(),
        status: doc.status,
        payload: doc.payload,
        originalPayload: doc.originalPayload,
        targetUrl: doc.targetUrl,
        httpMethod: doc.httpMethod,
        recurringConfig: doc.recurringConfig,
        cancellationInfo: doc.cancellationInfo,
        subject: doc.subject || null,
        cancelOnEvents: doc.cancelOnEvents || [],
        createdAt: doc.createdAt?.toISOString(),
        attemptCount: doc.attemptCount || 0,
      });
    }

    log('debug', `Atomically claimed ${claimedIntegrations.length} scheduled integrations`, {
      claimed: claimedIntegrations.length,
      requestedLimit: limit,
    });

    return claimedIntegrations;
  } catch (err) {
    logError(err, { scope: 'getPendingScheduledIntegrations' });
    return [];
  }
}

/**
 * Update scheduled integration status
 * @param {string} id - Scheduled integration ID
 * @param {string} status - New status
 * @param {Object} details - Additional details (errorMessage, deliveredAt)
 * @returns {Promise<boolean>}
 */
async function updateScheduledIntegrationStatus(id, status, details = {}) {
  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();
    const updateDoc = {
      status,
      updatedAt: new Date(),
    };

    if (details.errorMessage) {
      updateDoc.errorMessage = details.errorMessage;
    }
    if (details.deliveredAt) {
      updateDoc.deliveredAt = new Date(details.deliveredAt);
    }
    if (details.deliveryLogId) {
      updateDoc.deliveryLogId = details.deliveryLogId;
    }
    if (details.attemptCount !== undefined) {
      updateDoc.attemptCount = details.attemptCount;
    }
    // CRITICAL: Update scheduledFor when rescheduling with backoff
    if (details.scheduledFor) {
      updateDoc.scheduledFor = new Date(details.scheduledFor);
      log('debug', 'Rescheduling integration with backoff', {
        id,
        newScheduledFor: details.scheduledFor,
        attemptCount: details.attemptCount,
      });
    }

    // SAFETY: Only update if currently in PROCESSING state (or PENDING/OVERDUE for cancellation)
    // This prevents race conditions where multiple workers try to update the same integration
    const query = { _id: mongodb.toObjectId(id) };

    // For SENT/FAILED, require current status to be PROCESSING
    // For CANCELLED, also allow PENDING/OVERDUE (for cancelling before delivery)
    // For PENDING (retry), require PROCESSING (already claimed by this worker)
    if (status === 'SENT' || status === 'FAILED') {
      query.status = 'PROCESSING';
    } else if (status === 'CANCELLED') {
      query.status = { $in: ['PENDING', 'OVERDUE', 'PROCESSING'] };
    } else if (status === 'PENDING' && details.scheduledFor) {
      // Retry case: must be PROCESSING (we own it)
      query.status = 'PROCESSING';
    }

    const result = await db.collection('scheduled_integrations').updateOne(query, { $set: updateDoc });

    if (result.matchedCount === 0) {
      log('warn', 'Scheduled integration status update failed - integration not in expected state', {
        id,
        newStatus: status,
        details,
      });
      return false;
    }

    log('debug', 'Scheduled integration status updated', { id, status });
    return true;
  } catch (err) {
    logError(err, { scope: 'updateScheduledIntegrationStatus', id });
    return false;
  }
}

/**
 * Reset stuck integrations that have been PROCESSING for too long
 * This prevents integrations from getting stuck if worker crashes during processing
 * @param {number} timeoutMinutes - How long a integration can be PROCESSING before reset (default: 10 minutes)
 * @returns {Promise<number>} Number of integrations reset
 */
async function resetStuckProcessingIntegrations(timeoutMinutes = 10) {
  if (!useMongo()) {
    return 0;
  }

  try {
    const db = await mongodb.getDbSafe();
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const stuckThreshold = new Date(Date.now() - timeoutMs);

    const result = await db.collection('scheduled_integrations').updateMany(
      {
        status: 'PROCESSING',
        processingStartedAt: { $lt: stuckThreshold },
      },
      {
        $set: {
          status: 'PENDING',
          updatedAt: new Date(),
        },
        $unset: {
          processingStartedAt: '',
        },
      }
    );

    if (result.modifiedCount > 0) {
      log('warn', `Reset ${result.modifiedCount} stuck PROCESSING integrations back to PENDING`, {
        modifiedCount: result.modifiedCount,
        timeoutMinutes,
        stuckThreshold: stuckThreshold.toISOString(),
      });
    }

    return result.modifiedCount;
  } catch (err) {
    logError(err, { scope: 'resetStuckProcessingIntegrations' });
    return 0;
  }
}

function normalizeScheduledLifecycleRule(scheduled, criteria) {
  const rowRule = findLifecycleRule(scheduled.lifecycleRules, criteria.eventType);
  if (rowRule) {
    return rowRule;
  }

  const fallbackRule = criteria.lifecycleRule || null;
  const rowCancelOnEvents = Array.isArray(scheduled.cancelOnEvents) ? scheduled.cancelOnEvents : [];

  if (!criteria.eventType) {
    return fallbackRule;
  }

  if (rowCancelOnEvents.length === 0 || rowCancelOnEvents.includes(criteria.eventType)) {
    return fallbackRule;
  }

  return null;
}

async function resolveScheduledSubject(scheduled, criteria) {
  if (scheduled.subject?.data) {
    return scheduled.subject;
  }

  const subjectExtraction =
    normalizeSubjectExtraction(scheduled.subjectExtraction, scheduled.subjectMapping) ||
    normalizeSubjectExtraction(criteria.subjectExtraction);

  if (!subjectExtraction || !scheduled.originalPayload) {
    return null;
  }

  return normalizeEventSubject(scheduled.eventType || criteria.eventType || '', scheduled.originalPayload, {
    subjectType: scheduled.subject?.subjectType || criteria.subject?.subjectType || null,
    subjectExtraction,
  });
}

async function findScheduledIntegrationsByMatch(orgId, criteria) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];
  if (!useMongo()) return [];

  try {
    const db = await mongodb.getDbSafe();
    const integrationConfigObjectId = criteria.integrationConfigId
      ? mongodb.toObjectId(criteria.integrationConfigId) || criteria.integrationConfigId
      : null;

    const query = {
      ...scheduledOrgQuery(normalizedOrgId),
      status: { $in: ['PENDING', 'OVERDUE'] },
    };

    if (integrationConfigObjectId) {
      query.integrationConfigId = integrationConfigObjectId;
    }

    const candidates = await applyCursorHint(
      db.collection('scheduled_integrations').find(query, {
        projection: {
          _id: 1,
          integrationName: 1,
          scheduledFor: 1,
          status: 1,
          eventType: 1,
          subject: 1,
          subjectExtraction: 1,
          lifecycleRules: 1,
          cancelOnEvents: 1,
          originalPayload: 1,
        },
      }),
      'org_integration_status_scheduled_idx'
    )
      .toArray();

    const matches = [];

    for (const scheduled of candidates) {
      const lifecycleRule = normalizeScheduledLifecycleRule(scheduled, criteria);
      if (!lifecycleRule || !INVALIDATING_ACTIONS.includes(lifecycleRule.action)) {
        continue;
      }

      const matchKeys = Array.isArray(lifecycleRule.matchKeys) ? lifecycleRule.matchKeys : [];
      if (matchKeys.length === 0) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const candidateSubject = await resolveScheduledSubject(scheduled, criteria);
      if (!candidateSubject?.data) {
        continue;
      }

      if (
        criteria.subject?.subjectType &&
        candidateSubject.subjectType &&
        criteria.subject.subjectType !== candidateSubject.subjectType
      ) {
        continue;
      }

      const match = matchSubjects(criteria.subject, candidateSubject, matchKeys);
      if (!match) {
        continue;
      }

      matches.push({
        id: scheduled._id,
        scheduledId: scheduled._id.toString(),
        integrationName: scheduled.integrationName || null,
        scheduledFor: scheduled.scheduledFor,
        status: scheduled.status,
        matchedOn: match.matchedOn,
      });
    }

    return matches;
  } catch (err) {
    logError(err, { scope: 'findScheduledIntegrationsByMatch' });
    return [];
  }
}

/**
 * Cancel scheduled integrations that match a normalized lifecycle subject.
 *
 * @param {number} orgId
 * @param {{ eventType: string, integrationConfigId?: string, subject: Object, lifecycleRule?: Object, subjectExtraction?: Object }} criteria
 * @returns {Promise<number>} Number of cancelled rows
 */
async function cancelScheduledIntegrationsByMatch(orgId, criteria) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return 0;
  if (!useMongo()) return 0;

  if (!criteria?.subject?.data) {
    log('warn', 'cancelScheduledIntegrationsByMatch: no usable subject keys, skipping', {
      orgId: normalizedOrgId,
      eventType: criteria?.eventType,
    });
    return 0;
  }

  try {
    const db = await mongodb.getDbSafe();
    const matches = await findScheduledIntegrationsByMatch(normalizedOrgId, criteria);

    if (matches.length === 0) {
      return 0;
    }

    const result = await db.collection('scheduled_integrations').updateMany(
      {
        ...scheduledOrgQuery(normalizedOrgId),
        _id: { $in: matches.map((match) => match.id) },
        status: { $in: ['PENDING', 'OVERDUE'] },
      },
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: `Auto-cancelled by ${criteria.eventType}`,
          updatedAt: new Date(),
        },
      }
    );

    log('info', 'Scheduled integrations cancelled by subject match', {
      orgId: normalizedOrgId,
      eventType: criteria.eventType,
      subjectType: criteria.subject.subjectType,
      cancelledCount: result.modifiedCount,
      matchedRows: matches.length,
      matchedOn: Array.from(new Set(matches.map((match) => match.matchedOn))),
    });

    return result.modifiedCount;
  } catch (err) {
    logError(err, { scope: 'cancelScheduledIntegrationsByMatch' });
    return 0;
  }
}

/**
 * Update a scheduled integration
 * @param {number} orgId - Organization/tenant ID
 * @param {string} id - Scheduled integration ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<boolean>} Success status
 */
async function updateScheduledIntegration(orgId, id, updates) {
  const normalizedOrgId = normalizeOrgId(orgId);

  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();

    const query = { _id: mongodb.toObjectId(id) };
    if (normalizedOrgId) {
      Object.assign(query, scheduledOrgQuery(normalizedOrgId));
    }

    // Prepare update document
    const updateDoc = {
      ...updates,
      updatedAt: new Date(),
    };

    // If scheduledFor is being updated, recalculate status
    if (updates.scheduledFor) {
      const now = Date.now();
      const scheduledTime = new Date(updates.scheduledFor).getTime();

      // Only update status if currently PENDING or OVERDUE
      const existing = await db.collection('scheduled_integrations').findOne(query);
      if (existing && (existing.status === 'PENDING' || existing.status === 'OVERDUE')) {
        updateDoc.status = scheduledTime <= now ? 'OVERDUE' : 'PENDING';
      }
    }

    const result = await db.collection('scheduled_integrations').updateOne(query, { $set: updateDoc });

    return result.matchedCount > 0;
  } catch (err) {
    logError(err, { scope: 'updateScheduledIntegration', id });
    return false;
  }
}

async function deleteScheduledIntegration(orgId, id) {
  if (id === undefined) {
    id = orgId;
    orgId = null;
  }

  const normalizedOrgId = normalizeOrgId(orgId);

  if (!useMongo()) {
    return false;
  }

  try {
    const db = await mongodb.getDbSafe();

    // Soft delete by marking as CANCELLED
    const query = { _id: mongodb.toObjectId(id) };
    if (normalizedOrgId) {
      Object.assign(query, scheduledOrgQuery(normalizedOrgId));
    }

    const result = await db.collection('scheduled_integrations').updateOne(query, {
      $set: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: 'Manual cancellation',
        updatedAt: new Date(),
      },
    });

    log('info', 'Scheduled integration cancelled', { id, orgId: normalizedOrgId });
    return result.matchedCount > 0;
  } catch (err) {
    logError(err, { scope: 'deleteScheduledIntegration', id, orgId: normalizedOrgId });
    return false;
  }
}

/**
 * Get status counts for scheduled integrations (for stats cards).
 * Uses an in-memory cache with 30s TTL (max 500 entries, LRU eviction).
 * @param {string} orgId
 * @param {Object} filters - integrationConfigId, eventType (no status filter)
 * @returns {Promise<{ total: number, pending: number, overdue: number, sent: number, failed: number, cancelled: number }>}
 */
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

async function getScheduledIntegrationsStats(orgId, filters = {}) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    return { total: 0, pending: 0, overdue: 0, sent: 0, failed: 0, cancelled: 0 };
  }

  // Exclude status from cache key so stats are always the same regardless of status filter
  const { status: _status, ...filtersWithoutStatus } = filters;
  const cacheKey = _buildStatsCacheKey(normalizedOrgId, filtersWithoutStatus);

  const cached = _statsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
    return cached.value;
  }

  if (!useMongo()) {
    return { total: 0, pending: 0, overdue: 0, sent: 0, failed: 0, cancelled: 0 };
  }

  try {
    const db = await mongodb.getDbSafe();
    const query = {
      ...scheduledOrgQuery(normalizedOrgId),
      scheduledFor: { $gte: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    };

    if (
      filtersWithoutStatus.integrationConfigId ||
      filtersWithoutStatus.integrationConfigId ||
      filtersWithoutStatus.webhookConfigId
    ) {
      query.integrationConfigId = mongodb.toObjectId(
        filtersWithoutStatus.integrationConfigId ||
          filtersWithoutStatus.integrationConfigId ||
          filtersWithoutStatus.webhookConfigId
      );
    }
    if (filtersWithoutStatus.eventType) {
      query.eventType = filtersWithoutStatus.eventType;
    }

    const pipeline = [
      { $match: query },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $eq: ['$status', 'OVERDUE'] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
        },
      },
    ];

    const [result] = await db
      .collection('scheduled_integrations')
      .aggregate(pipeline, { allowDiskUse: true, hint: 'org_status_scheduled_idx' })
      .toArray();

    const summary = {
      total: result?.total ?? 0,
      pending: result?.pending ?? 0,
      overdue: result?.overdue ?? 0,
      sent: result?.sent ?? 0,
      failed: result?.failed ?? 0,
      cancelled: result?.cancelled ?? 0,
    };

    // LRU eviction
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
    logError(err, { scope: 'getScheduledIntegrationsStats', orgId });
    throw err;
  }
}

module.exports = {
  createScheduledIntegration,
  listScheduledIntegrations,
  streamScheduledIntegrationsForExport,
  getPendingScheduledIntegrations,
  updateScheduledIntegrationStatus,
  resetStuckProcessingIntegrations,
  findScheduledIntegrationsByMatch,
  cancelScheduledIntegrationsByMatch,
  updateScheduledIntegration,
  deleteScheduledIntegration,
  buildScheduledReminderDedupeQuery,
  getScheduledIntegrationsStats,
};
