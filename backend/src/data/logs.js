'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const {
  useMongo,
  normalizeOrgId,
  buildOrgScopeQuery,
  addOrgScope,
  fallbackDisabledError,
  mapLogFromMongo,
  mapIntegrationFromMongo,
} = require('./helpers');
const { redactBase64 } = require('../utils/payload-sanitizer');
const { applyCursorHint } = require('../utils/index-hints');
const { AppError } = require('../utils/errors');

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const MAX_INDEXED_TIME_WINDOW_DAYS = 120;
const LOG_SEARCH_REGEX_FIELDS = [
  'integrationName',
  '__KEEP_integrationName__',
  'eventType',
  'searchableText',
  'errorMessage',
  'targetUrl',
  'response.body',
  'clientIp',
];
const LEGACY_INTEGRATION_CONFIG_ID_FIELD = '__KEEP___KEEP_integrationConfig__Id__';

// A $text search reads every log of the org that contains the word before the
// date filter applies, so a common word in a large org ran for minutes, even for
// a day with no logs. A substring search bounded by the date window is index-
// backed and instant when the window holds little data. Search by substring when
// the window is small, by text when it is large, and never let a search run
// past SEARCH_MAX_TIME_MS.
const SUBSTRING_SEARCH_MAX_WINDOW_DOCS = 50000;
const SEARCH_MAX_TIME_MS = 20000;
const WINDOW_PROBE_MAX_TIME_MS = 3000;
const WINDOW_PROBE_CACHE_TTL_MS = 30_000;
const WINDOW_PROBE_CACHE_MAX_SIZE = 200;
const MAX_TIME_EXPIRED_CODE = 50;
const _windowProbeCache = new Map();

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

function parseDayOfWeek(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number.parseInt(raw, 10);
    if (numeric >= 0 && numeric <= 6) return numeric + 1;
    if (numeric >= 1 && numeric <= 7) return numeric;
    return null;
  }
  const dayMap = {
    SUN: 1,
    SUNDAY: 1,
    MON: 2,
    MONDAY: 2,
    TUE: 3,
    TUESDAY: 3,
    WED: 4,
    WEDNESDAY: 4,
    THU: 5,
    THURSDAY: 5,
    FRI: 6,
    FRIDAY: 6,
    SAT: 7,
    SATURDAY: 7,
  };
  return dayMap[raw.toUpperCase()] || null;
}

function parseTimezoneOffsetMinutes(value) {
  if (value == null || value === '') return 0;
  const minutes = Number.parseInt(String(value), 10);
  return Number.isFinite(minutes) ? minutes : 0;
}

function parseHourFilter(value) {
  if (value == null || value === '') return null;
  const hour = Number.parseInt(String(value), 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDayMs(localMs) {
  const date = new Date(localMs);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function normalizeIntegrationRefKey(value) {
  if (value == null) return null;
  if (value instanceof mongodb.ObjectId) return value.toString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const objectId = mongodb.toObjectId(trimmed);
    return objectId ? objectId.toString() : trimmed;
  }
  if (typeof value?.toString === 'function') {
    const text = value.toString().trim();
    return text || null;
  }
  return null;
}

function getCanonicalIntegrationRefKey(input) {
  return (
    normalizeIntegrationRefKey(input?.integrationRefKey) ||
    normalizeIntegrationRefKey(input?.integrationConfigId) ||
    normalizeIntegrationRefKey(input?.[LEGACY_INTEGRATION_CONFIG_ID_FIELD]) ||
    normalizeIntegrationRefKey(input?.webhookConfigId) ||
    null
  );
}

// Keep alias for any remaining call sites
const truncateLargeStrings = redactBase64;

function buildSearchableText(input = {}) {
  const requestPayload = input.requestPayload || {};
  const payloadData = requestPayload.d?.[0] || {};
  const profileData = payloadData.profileData || {};
  const evtData = payloadData.evtData || {};

  return [
    payloadData.identity,
    profileData.Name,
    profileData.Phone,
    profileData.MRN,
    evtData['Patient Name'],
    evtData.MRN,
    evtData['MRN'],
  ]
    .filter(Boolean)
    .join(' ');
}

function buildCreatedAtRange(startDate, endDate) {
  const createdAt = {};
  if (startDate) {
    createdAt.$gte = startDate;
  }
  if (endDate) {
    createdAt.$lte = endDate;
  }
  return Object.keys(createdAt).length > 0 ? createdAt : null;
}

function getSearchTerm(filters = {}) {
  if (typeof filters.search !== 'string') return '';
  return filters.search.trim();
}

function isMissingTextIndexError(error) {
  return error?.code === 27 || /text index required/i.test(error?.message || '');
}

function buildIndexedTimeWindowClauses(filters, startDate, endDate) {
  const hour = parseHourFilter(filters.hour);
  const dayOfWeek = parseDayOfWeek(filters.dayOfWeek);

  if (hour == null && dayOfWeek == null) {
    return null;
  }

  if (!startDate || !endDate) {
    return { fallbackToExpr: true };
  }

  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS);
  if (!Number.isFinite(totalDays) || totalDays < 0 || totalDays > MAX_INDEXED_TIME_WINDOW_DAYS) {
    return { fallbackToExpr: true };
  }

  const timezoneOffsetMinutes = parseTimezoneOffsetMinutes(filters.timezoneOffset);
  const timezoneOffsetMs = timezoneOffsetMinutes * ONE_MINUTE_MS;
  const localStartMs = startDate.getTime() - timezoneOffsetMs;
  const localEndMs = endDate.getTime() - timezoneOffsetMs;

  const clauses = [];
  for (let localDayMs = startOfLocalDayMs(localStartMs); localDayMs <= localEndMs; localDayMs += ONE_DAY_MS) {
    const localDay = new Date(localDayMs);
    const localDayOfWeek = localDay.getUTCDay() + 1;
    if (dayOfWeek != null && localDayOfWeek !== dayOfWeek) {
      continue;
    }

    const localRangeStartMs = hour == null ? localDayMs : localDayMs + hour * ONE_HOUR_MS;
    const localRangeEndMs = hour == null ? localDayMs + ONE_DAY_MS : localRangeStartMs + ONE_HOUR_MS;
    const utcRangeStartMs = localRangeStartMs + timezoneOffsetMs;
    const utcRangeEndMs = localRangeEndMs + timezoneOffsetMs - 1;

    const boundedStartMs = Math.max(startDate.getTime(), utcRangeStartMs);
    const boundedEndMs = Math.min(endDate.getTime(), utcRangeEndMs);
    if (boundedStartMs > boundedEndMs) {
      continue;
    }

    clauses.push({
      createdAt: {
        $gte: new Date(boundedStartMs),
        $lte: new Date(boundedEndMs),
      },
    });
  }

  return clauses.length > 0 ? { clauses } : { clauses: [], matchesNothing: true };
}

/**
 * Build query object for delivery logs filtering
 * Extracted for reuse across listLogs, countLogs, getLogStatsSummary, and streamLogsForExport
 */
function buildLogsQuery(orgId, filters = {}, options = {}) {
  const useTextSearch = options.useTextSearch !== false;
  const query = addOrgScope({}, orgId);
  const andConditions = [];
  const normalizeScheduledTriggerValues = (triggerType) => {
    if (!triggerType) return [];
    const normalized = String(triggerType).toUpperCase();
    return normalized === 'SCHEDULED' || normalized === 'SCHEDULE' ? ['SCHEDULE', 'SCHEDULED'] : [normalized];
  };
  const startDate = parseDateOrNull(filters.startDate);
  const endDate = parseDateOrNull(filters.endDate);

  if (filters.status) {
    const statusValue = String(filters.status).toUpperCase();
    // Handle comma-separated status values (e.g., "FAILED,SKIPPED,ABANDONED")
    if (statusValue.includes(',')) {
      query.status = { $in: statusValue.split(',').map((s) => s.trim()) };
    } else if (statusValue === 'FAILED') {
      // Stats count FAILED+ABANDONED together as "failed", so the filter must match both
      query.status = { $in: ['FAILED', 'ABANDONED'] };
    } else {
      query.status = statusValue;
    }
  }
  if (filters.direction) {
    query.direction = filters.direction;
  }
  if (filters.triggerType) {
    const triggerTypes = normalizeScheduledTriggerValues(filters.triggerType);
    if (triggerTypes.length === 1) {
      query.triggerType = triggerTypes[0];
    } else if (triggerTypes.length > 1) {
      query.triggerType = { $in: triggerTypes };
    }
  }
  const integrationFilterId =
    filters.integrationConfigId || filters[LEGACY_INTEGRATION_CONFIG_ID_FIELD] || filters.webhookId;
  if (integrationFilterId) {
    const integrationRefKey = normalizeIntegrationRefKey(integrationFilterId);
    const integrationIdObj = mongodb.toObjectId(integrationFilterId);
    const legacyClauses = integrationIdObj
      ? [
          { integrationConfigId: integrationIdObj },
          { integrationConfigId: integrationFilterId },
          { [LEGACY_INTEGRATION_CONFIG_ID_FIELD]: integrationIdObj },
          { [LEGACY_INTEGRATION_CONFIG_ID_FIELD]: integrationFilterId },
          { webhookConfigId: integrationIdObj },
          { webhookConfigId: integrationFilterId },
        ]
      : [
          { integrationConfigId: integrationFilterId },
          { [LEGACY_INTEGRATION_CONFIG_ID_FIELD]: integrationFilterId },
          { webhookConfigId: integrationFilterId },
        ];
    andConditions.push({
      $or: [{ integrationRefKey }, ...legacyClauses],
    });
  }
  if (Array.isArray(filters.providerIntegrationIds)) {
    const providerIds = filters.providerIntegrationIds;
    const providerKeys = providerIds.map((id) => normalizeIntegrationRefKey(id)).filter(Boolean);
    andConditions.push({
      $or: [
        { integrationRefKey: { $in: providerKeys } },
        { integrationConfigId: { $in: providerIds } },
        { [LEGACY_INTEGRATION_CONFIG_ID_FIELD]: { $in: providerIds } },
        { webhookConfigId: { $in: providerIds } },
      ],
    });
  }
  if (filters.eventType) {
    query.eventType = filters.eventType;
  }
  if (typeof filters.clientIp === 'string' && filters.clientIp.trim()) {
    query.clientIp = filters.clientIp.trim();
  }
  if (filters.errorCategory) {
    andConditions.push({
      $or: [{ errorCategory: filters.errorCategory }, { 'error.category': filters.errorCategory }],
    });
  }

  // Portal scope: restrict to allowed integration IDs (injected by applyPortalLogFilters)
  if (Array.isArray(filters.portalAllowedIntegrationIds) && filters.portalAllowedIntegrationIds.length > 0) {
    const ids = filters.portalAllowedIntegrationIds;
    const objectIds = ids.map((id) => mongodb.toObjectId(id)).filter(Boolean);
    const allIds = objectIds.length ? [...objectIds, ...ids] : ids;
    const normalizedKeys = ids.map((id) => normalizeIntegrationRefKey(id)).filter(Boolean);
    andConditions.push({
      $or: [
        { integrationRefKey: { $in: normalizedKeys } },
        { integrationConfigId: { $in: allIds } },
        { integrationConfigId: { $in: allIds } },
        { webhookConfigId: { $in: allIds } },
      ],
    });
  }

  const searchTerm = getSearchTerm(filters);
  if (searchTerm) {
    if (useTextSearch) {
      query.$text = { $search: searchTerm };
    } else {
      andConditions.push({
        $or: LOG_SEARCH_REGEX_FIELDS.map((field) => ({
          [field]: { $regex: escapeRegex(searchTerm), $options: 'i' },
        })),
      });
    }
  }

  const indexedTimeWindows = buildIndexedTimeWindowClauses(filters, startDate, endDate);
  if (indexedTimeWindows?.matchesNothing) {
    andConditions.push({ _id: { $exists: false } });
  } else if (indexedTimeWindows?.clauses) {
    andConditions.push({ $or: indexedTimeWindows.clauses });
  } else if (indexedTimeWindows?.fallbackToExpr) {
    const hour = parseHourFilter(filters.hour);
    const dayOfWeek = parseDayOfWeek(filters.dayOfWeek);
    const timezoneMinutes = parseTimezoneOffsetMinutes(filters.timezoneOffset);
    const sign = timezoneMinutes <= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(timezoneMinutes);
    const timezone = `${sign}${String(Math.floor(absoluteMinutes / 60)).padStart(2, '0')}:${String(
      absoluteMinutes % 60
    ).padStart(2, '0')}`;
    const timestampExpression = { $ifNull: ['$startedAt', '$createdAt'] };
    const exprConditions = [];

    if (hour != null) {
      exprConditions.push({ $eq: [{ $hour: { date: timestampExpression, timezone } }, hour] });
    }
    if (dayOfWeek != null) {
      exprConditions.push({ $eq: [{ $dayOfWeek: { date: timestampExpression, timezone } }, dayOfWeek] });
    }

    if (exprConditions.length === 1) {
      andConditions.push({ $expr: exprConditions[0] });
    } else if (exprConditions.length > 1) {
      andConditions.push({ $expr: { $and: exprConditions } });
    }
  }

  // Combine $and conditions if any exist
  if (andConditions.length > 0) {
    query.$and = query.$and ? [...query.$and, ...andConditions] : andConditions;
  }

  // Add date range filtering
  if (!indexedTimeWindows?.clauses) {
    const createdAtRange = buildCreatedAtRange(startDate, endDate);
    if (createdAtRange) {
      query.createdAt = createdAtRange;
    }
  }

  return query;
}

function isMaxTimeError(error) {
  return error?.code === MAX_TIME_EXPIRED_CODE || /exceeded time limit/i.test(error?.message || '');
}

/** The cursor with the search time cap applied (a no-op when not searching). */
function capSearchTime(cursor, searchOptions) {
  return searchOptions?.maxTimeMS ? cursor.maxTimeMS(searchOptions.maxTimeMS) : cursor;
}

/** Trailing driver options for countDocuments/aggregate: none unless searching. */
const searchArgs = (searchOptions) => (searchOptions?.maxTimeMS ? [searchOptions] : []);

/**
 * True when the logs in the search's date window are few enough to scan by
 * substring. Counted by index with a cap; a window that cannot be counted
 * quickly is treated as large. No start date means the whole history.
 */
async function isSmallSearchWindow(orgId, filters) {
  const startDate = parseDateOrNull(filters.startDate);
  if (!startDate) return false;
  const endDate = parseDateOrNull(filters.endDate);
  const minute = (date) => (date ? Math.floor(date.getTime() / 60000) : '');
  const cacheKey = `${orgId}|${minute(startDate)}|${minute(endDate)}`;
  const cached = _windowProbeCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < WINDOW_PROBE_CACHE_TTL_MS) return cached.small;

  let small = false;
  try {
    const db = await mongodb.getDbSafe();
    const windowQuery = addOrgScope({ createdAt: buildCreatedAtRange(startDate, endDate) }, orgId);
    const count = await db.collection('execution_logs').countDocuments(windowQuery, {
      limit: SUBSTRING_SEARCH_MAX_WINDOW_DOCS + 1,
      hint: 'org_created_idx',
      maxTimeMS: WINDOW_PROBE_MAX_TIME_MS,
    });
    small = count <= SUBSTRING_SEARCH_MAX_WINDOW_DOCS;
  } catch (_error) {
    small = false;
  }
  if (_windowProbeCache.size >= WINDOW_PROBE_CACHE_MAX_SIZE) _windowProbeCache.clear();
  _windowProbeCache.set(cacheKey, { small, ts: Date.now() });
  return small;
}

const searchTooBroadError = () =>
  new AppError(
    'This search is taking too long. Narrow the date range or search for a more specific word.',
    400,
    'SEARCH_TOO_BROAD'
  );

async function runLogsSearchWithFallback(orgId, filters, scope, operation) {
  const preparedFilters = filters?.provider
    ? {
        ...filters,
        providerIntegrationIds: await resolveProviderIntegrationIds(
          await mongodb.getDbSafe(),
          orgId,
          filters.provider
        ),
      }
    : filters;

  // A provider with no matching integration cannot return any logs. Avoid
  // sending an empty $in/$or predicate to MongoDB, which can still scan the
  // large execution_logs collection on older deployments.
  if (Array.isArray(preparedFilters?.providerIntegrationIds) && preparedFilters.providerIntegrationIds.length === 0) {
    // Keep the impossible predicate on the leading orgId field because the
    // list query applies the org_created_idx hint.
    return operation({ orgId: { $in: [] } });
  }

  const searchTerm = getSearchTerm(filters);
  const searchOptions = searchTerm ? { maxTimeMS: SEARCH_MAX_TIME_MS } : {};
  const useTextSearch = !searchTerm || !(await isSmallSearchWindow(orgId, filters));
  const primaryQuery = buildLogsQuery(orgId, preparedFilters, { useTextSearch });

  try {
    return await operation(primaryQuery, searchOptions);
  } catch (error) {
    if (searchTerm && isMaxTimeError(error)) throw searchTooBroadError();
    if (!searchTerm || !useTextSearch || !isMissingTextIndexError(error)) {
      throw error;
    }

    log('warn', 'Execution log text index not available, falling back to regex search', {
      scope,
      search: searchTerm,
    });

    const fallbackQuery = buildLogsQuery(orgId, preparedFilters, { useTextSearch: false });
    try {
      return await operation(fallbackQuery, searchOptions);
    } catch (fallbackError) {
      throw isMaxTimeError(fallbackError) ? searchTooBroadError() : fallbackError;
    }
  }
}

/**
 * Count delivery logs matching filters (for pagination metadata)
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Same filters as listLogs
 * @returns {Promise<number>} Total count of matching logs
 */
async function countLogs(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      return await runLogsSearchWithFallback(orgId, filters, 'countLogs', (query, searchOptions) =>
        db.collection('execution_logs').countDocuments(query, ...searchArgs(searchOptions))
      );
    } catch (err) {
      logError(err, { scope: 'countLogs', filters });
      throw err;
    }
  }
  return fallbackDisabledError('countLogs:fallback');
}

function normalizeLogSummary(summaryDoc) {
  const result = summaryDoc || {};
  return {
    total: result.total || 0,
    success: result.success || 0,
    failed: result.failed || 0,
    skipped: result.skipped || 0,
    pending: result.pending || 0,
    refreshedAt: new Date().toISOString(),
  };
}

async function backfillMissingIntegrationNames(db, logs) {
  const missing = logs.filter((l) => !l.integrationName && l.integrationConfigId);
  if (missing.length === 0) return;

  const ids = [...new Set(missing.map((l) => l.integrationConfigId))];
  const objectIds = ids.map((id) => mongodb.toObjectId(id)).filter(Boolean);
  if (objectIds.length === 0) return;

  const configs = await db
    .collection('integration_configs')
    .find({ _id: { $in: objectIds } }, { projection: { name: 1 } })
    .toArray();

  const nameMap = {};
  configs.forEach((c) => {
    nameMap[c._id.toString()] = c.name;
  });

  missing.forEach((l) => {
    const name = nameMap[l.integrationConfigId];
    if (name) l.integrationName = name;
  });
}

async function getLogsPage(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      const page = Math.max(1, parseInt(filters.page) || 1);
      const limit = Math.min(1000, Math.max(1, parseInt(filters.limit) || 500));
      const skip = (page - 1) * limit;

      // NOTE: summary counts (total/success/failed/skipped) are intentionally NOT computed here.
      // The frontend fetches them via a dedicated /stats/summary endpoint (getLogStatsSummary)
      // which has its own 30s cache. Computing them again inside this $facet on every page
      // navigation would re-scan the entire filtered result set — a ~40-50% cost increase.
      // Use a separate countDocuments for total (needed for pagination only).
      const [docs, total] = await Promise.all([
        runLogsSearchWithFallback(orgId, filters, 'getLogsPage', (query, searchOptions) =>
          db
            .collection('execution_logs')
            .aggregate(
              [
                { $match: query },
                { $sort: { createdAt: -1 } },
                { $skip: skip },
                { $limit: limit },
                {
                  $project: {
                    originalPayload: 0,
                    requestPayload: 0,
                    transformedPayload: 0,
                    request: 0,
                    responseBody: 0,
                    response: 0,
                    requestHeaders: 0,
                  },
                },
              ],
              // Sort {createdAt:-1} matches org_created_idx exactly — index-backed, no disk spill.
              { allowDiskUse: true, hint: 'org_created_idx', ...searchOptions }
            )
            .toArray()
        ),
        runLogsSearchWithFallback(orgId, filters, 'getLogsPage:count', (query, searchOptions) =>
          db.collection('execution_logs').countDocuments(query, ...searchArgs(searchOptions))
        ),
      ]);

      const logs = Array.isArray(docs) ? docs.map(mapLogFromMongo) : [];
      await backfillMissingIntegrationNames(db, logs);
      const totalCount = typeof total === 'number' ? total : 0;
      const totalPages = Math.ceil(totalCount / limit);

      return {
        data: logs,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        // summary intentionally omitted — consumed from /stats/summary cache by the frontend
        summary: null,
      };
    } catch (err) {
      logError(err, { scope: 'getLogsPage', filters });
      throw err;
    }
  }
  return fallbackDisabledError('getLogsPage:fallback');
}

function mapGroupedLogFromMongo(doc) {
  return {
    id: doc.docId || String(doc._id),
    messageId: String(doc._id),
    integrationConfigId: doc.rawIntegrationConfigId?.toString?.() || null,
    integrationName: doc.integrationName || null,
    eventType: doc.eventType || null,
    direction: doc.direction || 'OUTBOUND',
    triggerType: doc.triggerType || 'EVENT',
    status: doc.status || null,
    errorCategory: doc.errorCategory || null,
    responseStatus: doc.responseStatus || null,
    responseTimeMs: doc.responseTimeMs || null,
    errorMessage: doc.errorMessage || null,
    targetUrl: doc.targetUrl || null,
    httpMethod: doc.httpMethod || null,
    attemptCount: doc.totalAttempts || 1,
    totalAttempts: doc.totalAttempts || 1,
    createdAt: doc.createdAt?.toISOString?.() || null,
    updatedAt: doc.updatedAt?.toISOString?.() || null,
    traceId: doc.traceId || null,
    correlationId: doc.correlationId || null,
    metadata: {},
  };
}

async function getLogsPageGroupedByMessage(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      const page = Math.max(1, parseInt(filters.page) || 1);
      const limit = Math.min(1000, Math.max(1, parseInt(filters.limit) || 50));
      const skip = (page - 1) * limit;

      const result = await runLogsSearchWithFallback(orgId, filters, 'getLogsPageGroupedByMessage', (query, searchOptions) =>
        db
          .collection('execution_logs')
          .aggregate(
            [
              { $match: query },
              // Sort DESC to match org_created_idx {orgId:1, createdAt:-1} direction.
              // MongoDB can serve this sort from the index (no in-memory sort needed).
              // $first on a DESC-sorted set gives the most-recent attempt per message —
              // semantically identical to $last on ASC, but without the full in-memory sort.
              { $sort: { createdAt: -1, _id: -1 } },
              {
                $group: {
                  _id: { $ifNull: ['$messageId', { $toString: '$_id' }] },
                  docId: { $first: { $toString: '$_id' } },
                  rawIntegrationConfigId: { $first: '$integrationConfigId' },
                  integrationName: { $first: '$integrationName' },
                  eventType: { $first: '$eventType' },
                  direction: { $first: '$direction' },
                  triggerType: { $first: '$triggerType' },
                  orgId: { $first: '$orgId' },
                  createdAt: { $min: '$createdAt' },
                  updatedAt: { $max: '$updatedAt' },
                  status: { $first: '$status' },
                  errorMessage: { $first: '$errorMessage' },
                  errorCategory: { $first: '$errorCategory' },
                  responseStatus: { $first: '$responseStatus' },
                  responseTimeMs: { $first: '$responseTimeMs' },
                  targetUrl: { $first: '$targetUrl' },
                  httpMethod: { $first: '$httpMethod' },
                  traceId: { $first: '$traceId' },
                  correlationId: { $first: '$correlationId' },
                  totalAttempts: { $sum: 1 },
                },
              },
              {
                $facet: {
                  data: [{ $sort: { updatedAt: -1 } }, { $skip: skip }, { $limit: limit }],
                  totalCount: [{ $count: 'total' }],
                },
              },
            ],
            { allowDiskUse: true, hint: 'org_created_idx', ...searchOptions }
          )
          .toArray()
      );

      const pageResult = result[0] || { data: [], totalCount: [] };
      const logs = Array.isArray(pageResult.data) ? pageResult.data.map(mapGroupedLogFromMongo) : [];
      const filteredTotalCount = pageResult.totalCount?.[0]?.total || 0;
      const totalPages = Math.ceil(filteredTotalCount / limit);

      return {
        data: logs,
        pagination: {
          page,
          limit,
          total: filteredTotalCount,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      };
    } catch (err) {
      logError(err, { scope: 'getLogsPageGroupedByMessage', filters });
      throw err;
    }
  }
  return fallbackDisabledError('getLogsPageGroupedByMessage:fallback');
}

async function probeLogsThreshold(orgId, filters = {}, threshold = 0) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const normalizedThreshold = Math.max(0, Number.parseInt(String(threshold), 10) || 0);
      const probeLimit = normalizedThreshold + 1;

      const docs = await runLogsSearchWithFallback(orgId, filters, 'probeLogsThreshold', (query, searchOptions) =>
        capSearchTime(
          db
            .collection('execution_logs')
            .find(query, {
              projection: { _id: 1 },
            })
            .limit(probeLimit),
          searchOptions
        ).toArray()
      );

      const matchedCount = Array.isArray(docs) ? docs.length : 0;
      return {
        exceedsThreshold: matchedCount > normalizedThreshold,
        exactCount: matchedCount > normalizedThreshold ? null : matchedCount,
      };
    } catch (err) {
      logError(err, { scope: 'probeLogsThreshold', filters, threshold });
      throw err;
    }
  }
  return fallbackDisabledError('probeLogsThreshold:fallback');
}

/**
 * List delivery logs with server-side pagination support
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Filtering and pagination options
 *   - status: Filter by delivery status
 *   - integrationConfigId: Filter by integration configuration
 *   - eventType: Filter by event type
 *   - search: Full-text search
 *   - startDate/endDate: Date range filtering
 *   - page: Page number (1-indexed, default: 1)
 *   - limit: Results per page (default: 500, max: 1000)
 * @returns {Promise<Array>} Array of delivery log objects
 */
async function listLogs(orgId, filters = {}) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Pagination with validation
      const page = Math.max(1, parseInt(filters.page) || 1);
      const limit = Math.min(1000, Math.max(1, parseInt(filters.limit) || 500));
      const skip = (page - 1) * limit;

      const logs = await runLogsSearchWithFallback(orgId, filters, 'listLogs', (query, searchOptions) =>
        capSearchTime(
          applyCursorHint(db.collection('execution_logs').find(query), 'org_created_idx')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),
          searchOptions
        ).toArray()
      );

      return logs.map(mapLogFromMongo);
    } catch (err) {
      logError(err, { scope: 'listLogs', filters });
      throw err; // Re-throw the actual error for better debugging
    }
  }
  return fallbackDisabledError('listLogs:fallback');
}

/**
 * Get delivery log statistics summary using unbounded MongoDB aggregation
 * This does NOT use listLogs() to avoid the row limit cap
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Filtering options (integrationConfigId, eventType, dateRange)
 * @returns {Promise<object>} Statistics summary with total, success, failed, skipped, pending counts
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

async function getLogStatsSummary(orgId, filters = {}) {
  const { status, ...filtersWithoutStatus } = filters;
  const cacheKey = _buildStatsCacheKey(orgId, filtersWithoutStatus);

  const cached = _statsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
    return cached.value;
  }

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const groupByMessage = filtersWithoutStatus.groupBy === 'message';

      const stats = await runLogsSearchWithFallback(orgId, filtersWithoutStatus, 'getLogStatsSummary', (matchStage, searchOptions) => {
        const pipeline = [{ $match: matchStage }];

        if (groupByMessage) {
          // Sort DESC to match org_created_idx direction — eliminates in-memory sort.
          // $first on DESC gives the most-recent attempt per message (same as $last on ASC).
          pipeline.push({ $sort: { createdAt: -1, _id: -1 } });
          pipeline.push({
            $group: {
              _id: { $ifNull: ['$messageId', { $toString: '$_id' }] },
              status: { $first: '$status' },
            },
          });
        }

        pipeline.push({
          $group: {
            _id: null,
            total: { $sum: 1 },
            success: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] } },
            // Count FAILED and ABANDONED both as "failed" — keep consistent with
            // the status filter chips which treat them as one bucket.
            failed: { $sum: { $cond: [{ $in: ['$status', ['FAILED', 'ABANDONED']] }, 1, 0] } },
            skipped: { $sum: { $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0] } },
            pending: {
              $sum: {
                $cond: [{ $or: [{ $eq: ['$status', 'PENDING'] }, { $eq: ['$status', 'RETRYING'] }] }, 1, 0],
              },
            },
          },
        });

        // hint: for groupByMessage use org_created_idx (orgId+createdAt DESC matches our sort).
        // For plain stats, org_created_status_rt_covered_idx covers {orgId,createdAt,status}
        // so MongoDB reads zero documents for the $group — pure index scan.
        const hint = groupByMessage ? 'org_created_idx' : 'org_created_status_rt_covered_idx';
        return db
          .collection('execution_logs')
          .aggregate(pipeline, { allowDiskUse: true, hint, ...searchOptions })
          .toArray();
      });

      const result = stats[0] || { total: 0, success: 0, failed: 0, skipped: 0, pending: 0 };
      const summary = normalizeLogSummary(result);
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
      logError(err, { scope: 'getLogStatsSummary', filters });
      throw err;
    }
  }
  return fallbackDisabledError('getLogStatsSummary:fallback');
}

/**
 * Stream delivery logs for export using cursor-based iteration
 * Handles millions of rows efficiently without loading all into memory
 * @param {number} orgId - Parent entity ID
 * @param {object} filters - Same filters as listLogs (excluding page/limit)
 * @param {function} onLog - Callback function called for each log entry
 * @returns {Promise<number>} Total count of exported logs
 */
async function streamLogsForExport(orgId, filters = {}, onLog, options = {}) {
  if (useMongo()) {
    let cursor;
    try {
      const db = await mongodb.getDbSafe();
      return await runLogsSearchWithFallback(orgId, filters, 'streamLogsForExport', async (query) => {
        let count = 0;
        cursor = db
          .collection('execution_logs')
          .find(query, {
            noCursorTimeout: true,
            // Large filtered exports may still need an in-memory server sort even when
            // no matching compound index exists. Let Mongo spill that sort to disk
            // instead of failing the export job at the 100 MB memory cap.
            allowDiskUse: true,
          })
          .sort({ createdAt: -1 })
          .batchSize(100); // Process 100 documents at a time for memory efficiency

        for await (const doc of cursor) {
          if (options.shouldStop && options.shouldStop()) {
            break;
          }
          const logEntry = mapLogFromMongo(doc);
          if (options.includeFullResponseBody) {
            const fullBody = doc?.response?.body;
            if (fullBody !== undefined) {
              logEntry.responseBody = fullBody;
            }
          }
          if (options.includeResponseObject) {
            logEntry.response = doc?.response || null;
          }
          await onLog(logEntry);
          count++;
        }

        return count;
      });
    } catch (err) {
      logError(err, { scope: 'streamLogsForExport', filters });
      throw err;
    } finally {
      // Ensure cursor is closed even if export is aborted
      if (cursor) {
        try {
          await cursor.close();
        } catch (closeErr) {
          // Cursor might already be closed, ignore error
        }
      }
    }
  }
  return fallbackDisabledError('streamLogsForExport:fallback');
}

async function getLogById(orgId, id) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return undefined;

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const logDoc = await db.collection('execution_logs').findOne({
        _id: mongodb.toObjectId(id),
        ...buildOrgScopeQuery(normalizedOrgId),
      });

      if (!logDoc) return undefined;

      const mappedLog = mapLogFromMongo(logDoc);
      mappedLog.request = logDoc.request || {
        url: mappedLog.targetUrl,
        method: mappedLog.httpMethod,
        headers: mappedLog.requestHeaders || {},
        body: mappedLog.requestPayload || {},
        query: mappedLog.requestQuery || {},
      };
      mappedLog.response = logDoc.response || {
        statusCode: mappedLog.responseStatus,
        headers: {},
        body: mappedLog.responseBody || null,
      };

      // Fetch integration config and retry attempts in parallel — they are independent
      const integrationConfigId = mappedLog.integrationConfigId;
      const [integration, attempts] = await Promise.all([
        integrationConfigId
          ? db
              .collection('integration_configs')
              .findOne({ _id: mongodb.toObjectId(integrationConfigId) })
              .catch((err) => {
                log('warn', 'Failed to fetch integration config for log detail', { logId: id, error: err.message });
                return null;
              })
          : Promise.resolve(null),
        db
          .collection('delivery_attempts')
          .find({ deliveryLogId: id, ...buildOrgScopeQuery(normalizedOrgId) })
          .sort({ attemptNumber: 1 })
          .toArray()
          .catch((err) => {
            log('warn', 'Failed to fetch retry attempts for log detail', { logId: id, error: err.message });
            return [];
          }),
      ]);

      if (integration) {
        mappedLog.__KEEP_integrationConfig__ = mapIntegrationFromMongo(integration);
      }

      mappedLog.retryAttempts = attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        responseStatus: attempt.responseStatus,
        responseBody: attempt.responseBody,
        responseTimeMs: attempt.responseTimeMs,
        errorMessage: attempt.errorMessage,
        requestPayload: attempt.requestPayload,
        requestHeaders: attempt.requestHeaders,
        targetUrl: attempt.targetUrl,
        httpMethod: attempt.httpMethod,
        attemptedAt: attempt.attemptedAt?.toISOString(),
        retryReason: attempt.retryReason,
      }));

      return mappedLog;
    } catch (err) {
      logError(err, { scope: 'getLogById', id });
    }
  }
  return fallbackDisabledError('getLogById:fallback');
}

async function recordLog(orgId, logPayload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) {
    throw new Error('orgId is required');
  }

  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();
      const errorCategory = logPayload.errorCategory || logPayload.error?.category || null;
      const integrationConfigId =
        logPayload.integrationConfigId || logPayload[LEGACY_INTEGRATION_CONFIG_ID_FIELD] || logPayload.webhookConfigId;
      const integrationConfigIdObj = mongodb.toObjectId(integrationConfigId);

      // Normalize status to uppercase for consistency
      const normalizeStatus = (status) => {
        if (!status) return 'PENDING';
        const statusMap = {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
          PENDING: 'PENDING',
          RETRYING: 'RETRYING',
          ABANDONED: 'ABANDONED',
          SKIPPED: 'SKIPPED',
        };
        return statusMap[status.toUpperCase()] || status.toUpperCase();
      };

      const searchableText = buildSearchableText(logPayload);
      const integrationRefKey =
        getCanonicalIntegrationRefKey({
          integrationConfigId: integrationConfigIdObj || integrationConfigId,
        }) || null;

      // If a previous log reference exists, update it instead of inserting a new document.
      // Preference order:
      // 1) explicit id (ObjectId or traceId)
      // 2) explicit traceId
      // 3) correlationId mapped to traceId/correlationId
      let existingLogId = null;
      let queryField = '_id';
      if (logPayload.id) {
        // If id is a valid ObjectId, update by _id; otherwise treat it as traceId.
        // This supports req_* correlation IDs in addition to trc_* IDs.
        const asObjectId = mongodb.toObjectId(logPayload.id);
        if (asObjectId) {
          existingLogId = asObjectId;
          queryField = '_id';
        } else if (typeof logPayload.id === 'string') {
          existingLogId = logPayload.id;
          queryField = 'traceId';
        }
      } else if (typeof logPayload.traceId === 'string' && logPayload.traceId.trim()) {
        existingLogId = logPayload.traceId.trim();
        queryField = 'traceId';
      } else if (typeof logPayload.correlationId === 'string' && logPayload.correlationId.trim()) {
        existingLogId = logPayload.correlationId.trim();
        queryField = 'correlationOrTraceId';
      }
      if (existingLogId) {
        const attemptCount = logPayload.attemptCount || 1;

        // Fetch integration config to populate missing fields
        let integrationName =
          logPayload.integrationName || logPayload.__KEEP_integrationName__ || logPayload.webhookName;
        let eventType = logPayload.eventType;

        if ((!integrationName || !eventType) && integrationConfigIdObj) {
          try {
            const integrationConfig = await db.collection('integration_configs').findOne({
              _id: integrationConfigIdObj,
            });
            if (integrationConfig) {
              integrationName = integrationName || integrationConfig.name;
              eventType = eventType || integrationConfig.eventType;
            }
          } catch (err) {
            // If integration config fetch fails, continue with null values
            log('warn', 'Failed to fetch integration config for log update', {
              integrationConfigId: integrationConfigIdObj?.toString(),
              error: err.message,
            });
          }
        }

        const updateDoc = {
          eventId: logPayload.eventId || null,
          status: normalizeStatus(logPayload.status),
          'response.statusCode': logPayload.responseStatus,
          'response.body': logPayload.responseBody || null,
          responseStatus: logPayload.responseStatus,
          responseBody: logPayload.responseBody || null,
          responseTimeMs: logPayload.responseTimeMs || null,
          attemptCount,
          deliveredAt: logPayload.deliveredAt || null,
          finishedAt: logPayload.deliveredAt || null,
          errorMessage: logPayload.errorMessage || null,
          errorCategory,
          error:
            logPayload.error ||
            (logPayload.errorMessage || errorCategory
              ? { message: logPayload.errorMessage || null, category: errorCategory }
              : null),
          originalPayload: logPayload.originalPayload || {},
          requestPayload: logPayload.requestPayload || {},
          'request.body': logPayload.requestPayload || {},
          webhookName: integrationName || null,
          integrationName: integrationName || null,
          __KEEP_integrationName__: integrationName || null,
          webhookConfigId: integrationConfigIdObj || integrationConfigId || null,
          transformedPayload: truncateLargeStrings(logPayload.requestPayload || {}),
          orgUnitRid: logPayload.orgUnitRid || logPayload.entityRid || normalizedOrgId,
          targetUrl: logPayload.targetUrl,
          httpMethod: logPayload.httpMethod,
          'request.url': logPayload.requestUrl || logPayload.targetUrl,
          'request.method': logPayload.requestMethod || logPayload.httpMethod,
          'request.query': logPayload.requestQuery || {},
          correlationId: logPayload.correlationId || null,
          traceId: logPayload.traceId || logPayload.correlationId || null,
          'request.headers': logPayload.requestHeaders || {},
          requestHeaders: logPayload.requestHeaders || null,
          integrationRefKey,
          shouldRetry: logPayload.shouldRetry || false,
          integrationConfigId: integrationConfigIdObj || integrationConfigId || null,
          [LEGACY_INTEGRATION_CONFIG_ID_FIELD]: integrationConfigIdObj || integrationConfigId || null,
          searchableText,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        };

        // What the caller sent and the execution spans are written once, by the first call that has
        // them. A later write without them (a retry, or the execution logger's closing update)
        // must keep them, not blank them.
        if (logPayload.inboundRequestHeaders) {
          updateDoc.inboundRequestHeaders = logPayload.inboundRequestHeaders;
        }
        if (logPayload.clientIp) {
          updateDoc.clientIp = logPayload.clientIp;
        }
        if (logPayload.executionTrace) {
          updateDoc.executionTrace = logPayload.executionTrace;
        }
        if (logPayload.direction) {
          updateDoc.direction = logPayload.direction;
        }
        if (logPayload.triggerType) {
          updateDoc.triggerType = logPayload.triggerType;
        }
        // Set eventType from logPayload or fetched integration config
        if (eventType) {
          updateDoc.eventType = eventType;
          updateDoc.integrationType = eventType;
        }
        if (logPayload.actionName !== undefined) {
          updateDoc.actionName = logPayload.actionName;
        }
        if (logPayload.actionIndex !== undefined) {
          updateDoc.actionIndex = logPayload.actionIndex;
        }

        const actionScopedQuery = {};
        if (Number.isFinite(logPayload.actionIndex)) {
          actionScopedQuery.actionIndex = logPayload.actionIndex;
        }
        if (typeof logPayload.actionName === 'string' && logPayload.actionName.trim()) {
          actionScopedQuery.actionName = logPayload.actionName.trim();
        }

        const integrationScopeClause = integrationConfigId
          ? {
              $or: [
                { integrationConfigId: integrationConfigIdObj || integrationConfigId },
                { [LEGACY_INTEGRATION_CONFIG_ID_FIELD]: integrationConfigIdObj || integrationConfigId },
              ],
            }
          : null;
        const scopedAnd = (baseQuery) =>
          integrationScopeClause ? { ...baseQuery, $and: [integrationScopeClause] } : baseQuery;

        const existingLogLookupQuery =
          queryField === 'traceId'
            ? scopedAnd({
                traceId: existingLogId,
                orgId: normalizedOrgId,
                ...actionScopedQuery,
              })
            : queryField === 'correlationOrTraceId'
              ? scopedAnd({
                  orgId: normalizedOrgId,
                  ...actionScopedQuery,
                  $or: [{ traceId: existingLogId }, { correlationId: existingLogId }],
                })
              : { _id: existingLogId, orgId: normalizedOrgId };

        let resolvedExistingLogId = existingLogId;
        if (queryField !== '_id') {
          const existingLogDoc = await db
            .collection('execution_logs')
            .find(existingLogLookupQuery)
            .sort({ createdAt: -1, _id: -1 })
            .limit(1)
            .toArray()
            .then((docs) => docs[0] || null);

          resolvedExistingLogId = existingLogDoc?._id || null;
        }

        const updateResult = resolvedExistingLogId
          ? await db
              .collection('execution_logs')
              .updateOne({ _id: resolvedExistingLogId, orgId: normalizedOrgId }, { $set: updateDoc })
          : { matchedCount: 0 };

        // If the document was not found (edge case), fall back to insert
        if (updateResult.matchedCount === 0) {
          log('debug', 'Existing log not found for update, inserting new log', {
            logId: logPayload.id,
            orgId: normalizedOrgId,
          });
        } else {
          // Record attempt details for retries
          if (logPayload.attemptDetails) {
            const attemptDoc = {
              deliveryLogId: resolvedExistingLogId.toString(),
              orgId: normalizedOrgId,
              integrationConfigId: logPayload.integrationConfigId,
              attemptNumber: logPayload.attemptDetails.attemptNumber || attemptCount,
              status: normalizeStatus(logPayload.status),
              responseStatus: logPayload.responseStatus,
              responseBody: logPayload.responseBody || null,
              responseTimeMs: logPayload.responseTimeMs || null,
              errorMessage: logPayload.errorMessage || null,
              requestPayload: logPayload.requestPayload || {},
              requestHeaders: logPayload.attemptDetails.requestHeaders || {},
              targetUrl: logPayload.attemptDetails.targetUrl,
              httpMethod: logPayload.attemptDetails.httpMethod || 'POST',
              attemptedAt: logPayload.createdAt || new Date(),
              retryReason: logPayload.attemptDetails.retryReason || null,
            };

            await db.collection('delivery_attempts').insertOne(attemptDoc);
          }

          return existingLogId.toString();
        }
      }

      // Fetch integration config to populate missing fields
      let integrationName = logPayload.integrationName || logPayload.__KEEP_integrationName__ || logPayload.webhookName;
      let eventType = logPayload.eventType;

      if ((!integrationName || !eventType) && integrationConfigIdObj) {
        try {
          const integrationConfig = await db.collection('integration_configs').findOne({
            _id: integrationConfigIdObj,
          });
          if (integrationConfig) {
            integrationName = integrationName || integrationConfig.name;
            eventType = eventType || integrationConfig.eventType;
          }
        } catch (err) {
          // If integration config fetch fails, continue with null values
          log('warn', 'Failed to fetch integration config for log', {
            integrationConfigId: integrationConfigIdObj?.toString(),
            error: err.message,
          });
        }
      }

      // Insert new execution log
      const logDoc = {
        traceId:
          logPayload.traceId ||
          logPayload.correlationId ||
          `trc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        messageId: logPayload.messageId || null,
        orgId: normalizedOrgId,
        orgUnitRid: logPayload.orgUnitRid || logPayload.entityRid || normalizedOrgId,
        webhookName: integrationName || null,
        webhookConfigId: integrationConfigIdObj || integrationConfigId || null,
        transformedPayload: truncateLargeStrings(logPayload.requestPayload || {}),
        direction: logPayload.direction || 'OUTBOUND',
        triggerType: logPayload.triggerType || 'EVENT',
        integrationConfigId: integrationConfigIdObj || integrationConfigId || null,
        [LEGACY_INTEGRATION_CONFIG_ID_FIELD]: integrationConfigIdObj || integrationConfigId || null,
        integrationRefKey:
          getCanonicalIntegrationRefKey({
            integrationConfigId: integrationConfigIdObj || integrationConfigId,
          }) || null,
        integrationName: integrationName,
        __KEEP_integrationName__: integrationName,
        eventId: logPayload.eventId || null,
        eventType: eventType,
        actionName: logPayload.actionName || null,
        actionIndex: Number.isFinite(logPayload.actionIndex) ? logPayload.actionIndex : null,
        status: normalizeStatus(logPayload.status),
        responseStatus: logPayload.responseStatus,
        responseBody: logPayload.responseBody || null,
        responseTimeMs: logPayload.responseTimeMs || null,
        attemptCount: logPayload.attemptCount || 1,
        shouldRetry: logPayload.shouldRetry || false,
        lastAttemptAt: new Date(),
        startedAt: logPayload.createdAt || new Date(),
        finishedAt: logPayload.deliveredAt || null,
        deliveredAt: logPayload.deliveredAt || null,
        durationMs: logPayload.responseTimeMs || null,
        errorMessage: logPayload.errorMessage || null,
        errorCategory,
        error:
          logPayload.error ||
          (logPayload.errorMessage || errorCategory
            ? { message: logPayload.errorMessage || null, category: errorCategory }
            : null),
        originalPayload: truncateLargeStrings(logPayload.originalPayload || {}),
        requestPayload: truncateLargeStrings(logPayload.requestPayload || {}),
        targetUrl: logPayload.targetUrl,
        httpMethod: logPayload.httpMethod,
        correlationId: logPayload.correlationId || null,
        requestHeaders: logPayload.requestHeaders || null,
        // Same rule as the update branch: only stored when this call carries them.
        ...(logPayload.inboundRequestHeaders ? { inboundRequestHeaders: logPayload.inboundRequestHeaders } : {}),
        ...(logPayload.clientIp ? { clientIp: logPayload.clientIp } : {}),
        ...(logPayload.executionTrace ? { executionTrace: logPayload.executionTrace } : {}),
        searchableText,
        request: {
          url: logPayload.requestUrl || logPayload.targetUrl,
          method: logPayload.requestMethod || logPayload.httpMethod,
          query: logPayload.requestQuery || {},
          headers: logPayload.requestHeaders || {},
          body: truncateLargeStrings(logPayload.requestPayload || {}),
        },
        response: {
          statusCode: logPayload.responseStatus,
          headers: {},
          body: truncateLargeStrings(logPayload.responseBody || {}),
        },
        steps: [],
        metadata: {},
        createdAt: logPayload.createdAt || new Date(),
        updatedAt: new Date(),
      };

      const result = await db.collection('execution_logs').insertOne(logDoc);

      // Record detailed attempt information for enhanced UI
      if (logPayload.attemptDetails) {
        const attemptDoc = {
          deliveryLogId: result.insertedId.toString(),
          orgId: normalizedOrgId,
          integrationConfigId: logPayload.integrationConfigId,
          attemptNumber: logPayload.attemptDetails.attemptNumber || 1,
          status: logPayload.status,
          responseStatus: logPayload.responseStatus,
          responseBody: logPayload.responseBody || null,
          responseTimeMs: logPayload.responseTimeMs || null,
          errorMessage: logPayload.errorMessage || null,
          requestPayload: logPayload.requestPayload || {},
          requestHeaders: logPayload.attemptDetails.requestHeaders || {},
          targetUrl: logPayload.attemptDetails.targetUrl,
          httpMethod: logPayload.attemptDetails.httpMethod || 'POST',
          attemptedAt: logPayload.createdAt || new Date(),
          retryReason: logPayload.attemptDetails.retryReason || null,
        };

        await db.collection('delivery_attempts').insertOne(attemptDoc);
      }

      return result.insertedId.toString();
    } catch (err) {
      logError(err, { scope: 'recordLog' });
    }
  }
  return fallbackDisabledError('recordLog:fallback');
}

// Bulk retry logs - Mark multiple failed logs for retry
async function bulkRetryLogs(orgId, ids) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Convert string IDs to ObjectIds and track failed conversions
      const objectIds = [];
      const failedIds = [];

      for (const id of ids) {
        try {
          objectIds.push(mongodb.toObjectId(id));
        } catch (err) {
          failedIds.push(id);
          log('warn', 'Invalid log ID in bulk retry', { id, error: err.message });
        }
      }

      if (objectIds.length === 0) {
        return { retriedCount: 0, failedIds };
      }

      // Only retry logs that are FAILED
      const result = await db.collection('execution_logs').updateMany(
        {
          _id: { $in: objectIds },
          orgId,
          status: 'FAILED',
        },
        {
          $set: {
            status: 'RETRYING',
            shouldRetry: true,
            lastAttemptAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      log('info', 'Bulk retry completed', {
        scope: 'bulkRetryLogs',
        requested: ids.length,
        retried: result.modifiedCount,
        failed: failedIds.length,
      });

      return {
        retriedCount: result.modifiedCount,
        failedIds,
      };
    } catch (err) {
      logError(err, { scope: 'bulkRetryLogs' });
      return { retriedCount: 0, failedIds: ids };
    }
  }

  return fallbackDisabledError('bulkRetryLogs:fallback');
}

// Bulk delete logs
async function bulkDeleteLogs(orgId, ids) {
  if (useMongo()) {
    try {
      const db = await mongodb.getDbSafe();

      // Convert string IDs to ObjectIds and track failed conversions
      const objectIds = [];
      const failedIds = [];

      for (const id of ids) {
        try {
          objectIds.push(mongodb.toObjectId(id));
        } catch (err) {
          failedIds.push(id);
          log('warn', 'Invalid log ID in bulk delete', { id, error: err.message });
        }
      }

      if (objectIds.length === 0) {
        return { deletedCount: 0, failedIds };
      }

      // Delete delivery logs
      const result = await db.collection('execution_logs').deleteMany({
        _id: { $in: objectIds },
        orgId,
      });

      // Also delete associated delivery attempts
      await db.collection('delivery_attempts').deleteMany({
        deliveryLogId: { $in: ids },
        ...buildOrgScopeQuery(orgId),
      });

      log('info', 'Bulk delete completed', {
        scope: 'bulkDeleteLogs',
        requested: ids.length,
        deleted: result.deletedCount,
        failed: failedIds.length,
      });

      return {
        deletedCount: result.deletedCount,
        failedIds,
      };
    } catch (err) {
      logError(err, { scope: 'bulkDeleteLogs' });
      return { deletedCount: 0, failedIds: ids };
    }
  }

  return fallbackDisabledError('bulkDeleteLogs:fallback');
}

module.exports = {
  buildLogsQuery,
  countLogs,
  getLogsPage,
  getLogsPageGroupedByMessage,
  probeLogsThreshold,
  listLogs,
  getLogStatsSummary,
  streamLogsForExport,
  getLogById,
  recordLog,
  bulkRetryLogs,
  bulkDeleteLogs,
};
