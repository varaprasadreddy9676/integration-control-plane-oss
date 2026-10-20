const { MongoClient, ObjectId, Collection } = require('mongodb');
const config = require('./config');
const { log } = require('./logger');
const { primeIndexCache, registerIndexHealer, installHintSafetyNet } = require('./utils/index-hints');
const { installEncryptionAtRest } = require('./utils/secrets-at-rest');
const { installModifyResultCompat } = require('./utils/mongo-modify-result-compat');

// findOneAnd* keep returning { value } on driver 6+ (installed first, so the
// layers below see the shape they were written for).
installModifyResultCompat(Collection);

// Every hinted query in the app survives a dropped collection or index.
installHintSafetyNet(Collection);
// Integration credentials are stored encrypted; every reader gets plaintext.
// Installed after the hint safety net so its retries stay decrypted.
installEncryptionAtRest(Collection);

let client;
let db;

// Lets a query that finds a missing index trigger a repair, without this module
// and index-hints requiring each other.
registerIndexHealer(async () => {
  if (!db) return;
  await ensureIndexes();
});

// Isolates index-creation failures per collection so one bad/conflicting index
// definition (e.g. a stale index with the same name but different keys) doesn't
// abort every collection listed after it in ensureIndexes().
// 85 IndexOptionsConflict / 86 IndexKeySpecsConflict: an existing index clashes
// with the spec, either by name or by keys.
const INDEX_CONFLICT_CODES = new Set([85, 86]);

/** The index with this name, null if none, undefined if the list is unreadable. */
async function findIndexNamed(collection, name) {
  try {
    const indexes = await collection.indexes();
    return indexes.find((index) => index.name === name) || null;
  } catch {
    return undefined;
  }
}

/**
 * The code's definition wins over an older index of the same name (earlier
 * versions shipped different keys, and some indexed mangled field names such as
 * __KEEP_integrationName__). Dropping it first is safe: hinted queries fall back
 * to no hint until the rebuild finishes (see installHintSafetyNet). Unique
 * indexes are never replaced automatically — if the data had duplicates the
 * rebuild would fail and leave no uniqueness guard at all.
 */
async function createIndexOrReplaceStale(collection, spec) {
  try {
    await collection.createIndexes([spec]);
    return;
  } catch (error) {
    if (!INDEX_CONFLICT_CODES.has(error?.code)) throw error;
    const sameName = await findIndexNamed(collection, spec.name);
    // Same keys under a different name: the index this spec describes exists.
    if (sameName === null && error.code === 85) return;
    if (!sameName || spec.unique || sameName.unique) throw error;
    await collection.dropIndex(spec.name);
    await collection.createIndexes([spec]);
    log('info', 'Replaced stale MongoDB index with the current definition', {
      collection: collection.collectionName,
      index: spec.name,
    });
  }
}

// createIndexes() is all-or-nothing, so one conflicting spec used to drop every
// other index in the batch. On failure, go one index at a time.
async function safeCreateIndexes(collection, indexSpecs) {
  try {
    await collection.createIndexes(indexSpecs);
    return;
  } catch {
    // Fall through to per-index creation.
  }
  for (const spec of indexSpecs) {
    try {
      await createIndexOrReplaceStale(collection, spec);
    } catch (error) {
      log('warn', 'MongoDB index creation warning', {
        collection: collection.collectionName,
        index: spec.name,
        error: error.message,
      });
    }
  }
}

async function dropIndexIfPresent(collection, indexName) {
  try {
    const indexes = await collection.indexes();
    if (!indexes.some((index) => index.name === indexName)) {
      return;
    }
    await collection.dropIndex(indexName);
    log('info', 'Dropped obsolete MongoDB index', {
      collection: collection.collectionName,
      indexName,
    });
  } catch (error) {
    if (error?.code !== 27) {
      log('warn', 'Failed to drop MongoDB index', {
        collection: collection.collectionName,
        indexName,
        error: error.message,
      });
    }
  }
}

/**
 * The execution_logs text index is rebuilt in the background when its existing
 * definition is out of date: the original one had no orgId prefix, and
 * production's carried a mangled weight field (__KEEP_integrationName__) from an
 * old codemod, so search never matched integration names.
 */
function isStaleSearchTextIndex(index) {
  if (!index) return false;
  if (!index.key || !Object.prototype.hasOwnProperty.call(index.key, 'orgId')) return true;
  const weights = index.weights || {};
  return !('integrationName' in weights) || Object.keys(weights).some((field) => field.startsWith('__KEEP_'));
}

async function connect(retries = 3) {
  if (db) return db;

  const mongoConfig = config.mongodb || {
    uri: 'mongodb://localhost:27017',
    database: 'integration_gateway',
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      client = new MongoClient(mongoConfig.uri, {
        ...mongoConfig.options,
        serverSelectionTimeoutMS: 5000,
      });

      await client.connect();
      db = client.db(mongoConfig.database);

      log('info', 'Connected to MongoDB', {
        database: mongoConfig.database,
        uri: mongoConfig.uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'), // Hide password in logs
        attempt: attempt + 1,
      });

      return db;
    } catch (error) {
      const isLastAttempt = attempt === retries;

      if (!isLastAttempt) {
        const delayMs = Math.min(2000 * 2 ** attempt, 10000); // Max 10s
        log('warn', 'MongoDB connection failed, retrying', {
          attempt: attempt + 1,
          maxRetries: retries + 1,
          error: error.message,
          delayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        log('error', 'MongoDB connection failed after all retries', {
          error: error.message,
          attempts: retries + 1,
        });
        throw error;
      }
    }
  }
}

async function ensureIndexes() {
  try {
    // Integration configs indexes
    await safeCreateIndexes(db.collection('integration_configs'), [
      { key: { orgId: 1, type: 1 }, name: 'org_event_idx' },
      { key: { orgId: 1, isActive: 1 }, name: 'org_active_idx' },
      { key: { orgId: 1, direction: 1 }, name: 'org_direction_idx' },
      { key: { isActive: 1 }, name: 'active_idx' },
      { key: { updatedAt: -1 }, name: 'updated_idx' },
      // Token expiration index - sparse index for OAuth2/Custom auth token management
      { key: { 'outgoingAuthConfig._tokenExpiresAt': 1 }, name: 'token_expiry_idx', sparse: true },
    ]);

    // Users indexes
    await safeCreateIndexes(db.collection('users'), [
      { key: { email: 1 }, name: 'email_unique_idx', unique: true },
      { key: { orgId: 1, role: 1 }, name: 'org_role_idx' },
      { key: { isActive: 1 }, name: 'active_idx' },
    ]);

    // API keys (personal access tokens) indexes
    await safeCreateIndexes(db.collection('api_keys'), [
      { key: { keyHash: 1 }, name: 'key_hash_unique_idx', unique: true },
      { key: { orgId: 1 }, name: 'org_idx' },
    ]);

    // Organizations indexes
    await safeCreateIndexes(db.collection('organizations'), [
      { key: { orgId: 1 }, name: 'org_id_unique_idx', unique: true },
      { key: { name: 1 }, name: 'org_name_idx' },
    ]);

    // Organization units indexes
    await safeCreateIndexes(db.collection('org_units'), [
      { key: { rid: 1 }, name: 'unit_rid_unique_idx', unique: true },
      { key: { orgId: 1 }, name: 'unit_org_idx' },
    ]);

    // Delivery logs collection removed - now using unified execution_logs

    // Delivery attempts indexes - for detailed retry tracking
    await safeCreateIndexes(db.collection('delivery_attempts'), [
      { key: { deliveryLogId: 1, attemptNumber: 1 }, name: 'log_attempt_idx' },
      { key: { orgId: 1, attemptedAt: -1 }, name: 'org_attempted_idx' },
      { key: { integrationConfigId: 1, attemptedAt: -1 }, name: 'integration_attempted_idx' },
      { key: { status: 1, attemptedAt: -1 }, name: 'status_attempted_idx' },
      // TTL index - auto-delete attempt details after 90 days
      {
        key: { attemptedAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'ttl_idx',
      },
    ]);

    // Worker checkpoint
    await db
      .collection('worker_checkpoint')
      .createIndex({ workerId: 1 }, { unique: true, name: 'worker_id_unique_idx' })
      .catch((error) => {
        log('warn', 'MongoDB index creation warning', { collection: 'worker_checkpoint', error: error.message });
      });

    // Processed events - deduplication
    // Migration: Drop old TTL index if it exists with different TTL value
    try {
      const existingIndexes = await db.collection('processed_events').indexes();
      const oldTtlIndex = existingIndexes.find((idx) => idx.name === 'ttl_idx');

      if (oldTtlIndex && oldTtlIndex.expireAfterSeconds !== 21600) {
        log('info', 'Migrating processed_events TTL index from 1h to 6h', {
          oldTTL: oldTtlIndex.expireAfterSeconds,
          newTTL: 21600,
        });
        await db.collection('processed_events').dropIndex('ttl_idx');
        log('info', 'Old TTL index dropped, will recreate with new TTL');
      }
    } catch (err) {
      // Index might not exist yet, that's fine
      if (err.code !== 27) {
        // 27 = IndexNotFound
        log('warn', 'TTL index migration check failed', { error: err.message });
      }
    }

    await safeCreateIndexes(db.collection('processed_events'), [
      { key: { eventKey: 1 }, unique: true, name: 'event_key_unique_idx' },
      { key: { eventId: 1 }, unique: true, sparse: true, name: 'event_id_unique_idx' },
      { key: { orgId: 1, eventType: 1 }, name: 'org_event_idx' },
      // Auto-cleanup after 6 hours (matches retry window + buffer)
      {
        key: { processedAt: 1 },
        expireAfterSeconds: 21600,
        name: 'ttl_idx',
      },
    ]);

    // Integration templates indexes
    await safeCreateIndexes(db.collection('integration_templates'), [
      { key: { orgId: 1, category: 1 }, name: 'org_category_idx' },
      { key: { orgId: 1, updatedAt: -1 }, name: 'org_updated_idx' },
      { key: { category: 1 }, name: 'category_idx' },
      { key: { isActive: 1 }, name: 'active_idx' },
    ]);

    // Alert center logs indexes
    const alertCenterCollection = db.collection('alert_center_logs');
    await safeCreateIndexes(alertCenterCollection, [
      { key: { orgId: 1, createdAt: -1 }, name: 'alert_org_created_idx' },
      { key: { orgId: 1, status: 1, createdAt: -1 }, name: 'alert_org_status_created_idx' },
      { key: { orgId: 1, channel: 1, createdAt: -1 }, name: 'alert_org_channel_created_idx' },
      { key: { orgId: 1, type: 1, createdAt: -1 }, name: 'alert_org_type_created_idx' },
      {
        key: { createdAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'alert_ttl_idx',
      },
    ]);
    // Text index can take a long time on large datasets — run fire-and-forget.
    alertCenterCollection
      .createIndex(
        {
          orgId: 1,
          subject: 'text',
          errorMessage: 'text',
          recipients: 'text',
          searchableText: 'text',
        },
        {
          name: 'alert_search_text_idx',
          weights: {
            subject: 10,
            errorMessage: 8,
            recipients: 6,
            searchableText: 6,
          },
        }
      )
      .then(() => {
        log('info', 'MongoDB alert_center_logs text index created/verified');
      })
      .catch((error) => {
        log('warn', 'MongoDB alert_center_logs text index creation warning', { error: error.message });
      });

    // Event audit indexes - comprehensive event tracking
    await safeCreateIndexes(db.collection('event_audit'), [
      // Composite uniqueness: source + sourceId (when available)
      {
        key: { source: 1, sourceId: 1 },
        name: 'source_id_unique_idx',
        unique: true,
        // Keep partial expression compatible with older MongoDB servers.
        // `$ne: null` gets rewritten internally to `$not/$eq` and can be rejected.
        partialFilterExpression: { sourceId: { $exists: true } },
      },
      // Fallback uniqueness: orgId + eventKey + receivedAtBucket
      {
        key: { orgId: 1, eventKey: 1, receivedAtBucket: 1 },
        name: 'fallback_unique_idx',
        unique: true,
      },
      // Query performance indexes (all include orgId for tenant scoping)
      { key: { orgId: 1, receivedAt: -1 }, name: 'parent_received_idx' },
      { key: { orgId: 1, status: 1, receivedAt: -1 }, name: 'parent_status_received_idx' },
      { key: { orgId: 1, eventType: 1, receivedAt: -1 }, name: 'parent_event_received_idx' },
      { key: { orgId: 1, source: 1, receivedAt: -1 }, name: 'parent_source_received_idx' },
      { key: { orgId: 1, skipCategory: 1, receivedAt: -1 }, name: 'parent_skip_received_idx' },
      // Watchdog queries (find stuck events)
      { key: { status: 1, processingStartedAt: 1 }, name: 'status_processing_idx' },
      // Event ID lookup
      { key: { eventId: 1 }, name: 'event_id_idx' },
      // Tenant-scoped event ID lookup
      { key: { orgId: 1, eventId: 1 }, name: 'parent_event_id_idx' },
    ]);

    // Migration: Drop event_audit TTL index — records are kept forever; base64
    // data is redacted before storage (utils/payload-sanitizer).
    await dropIndexIfPresent(db.collection('event_audit'), 'ttl_idx');

    await safeCreateIndexes(db.collection('admin_audit'), [
      { key: { createdAt: -1 }, name: 'admin_audit_created_idx' },
      { key: { action: 1, createdAt: -1 }, name: 'admin_audit_action_created_idx' },
      { key: { adminRole: 1, createdAt: -1 }, name: 'admin_audit_role_created_idx' },
      { key: { adminId: 1, createdAt: -1 }, name: 'admin_audit_admin_id_created_idx' },
      { key: { adminEmail: 1, createdAt: -1 }, name: 'admin_audit_admin_email_created_idx' },
    ]);
    // Text index can take a long time on large datasets — run fire-and-forget.
    db.collection('admin_audit')
      .createIndex(
        {
          action: 'text',
          adminEmail: 'text',
          adminId: 'text',
        },
        {
          name: 'admin_audit_search_text_idx',
          weights: {
            action: 10,
            adminEmail: 8,
            adminId: 8,
          },
        }
      )
      .then(() => {
        log('info', 'MongoDB admin_audit text index created/verified');
      })
      .catch((error) => {
        log('warn', 'MongoDB admin_audit text index creation warning', { error: error.message });
      });

    // Source checkpoints indexes - for gap detection and negative proof
    await safeCreateIndexes(db.collection('source_checkpoints'), [
      // Unique per source + entity
      {
        key: { source: 1, sourceIdentifier: 1, orgId: 1 },
        name: 'source_entity_unique_idx',
        unique: true,
      },
      // Health check queries
      { key: { updatedAt: -1 }, name: 'updated_idx' },
      { key: { orgId: 1, source: 1 }, name: 'entity_source_idx' },
    ]);

    // Event types catalog indexes — field-schema.js does findOne(eventType+orgId) and find($or orgId/null)
    await safeCreateIndexes(db.collection('event_types'), [
      // Single event type lookup: {eventType, orgId} — covers getEventType() primary + fallback queries
      { key: { eventType: 1, orgId: 1 }, name: 'event_type_org_idx' },
      // List all for org: {orgId, isActive} — covers getAllEventTypes() $or query
      { key: { orgId: 1, isActive: 1 }, name: 'org_active_idx' },
    ]);

    // Lookups indexes - for code mapping system
    await safeCreateIndexes(db.collection('lookups'), [
      // UNIQUE constraint - Prevent duplicate active mappings for the same key
      {
        key: {
          orgId: 1,
          orgUnitRid: 1,
          type: 1,
          'source.id': 1,
          isActive: 1,
        },
        name: 'idx_unique_mapping',
        unique: true,
        partialFilterExpression: { isActive: true },
      },
      // Primary lookup index (optimized for hierarchy resolution)
      {
        key: {
          orgId: 1,
          orgUnitRid: 1,
          type: 1,
          'source.id': 1,
          isActive: 1,
        },
        name: 'idx_lookup',
      },
      // Reverse lookup index (with orgUnitRid for hierarchy support)
      {
        key: {
          orgId: 1,
          orgUnitRid: 1,
          type: 1,
          'target.id': 1,
          isActive: 1,
        },
        name: 'idx_reverse_lookup',
      },
      // List/filter index
      {
        key: { orgId: 1, type: 1, category: 1, isActive: 1 },
        name: 'idx_list',
      },
    ]);
    // Text index can take a long time on large datasets — run fire-and-forget.
    db.collection('lookups')
      .createIndex(
        {
          'source.id': 'text',
          'source.name': 'text',
          'target.id': 'text',
          'target.name': 'text',
        },
        { name: 'idx_text_search' }
      )
      .then(() => {
        log('info', 'MongoDB lookups text index created/verified');
      })
      .catch((error) => {
        log('warn', 'MongoDB lookups text index creation warning', { error: error.message });
      });

    // Scheduled job logs indexes - for execution history and monitoring
    await safeCreateIndexes(db.collection('scheduled_job_logs'), [
      { key: { orgId: 1, startedAt: -1 }, name: 'org_started_idx' },
      { key: { integrationId: 1, startedAt: -1 }, name: 'job_started_idx' },
      { key: { status: 1, startedAt: -1 }, name: 'status_started_idx' },
      { key: { correlationId: 1 }, name: 'correlation_idx' },
      // TTL index - auto-delete logs after 90 days
      {
        key: { startedAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'ttl_idx',
      },
    ]);

    const scheduledJobLocksCollection = db.collection('scheduled_job_locks');
    // A legacy non-TTL index used the same key. MongoDB will not create another
    // index with identical keys and different options, so remove it before
    // creating the expiry index that actually cleans up released locks.
    await dropIndexIfPresent(scheduledJobLocksCollection, 'locked_until_idx');
    await safeCreateIndexes(scheduledJobLocksCollection, [
      {
        key: { lockedUntil: 1 },
        expireAfterSeconds: 0,
        name: 'lock_ttl_idx',
      },
    ]);

    const executionLogsCollection = db.collection('execution_logs');
    const executionLogIndexes = await executionLogsCollection.indexes();

    // Migration: Drop TTL index — execution_logs are kept forever; base64 data is
    // redacted before storage (utils/payload-sanitizer).
    await dropIndexIfPresent(executionLogsCollection, 'ttl_idx');

    // Remove ambiguous legacy names before recreating the corrected org-scoped variants.
    await dropIndexIfPresent(executionLogsCollection, 'integration_created_idx');
    await dropIndexIfPresent(executionLogsCollection, 'integration_status_created_idx');

    // Drop corrupted org_keep_* indexes that were created with a mangled field name
    // (__KEEP___KEEP_integrationConfig__Id__) instead of integrationConfigId.
    // The correct org_integration_config_* indexes already exist with the proper key.
    await dropIndexIfPresent(executionLogsCollection, 'org_keep_integration_created_idx');
    await dropIndexIfPresent(executionLogsCollection, 'org_keep_integration_status_created_idx');
    await dropIndexIfPresent(executionLogsCollection, 'org_keep_integration_started_idx');

    const legacySearchTextIndex = executionLogIndexes.find((index) => index.name === 'search_text_idx');
    if (isStaleSearchTextIndex(legacySearchTextIndex)) {
      await dropIndexIfPresent(executionLogsCollection, 'search_text_idx');
    }

    // Unified execution logs indexes - direction-agnostic logging for all integrations
    await safeCreateIndexes(executionLogsCollection, [
      // Primary queries - tenant scoped (using createdAt for consistency with UI)
      { key: { orgId: 1, createdAt: -1 }, name: 'org_created_idx' },
      { key: { orgId: 1, status: 1, createdAt: -1 }, name: 'org_status_created_idx' },
      { key: { orgId: 1, direction: 1, createdAt: -1 }, name: 'org_direction_created_idx' },
      { key: { orgId: 1, triggerType: 1, createdAt: -1 }, name: 'org_trigger_created_idx' },
      // Analytics routes filter by startedAt over wider time windows, so keep a parallel
      // set of date indexes to avoid full scans for 30d+ dashboard queries.
      { key: { orgId: 1, startedAt: -1 }, name: 'org_started_idx' },
      { key: { orgId: 1, direction: 1, startedAt: -1 }, name: 'org_direction_started_idx' },
      { key: { orgId: 1, triggerType: 1, startedAt: -1 }, name: 'org_trigger_started_idx' },
      // Covered index for analytics overview $facet — all fields needed by $match + $group
      // are in the index, so MongoDB reads zero documents (pure index scan) even cold.
      {
        key: { orgId: 1, startedAt: -1, status: 1, durationMs: 1, eventType: 1, integrationConfigId: 1 },
        name: 'org_started_analytics_covered_idx',
      },

      // Canonical integration reference field for new writes and backfilled historical logs.
      { key: { orgId: 1, integrationRefKey: 1, createdAt: -1 }, name: 'org_integration_ref_created_idx' },
      {
        key: { orgId: 1, integrationRefKey: 1, status: 1, createdAt: -1 },
        name: 'org_integration_ref_status_created_idx',
      },
      // Integration-scoped queries
      { key: { orgId: 1, integrationConfigId: 1, createdAt: -1 }, name: 'org_integration_config_created_idx' },
      {
        key: { orgId: 1, integrationConfigId: 1, status: 1, createdAt: -1 },
        name: 'org_integration_config_status_created_idx',
      },
      { key: { orgId: 1, integrationConfigId: 1, startedAt: -1 }, name: 'org_integration_config_started_idx' },
      { key: { orgId: 1, webhookConfigId: 1, createdAt: -1 }, name: 'org_webhook_config_created_idx' },
      {
        key: { orgId: 1, webhookConfigId: 1, status: 1, createdAt: -1 },
        name: 'org_webhook_config_status_created_idx',
      },

      // Event type filtering (for OUTBOUND integrations)
      { key: { eventType: 1, createdAt: -1 }, name: 'event_created_idx' },
      { key: { orgId: 1, eventType: 1, createdAt: -1 }, name: 'org_event_created_idx' },
      { key: { orgId: 1, errorCategory: 1, createdAt: -1 }, name: 'org_error_category_created_idx' },
      { key: { orgId: 1, clientIp: 1, createdAt: -1 }, name: 'org_client_ip_created_idx', sparse: true },
      { key: { orgId: 1, status: 1, errorCategory: 1, createdAt: -1 }, name: 'org_status_error_category_created_idx' },

      // Retry query optimization - for finding retrying logs by lastAttemptAt
      { key: { status: 1, updatedAt: -1 }, name: 'retry_query_idx' }, // used by delivery.js getFailedLogsForRetry hint
      { key: { shouldRetry: 1, status: 1, lastAttemptAt: 1 }, name: 'retry_status_idx' },
      { key: { status: 1, lastAttemptAt: -1 }, name: 'status_last_attempt_idx' },
      { key: { status: 1, shouldRetry: 1, lastAttemptAt: -1 }, name: 'status_retry_last_attempt_idx' },

      // Trace lookup indexes (non-unique - multi-action integrations + retries can reuse traceId)
      { key: { traceId: 1 }, name: 'trace_id_idx' },
      { key: { messageId: 1 }, name: 'message_id_idx', sparse: true },
      { key: { correlationId: 1 }, name: 'correlation_id_idx', sparse: true },

      // Covered indexes for dashboard 24h summary aggregation.
      // $match: {orgId, createdAt: $gte} + $group reads status + responseTimeMs.
      // 3-field: covers status filter queries without responseTimeMs.
      { key: { orgId: 1, createdAt: -1, status: 1 }, name: 'org_created_status_covered_idx' },
      // 4-field: fully covers the 24h stats $group — zero document reads.
      {
        key: { orgId: 1, createdAt: -1, status: 1, responseTimeMs: 1 },
        name: 'org_created_status_rt_covered_idx',
      },

      // Performance monitoring
      { key: { status: 1, durationMs: -1 }, name: 'status_duration_idx' },
      { key: { status: 1, responseTimeMs: -1 }, name: 'status_response_time_idx' },

      // Error analysis
      { key: { status: 1, 'error.code': 1, createdAt: -1 }, name: 'status_error_created_idx' },
      { key: { status: 1, errorMessage: 1, createdAt: -1 }, name: 'status_error_msg_created_idx' },
    ]);

    // Text index for fast full-text search across execution logs.
    // This can take a very long time on large production datasets, so do not
    // block API startup on it. The index still gets ensured in the background.
    executionLogsCollection
      .createIndex(
        {
          orgId: 1,
          integrationName: 'text',
          eventType: 'text',
          searchableText: 'text', // Denormalized searchable text
          errorMessage: 'text',
          targetUrl: 'text',
          'response.body': 'text',
        },
        {
          name: 'search_text_idx',
          weights: {
            integrationName: 10, // Highest priority
            eventType: 10, // Highest priority
            searchableText: 8,
            errorMessage: 5, // Medium priority
            targetUrl: 3, // Lower priority
            'response.body': 1, // Lowest priority (can be verbose)
          },
          default_language: 'english',
        }
      )
      .then(() => {
        log('info', 'MongoDB execution_logs text index created/verified');
      })
      .catch((error) => {
        log('warn', 'MongoDB execution_logs text index creation warning', { error: error.message });
      });

    // Failed deliveries (Dead Letter Queue) indexes
    await safeCreateIndexes(db.collection('failed_deliveries'), [
      // Primary queries
      { key: { orgId: 1, failedAt: -1 }, name: 'org_failed_idx' },
      { key: { orgId: 1, status: 1, failedAt: -1 }, name: 'org_status_failed_idx' },
      { key: { integrationConfigId: 1, status: 1, failedAt: -1 }, name: 'integration_status_failed_idx' },

      // Trace correlation
      { key: { traceId: 1 }, name: 'trace_id_idx' },
      { key: { messageId: 1 }, name: 'message_id_idx', sparse: true },
      { key: { executionLogId: 1 }, name: 'execution_log_idx' },

      // Retry processing
      { key: { status: 1, nextRetryAt: 1 }, name: 'status_next_retry_idx' },
      { key: { status: 1, retryCount: 1 }, name: 'status_retry_count_idx' },

      // Error categorization
      { key: { 'error.code': 1, failedAt: -1 }, name: 'error_code_failed_idx' },
      { key: { 'error.category': 1, status: 1 }, name: 'error_category_status_idx' },

      // TTL index - auto-delete resolved/abandoned DLQ entries after 90 days
      {
        key: { resolvedAt: 1 },
        expireAfterSeconds: 7776000,
        name: 'resolved_ttl_idx',
        partialFilterExpression: { resolvedAt: { $exists: true } },
      },
    ]);

    // Rate limiting state indexes
    await safeCreateIndexes(db.collection('rate_limits'), [
      // Primary lookup by integration
      { key: { integrationConfigId: 1, windowStart: -1 }, name: 'integration_window_idx' },
      { key: { orgId: 1, integrationConfigId: 1 }, name: 'org_integration_idx' },

      // Cleanup old windows
      {
        key: { windowStart: 1 },
        expireAfterSeconds: 3600, // Clean up after 1 hour
        name: 'window_ttl_idx',
      },
    ]);

    // event_source_configs — per-org adapter configuration
    await safeCreateIndexes(db.collection('event_source_configs'), [
      { key: { orgId: 1 }, name: 'org_unique_idx', unique: true },
      { key: { type: 1, isActive: 1 }, name: 'type_active_idx' },
    ]);

    // pending_events — HTTP push queue. Finished events expire 7 days after they
    // finish. completedAt/failedAt are only ever set on done/failed events, so a
    // TTL per field needs no partial filter (a $in filter is rejected by Mongo
    // < 6.0 and took this whole batch down with it).
    await safeCreateIndexes(db.collection('pending_events'), [
      { key: { orgId: 1, status: 1, availableAt: 1, createdAt: 1 }, name: 'org_status_available_idx' },
      { key: { status: 1, createdAt: 1 }, name: 'status_created_idx' },
      { key: { completedAt: 1 }, expireAfterSeconds: 7 * 24 * 60 * 60, name: 'completed_ttl_idx' },
      { key: { failedAt: 1 }, expireAfterSeconds: 7 * 24 * 60 * 60, name: 'failed_ttl_idx' },
    ]);

    // scheduled_integrations indexes
    await safeCreateIndexes(db.collection('scheduled_integrations'), [
      { key: { status: 1, scheduledFor: 1 }, name: 'status_scheduled_for_idx' },
      { key: { orgId: 1, status: 1, scheduledFor: 1 }, name: 'org_status_scheduled_idx' },
      {
        key: { orgId: 1, integrationConfigId: 1, status: 1, scheduledFor: 1 },
        name: 'org_integration_status_scheduled_idx',
      },
      { key: { orgId: 1, originalEventId: 1, eventType: 1 }, name: 'org_original_event_event_type_idx' },
      { key: { status: 1, processingStartedAt: 1 }, name: 'status_processing_started_idx' },
      { key: { orgId: 1, eventType: 1, status: 1 }, name: 'org_event_type_status_idx' },
    ]);

    await primeAllIndexCaches();

    log('info', 'MongoDB indexes created/verified');
  } catch (error) {
    log('warn', 'MongoDB index creation warning', { error: error.message });
    // Don't fail on index creation errors, indexes might already exist
  }
}

/**
 * Record which indexes each collection actually has, so hinted queries can skip
 * a hint whose index is missing instead of failing outright. Read from the
 * server rather than from the specs above — after a collection is dropped, the
 * specs say what *should* exist, not what does.
 */
async function primeAllIndexCaches() {
  try {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    await Promise.all(
      collections.map(async ({ name }) => {
        try {
          const indexes = await db.collection(name).indexes();
          primeIndexCache(
            name,
            indexes.map((index) => index.name)
          );
        } catch (_) {
          // Collection vanished mid-scan, or is not readable — leave it unknown;
          // hints on it will simply be skipped.
        }
      })
    );
  } catch (error) {
    log('warn', 'Could not prime index cache', { error: error.message });
  }
}

function getDb() {
  if (!db) {
    throw new Error('MongoDB not connected. Call connect() first.');
  }
  return db;
}

/**
 * Get MongoDB database instance with automatic reconnection
 * Use this instead of getDb() for resilient database access
 */
async function getDbSafe() {
  const connected = await ensureConnection();
  if (!connected || !db) {
    throw new Error('MongoDB connection unavailable after reconnection attempt');
  }
  return db;
}

function isConnected() {
  return !!db;
}

async function close() {
  if (client) {
    await client.close();
    db = null;
    client = null;
    log('info', 'MongoDB connection closed');
  }
}

async function ping() {
  try {
    if (!db) return false;
    await db.admin().ping();
    return true;
  } catch (error) {
    log('error', 'MongoDB ping failed', { error: error.message });
    return false;
  }
}

// Promise memoization to prevent concurrent reconnection attempts
let reconnectPromise = null;

/**
 * Ensure MongoDB connection is alive, reconnect if needed
 * Call this before critical database operations
 * Thread-safe: concurrent calls will wait for same reconnection promise
 */
async function ensureConnection() {
  try {
    // If reconnection is in progress, wait for it
    if (reconnectPromise) {
      log('debug', 'Waiting for ongoing MongoDB reconnection...');
      return reconnectPromise;
    }

    if (!db) {
      log('warn', 'MongoDB not connected, attempting to connect...');
      reconnectPromise = connect()
        .then(() => {
          reconnectPromise = null;
          return true;
        })
        .catch((err) => {
          reconnectPromise = null;
          log('error', 'MongoDB reconnection failed', { error: err.message });
          return false;
        });
      return reconnectPromise;
    }

    // Quick ping to verify connection
    const isAlive = await ping();
    if (!isAlive) {
      log('warn', 'MongoDB connection lost, attempting to reconnect...');

      reconnectPromise = (async () => {
        // Close old connection
        if (client) {
          try {
            await client.close();
          } catch (_err) {
            // Ignore close errors
          }
          client = null;
          db = null;
        }
        // Reconnect
        await connect();
        return true;
      })().finally(() => {
        reconnectPromise = null;
      });

      return reconnectPromise;
    }

    return true;
  } catch (error) {
    log('error', 'Failed to ensure MongoDB connection', { error: error.message });
    reconnectPromise = null;
    return false;
  }
}

// Helper to convert string ID to ObjectId
function toObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  try {
    return new ObjectId(id);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  connect,
  ensureIndexes,
  safeCreateIndexes,
  isStaleSearchTextIndex,
  getDb,
  getDbSafe,
  close,
  ping,
  isConnected,
  ensureConnection,
  toObjectId,
  ObjectId,
};
