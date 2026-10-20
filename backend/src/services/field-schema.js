/**
 * Event Type & Field Schema Service
 * Simple CRUD operations for event_types collection
 * Schemas are manually added/updated via API - no auto-discovery
 *
 * orgId: null  = global templates (platform-seeded, visible to all orgs, read-only for non-super-admins)
 * orgId: <id>  = org-specific event types (fully managed by that org)
 *
 * Reads always merge both; org-specific wins on eventType collision.
 */

const { log } = require('../logger');
const mongodb = require('../mongodb');

// ---------------------------------------------------------------------------
// In-memory cache — event types change rarely (manual catalogue edits only).
// TTL: 5 minutes. Keyed by `${orgId}` for list, `${orgId}:${eventType}` for single.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map(); // key → { ts, value }

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function _cacheSet(key, value) {
  // LRU eviction when over 200 entries
  if (_cache.size >= 200) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(key, { ts: Date.now(), value });
}

/** Call after any write so the next read is fresh. */
function invalidateCache(orgId) {
  for (const key of _cache.keys()) {
    if (key === String(orgId) || key.startsWith(`${orgId}:`)) {
      _cache.delete(key);
    }
  }
  // Also invalidate global (null) keys since they affect every org
  for (const key of _cache.keys()) {
    if (key === 'null' || key.startsWith('null:')) {
      _cache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the query that returns org-specific docs UNION global templates.
 * When orgId is falsy (e.g. unauthenticated) return only global templates.
 */
function buildOrgQuery(baseQuery, orgId) {
  if (!orgId) {
    return { ...baseQuery, orgId: null };
  }
  return { ...baseQuery, $or: [{ orgId }, { orgId: null }] };
}

/**
 * Deduplicate an array of event type docs so that an org-specific doc always
 * wins over a global template with the same eventType identifier.
 */
function deduplicateByEventType(docs) {
  const byType = new Map();
  for (const doc of docs) {
    const key = doc.eventType || doc.type;
    if (!key) continue;
    const existing = byType.get(key);
    if (
      !existing ||
      (doc.orgId !== null && doc.orgId !== undefined && (existing.orgId === null || existing.orgId === undefined))
    ) {
      byType.set(key, doc);
    }
  }
  return [...byType.values()];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all event types with their schemas visible to an org.
 * Returns org-specific types and global templates, org-specific wins on conflict.
 * @param {Object} options - Filter options
 * @param {boolean} options.activeOnly - Return only active event types (default: true)
 * @param {number|string|null} orgId - Requesting org's ID
 */
async function getAllEventTypes(options, orgId) {
  const activeOnly = options?.activeOnly !== false;
  const cacheKey = `${orgId}:list:${activeOnly}`;

  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');

    const baseQuery = activeOnly ? { isActive: true } : {};
    const query = buildOrgQuery(baseQuery, orgId);

    // hint: org_active_idx {orgId:1, isActive:1} covers the $or branches
    const docs = await collection.find(query).hint('org_active_idx').toArray();
    const eventTypes = deduplicateByEventType(docs);

    _cacheSet(cacheKey, eventTypes);
    return eventTypes;
  } catch (error) {
    log('error', 'Failed to get all event types', { error: error.message });
    return [];
  }
}

/**
 * Get a single event type entry with field schema, org-specific preferred.
 * Uses a single find() with $or instead of 3 sequential findOne() calls.
 * @param {string} eventType - Event type identifier
 * @param {number|string|null} orgId - Requesting org's ID
 */
async function getEventType(eventType, orgId) {
  const cacheKey = `${orgId}:${eventType}`;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const db = await mongodb.getDbSafe();
    const collection = db.collection('event_types');

    // Single round-trip: fetch both org-specific and global in one query,
    // then prefer org-specific in memory. Uses event_type_org_idx {eventType,orgId}.
    const query = orgId
      ? { eventType, $or: [{ orgId }, { orgId: null }] }
      : { eventType };

    const docs = await collection.find(query).hint('event_type_org_idx').toArray();

    if (docs.length === 0) {
      // Legacy fallback: some old docs may lack an orgId field entirely
      const legacy = await collection.findOne({ eventType });
      if (!legacy) {
        log('warn', 'Event type not found', { eventType, orgId });
        return null;
      }
      _cacheSet(cacheKey, legacy);
      return legacy;
    }

    // Prefer org-specific over global
    const orgSpecific = docs.find((d) => d.orgId !== null && d.orgId !== undefined);
    const result = orgSpecific || docs[0];

    _cacheSet(cacheKey, result);
    return result;
  } catch (error) {
    log('error', 'Failed to get event type', { eventType, error: error.message });
    return null;
  }
}

/**
 * Get field schema for an event type (backward compatibility)
 * @param {string} eventType
 * @param {number|string|null} orgId
 */
async function getFieldSchema(eventType, orgId) {
  const eventTypeEntry = await getEventType(eventType, orgId);
  return eventTypeEntry?.fields || [];
}

/**
 * Get field schemas for all known event types (backward compatibility)
 * @param {number|string|null} orgId
 */
async function getAllFieldSchemas(orgId) {
  const eventTypes = await getAllEventTypes({}, orgId);
  const schemas = {};
  for (const et of eventTypes) {
    schemas[et.eventType] = et.fields;
  }
  return schemas;
}

module.exports = {
  getFieldSchema,
  getAllFieldSchemas,
  getAllEventTypes,
  getEventType,
  invalidateCache,
};
