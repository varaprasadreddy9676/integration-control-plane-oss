'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const { useMongo, fallbackDisabledError } = require('./helpers');
const { applyCursorHint } = require('../utils/index-hints');

// New functions for retry logic
async function getFailedLogsForRetry(batchSize = 3) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

      // Simple indexed query: status + recency. The $or on lastAttemptAt/$exists
      // caused COLLSCAN on 22GB collection; covering updatedAt as fallback is enough.
      const logs = await applyCursorHint(
        db.collection('execution_logs').find({
          status: 'RETRYING',
          triggerType: { $nin: ['SCHEDULE', 'SCHEDULED'] },
          updatedAt: { $gt: fourHoursAgo },
        }),
        'retry_query_idx'
      )
        .sort({ lastAttemptAt: -1 })
        .limit(batchSize)
        .toArray();

      if (logs.length === 0) return [];

      // Batch-fetch all required integrations in a single query — avoids N+1
      const { mapLogFromMongo } = require('./helpers');
      const integrationIds = [
        ...new Set(logs.map((l) => l.integrationConfigId || l.integrationConfigId).filter(Boolean)),
      ];
      const integrationDocs = await db
        .collection('integration_configs')
        .find(
          { _id: { $in: integrationIds.map((id) => mongodb.toObjectId(id)) } },
          { projection: { _id: 1, retryCount: 1 } }
        )
        .toArray();
      const integrationMap = new Map(integrationDocs.map((doc) => [doc._id.toString(), doc]));

      return logs
        .filter((logDoc) => {
          const integrationId = String(logDoc.integrationConfigId || logDoc.integrationConfigId || '');
          const integration = integrationMap.get(integrationId);
          return integration && logDoc.attemptCount <= integration.retryCount;
        })
        .map(mapLogFromMongo);
    }
    return fallbackDisabledError('getFailedLogsForRetry:fallback');
  } catch (err) {
    logError(err, { scope: 'getFailedLogsForRetry' });
    throw err;
  }
}

async function markLogAsAbandoned(logId) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      await db
        .collection('execution_logs')
        .updateOne(
          { _id: mongodb.toObjectId(logId) },
          { $set: { status: 'ABANDONED', shouldRetry: false, updatedAt: new Date() } }
        );
    } else {
      return fallbackDisabledError('markLogAsAbandoned:fallback');
    }
    log('info', 'Log marked as abandoned', { logId });
  } catch (err) {
    logError(err, { scope: 'markLogAsAbandoned', logId });
    throw err;
  }
}

// Simple data cleanup function
async function cleanupOldData() {
  try {
    if (useMongo()) {
      // MongoDB handles cleanup automatically with TTL indexes
      // execution_logs: 90 days (7776000 seconds)
      // processed_events: 1 hour (3600 seconds)
      log('info', 'Data cleanup handled by MongoDB TTL indexes');
      return;
    }
    return fallbackDisabledError('cleanupOldData:fallback');
  } catch (err) {
    logError(err, { scope: 'cleanupOldData' });
    throw err;
  }
}

// Cleanup stuck RETRYING logs that are older than the retry window
async function cleanupStuckRetryingLogs(hoursThreshold = 4) {
  try {
    if (useMongo()) {
      const db = await mongodb.getDbSafe();
      const thresholdTime = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);

      // Find logs stuck in RETRYING status beyond the retry window
      const result = await db.collection('execution_logs').updateMany(
        {
          status: 'RETRYING',
          $or: [
            // Old logs with lastAttemptAt field
            { lastAttemptAt: { $lt: thresholdTime } },
            // Legacy logs without lastAttemptAt but with updatedAt
            { lastAttemptAt: { $exists: false }, updatedAt: { $lt: thresholdTime } },
            // Very old logs without either field
            { lastAttemptAt: { $exists: false }, updatedAt: { $exists: false }, createdAt: { $lt: thresholdTime } },
          ],
        },
        {
          $set: {
            status: 'ABANDONED',
            shouldRetry: false,
            errorMessage: `Exceeded ${hoursThreshold}-hour retry window - automatically abandoned`,
            updatedAt: new Date(),
          },
        }
      );

      log('info', 'Cleaned up stuck RETRYING logs', {
        hoursThreshold,
        logsUpdated: result.modifiedCount,
      });

      return {
        success: true,
        logsUpdated: result.modifiedCount,
        hoursThreshold,
      };
    }
    return fallbackDisabledError('cleanupStuckRetryingLogs:fallback');
  } catch (err) {
    logError(err, { scope: 'cleanupStuckRetryingLogs' });
    throw err;
  }
}

/**
 * Check circuit breaker state for a integration
 * @param {string} integrationId - Integration configuration ID
 * @returns {Promise<{isOpen: boolean, state: string, reason: string}>}
 */
async function checkCircuitState(integrationId) {
  if (!useMongo()) {
    return { isOpen: false, state: 'CLOSED', reason: null };
  }

  try {
    const db = await mongodb.getDbSafe();
    const integration = await db.collection('integration_configs').findOne({ _id: mongodb.toObjectId(integrationId) });

    if (!integration) {
      return { isOpen: false, state: 'CLOSED', reason: 'Integration not found' };
    }

    // Allow per-integration circuit breaker opt-out
    if (integration.circuitBreakerEnabled === false) {
      return { isOpen: false, state: 'CLOSED', reason: null };
    }

    const circuitState = integration.circuitState || 'CLOSED';
    const consecutiveFailures = integration.consecutiveFailures || 0;
    const circuitBreakerThreshold = integration.circuitBreakerThreshold || 10;
    const circuitRecoveryTimeMs = integration.circuitRecoveryTimeMs || 5 * 60 * 1000; // 5 minutes
    const circuitOpenedAt = integration.circuitOpenedAt;

    // If circuit is OPEN, check if recovery time has passed
    if (circuitState === 'OPEN' && circuitOpenedAt) {
      const now = new Date();
      const timeSinceOpen = now - new Date(circuitOpenedAt);

      if (timeSinceOpen >= circuitRecoveryTimeMs) {
        // Try HALF_OPEN - allow one test request
        await db.collection('integration_configs').updateOne(
          { _id: mongodb.toObjectId(integrationId) },
          {
            $set: {
              circuitState: 'HALF_OPEN',
              updatedAt: now,
            },
          }
        );
        log('info', 'Circuit breaker moved to HALF_OPEN', {
          integrationId,
          integrationName: integration.name,
          timeSinceOpen: `${Math.round(timeSinceOpen / 1000)}s`,
        });
        return { isOpen: false, state: 'HALF_OPEN', reason: 'Testing recovery' };
      }

      const lastError = integration.lastCircuitError ? ` Last error: ${integration.lastCircuitError}.` : '';
      return {
        isOpen: true,
        state: 'OPEN',
        reason: `Circuit open after ${consecutiveFailures} consecutive failures.${lastError} Retry in ${Math.round((circuitRecoveryTimeMs - timeSinceOpen) / 1000)}s`,
        lastCircuitError: integration.lastCircuitError || null,
      };
    }

    // Circuit is CLOSED or HALF_OPEN - allow delivery
    return { isOpen: false, state: circuitState, reason: null };
  } catch (err) {
    logError(err, { scope: 'checkCircuitState', integrationId });
    // On error, allow delivery (fail open)
    return { isOpen: false, state: 'UNKNOWN', reason: 'Circuit check failed' };
  }
}

/**
 * Record successful delivery - reset circuit breaker
 * @param {string} integrationId - Integration configuration ID
 */
async function recordDeliverySuccess(integrationId) {
  if (!useMongo()) return;

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();

    await db.collection('integration_configs').updateOne(
      { _id: mongodb.toObjectId(integrationId) },
      {
        $set: {
          circuitState: 'CLOSED',
          consecutiveFailures: 0,
          lastSuccessAt: now,
          circuitOpenedAt: null,
          updatedAt: now,
        },
      }
    );

    log('debug', 'Circuit breaker reset to CLOSED', { integrationId });
  } catch (err) {
    logError(err, { scope: 'recordDeliverySuccess', integrationId });
  }
}

async function resetCircuitState(integrationId, options = {}) {
  if (!useMongo()) {
    return {
      integrationId,
      before: { state: 'UNKNOWN' },
      after: { state: 'CLOSED', consecutiveFailures: 0 },
      modifiedCount: 0,
    };
  }

  const db = await mongodb.getDbSafe();
  const objectId = mongodb.toObjectId(integrationId);
  const integration = await db.collection('integration_configs').findOne({ _id: objectId });
  if (!integration) return null;

  const now = new Date();
  const before = {
    state: integration.circuitState || 'CLOSED',
    consecutiveFailures: integration.consecutiveFailures || 0,
    circuitOpenedAt: integration.circuitOpenedAt || null,
    lastCircuitError: integration.lastCircuitError || null,
  };

  const result = await db.collection('integration_configs').updateOne(
    { _id: objectId },
    {
      $set: {
        circuitState: 'CLOSED',
        consecutiveFailures: 0,
        circuitOpenedAt: null,
        lastCircuitError: null,
        updatedAt: now,
        circuitResetAt: now,
        circuitResetBy: options.userId || options.actor || null,
        circuitResetReason: options.reason || null,
      },
    }
  );

  return {
    integrationId,
    before,
    after: {
      state: 'CLOSED',
      consecutiveFailures: 0,
      circuitOpenedAt: null,
      lastCircuitError: null,
    },
    modifiedCount: result.modifiedCount || 0,
  };
}

/**
 * Record failed delivery - increment circuit breaker counter
 * @param {string} integrationId - Integration configuration ID
 * @param {Object} options - Options for failure recording
 * @param {boolean} options.shouldTripCircuit - Whether this failure should count toward circuit breaker (default: true for backward compatibility)
 */
async function recordDeliveryFailure(integrationId, options = {}) {
  if (!useMongo()) return;

  const { shouldTripCircuit = true, lastErrorMessage } = options;

  // If this is a business logic failure (validation, transformation, 4xx), don't trip circuit breaker
  if (!shouldTripCircuit) {
    log('debug', 'Failure recorded but not counting toward circuit breaker (business logic failure)', {
      integrationId,
    });
    return;
  }

  try {
    const db = await mongodb.getDbSafe();
    const now = new Date();

    // Single atomic aggregation-pipeline update (MongoDB 4.2+).
    // Computes the new failure count AND decides whether to open the circuit
    // in one write, eliminating the race where a concurrent recordDeliverySuccess
    // could reset the counter between two separate writes.
    const newCount = { $add: [{ $ifNull: ['$consecutiveFailures', 0] }, 1] };
    const threshold = { $ifNull: ['$circuitBreakerThreshold', 10] };
    const shouldOpen = {
      $or: [
        // HALF_OPEN → always reopen on failure
        { $eq: ['$circuitState', 'HALF_OPEN'] },
        // CLOSED → open if threshold reached
        {
          $and: [{ $eq: ['$circuitState', 'CLOSED'] }, { $gte: [newCount, threshold] }],
        },
      ],
    };

    const updated = await db.collection('integration_configs').findOneAndUpdate(
      { _id: mongodb.toObjectId(integrationId) },
      [
        {
          $set: {
            consecutiveFailures: newCount,
            lastFailureAt: now,
            updatedAt: now,
            lastCircuitError: lastErrorMessage
              ? { $substr: [{ $toString: String(lastErrorMessage) }, 0, 500] }
              : '$lastCircuitError',
            circuitState: {
              $switch: {
                branches: [
                  { case: { $eq: ['$circuitState', 'HALF_OPEN'] }, then: 'OPEN' },
                  {
                    case: {
                      $and: [{ $eq: ['$circuitState', 'CLOSED'] }, { $gte: [newCount, threshold] }],
                    },
                    then: 'OPEN',
                  },
                ],
                default: '$circuitState',
              },
            },
            circuitOpenedAt: {
              $cond: [shouldOpen, now, '$circuitOpenedAt'],
            },
          },
        },
      ],
      { returnDocument: 'after' }
    );

    if (!updated) return;

    log('debug', 'Circuit breaker failure recorded', {
      integrationId,
      integrationName: updated.name,
      consecutiveFailures: updated.consecutiveFailures,
      circuitState: updated.circuitState,
    });
  } catch (err) {
    logError(err, { scope: 'recordDeliveryFailure', integrationId });
  }
}

/**
 * Active outbound integrations worth checking for the delivery-failure health
 * watcher (services/delivery-failure-health.js): every one currently failing
 * (consecutiveFailures > 0, the same counter the circuit breaker uses — reset
 * only by recordDeliverySuccess, so it stays true across HALF_OPEN retries),
 * plus any previously-tracked one so the watcher can see it stopped failing.
 * A tracked id absent from the result (deactivated or deleted) is left for the
 * caller to drop without a "recovered" alert.
 *
 * @param {string[]} trackedIds integration ids already in the watcher's episodes
 */
async function listFailingOrTrackedIntegrations(trackedIds = []) {
  if (!useMongo()) return [];

  try {
    const db = await mongodb.getDbSafe();
    const trackedObjectIds = trackedIds.map((id) => mongodb.toObjectId(id)).filter(Boolean);
    const docs = await db
      .collection('integration_configs')
      .find(
        {
          direction: 'OUTBOUND',
          isActive: true,
          $or: [
            { consecutiveFailures: { $gt: 0 } },
            ...(trackedObjectIds.length ? [{ _id: { $in: trackedObjectIds } }] : []),
          ],
        },
        {
          projection: { name: 1, orgId: 1, consecutiveFailures: 1, lastSuccessAt: 1, lastCircuitError: 1 },
        }
      )
      .toArray();

    return docs.map((doc) => ({
      id: doc._id.toString(),
      orgId: doc.orgId,
      name: doc.name,
      consecutiveFailures: doc.consecutiveFailures || 0,
      lastSuccessAt: doc.lastSuccessAt || null,
      lastCircuitError: doc.lastCircuitError || null,
    }));
  } catch (err) {
    logError(err, { scope: 'listFailingOrTrackedIntegrations' });
    return [];
  }
}

module.exports = {
  getFailedLogsForRetry,
  markLogAsAbandoned,
  cleanupOldData,
  cleanupStuckRetryingLogs,
  checkCircuitState,
  resetCircuitState,
  recordDeliverySuccess,
  recordDeliveryFailure,
  listFailingOrTrackedIntegrations,
};
