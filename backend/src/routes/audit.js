const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { log } = require('../logger');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { ValidationError } = require('../utils/errors');
const { getDbSafe } = require('../mongodb');
const { uuidv4 } = require('../utils/runtime');
const { queryAuditLogs, streamAuditLogsForExport, getAuditStats, ACTION_TYPES, RESOURCE_TYPES } = require('../services/audit-logger');
const {
  trackActivitiesBatch,
  queryActivities,
  getActivityStats,
  getUserSessions,
  ACTIVITY_EVENTS,
  ACTIVITY_CATEGORIES,
} = require('../services/user-activity-tracker');

const router = express.Router();

const MAX_BATCH_SIZE = 100;
const ACTIVITY_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const ACTIVITY_RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per user
const ACTIVITY_RATE_LIMIT_COLLECTION = 'activity_rate_limits';
let activityRateLimitIndexesEnsured = false;
const AUDIT_EXPORT_JOBS_COLLECTION = 'audit_export_jobs';
const AUDIT_EXPORT_TMP_DIR = path.join(os.tmpdir(), 'integration-control-plane-audit-exports');
const AUDIT_EXPORT_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.AUDIT_EXPORT_TTL_MS) || 6 * 60 * 60 * 1000);
const AUDIT_EXPORT_PROGRESS_INTERVAL = 100;
const AUDIT_EXPORT_STALE_PROCESSING_MS = Math.max(5 * 60 * 1000, Number(process.env.AUDIT_EXPORT_STALE_PROCESSING_MS) || 30 * 60 * 1000);
const EXPORT_FILE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let auditExportIndexesEnsured = false;

const AUDIT_EXPORT_HEADERS = [
  'Timestamp', 'Action', 'Resource Type', 'Resource ID', 'User Email', 'User Role', 'Org ID', 'IP Address', 'Success', 'Error Message',
];

const escapeCsv = (value) => {
  const text = String(value ?? '');
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const auditCsvRow = (record) => [
  record.timestamp, record.action, record.resourceType, record.resourceId, record.userEmail, record.userRole,
  record.orgId, record.ipAddress, record.success, record.errorMessage,
].map(escapeCsv).join(',');

const writeChunk = (stream, chunk) => new Promise((resolve, reject) => {
  const cleanup = () => { stream.off('error', onError); stream.off('drain', onDrain); };
  const onError = (error) => { cleanup(); reject(error); };
  const onDrain = () => { cleanup(); resolve(); };
  stream.once('error', onError);
  if (stream.write(chunk)) { cleanup(); resolve(); } else stream.once('drain', onDrain);
});

const endStream = (stream) => new Promise((resolve, reject) => {
  stream.once('error', reject);
  stream.end(resolve);
});

async function cleanupExpiredAuditExportFiles() {
  let entries;
  try {
    entries = await fsp.readdir(AUDIT_EXPORT_TMP_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') log('warn', 'Failed to inspect audit export directory', { error: error.message });
    return;
  }
  const expiresBefore = Date.now() - AUDIT_EXPORT_TTL_MS;
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('auexp_'))
    .map(async (entry) => {
      const filePath = path.join(AUDIT_EXPORT_TMP_DIR, entry.name);
      try {
        if ((await fsp.stat(filePath)).mtimeMs < expiresBefore) await fsp.unlink(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') log('warn', 'Failed to remove expired audit export file', { filePath, error: error.message });
      }
    }));
}

async function ensureAuditExportIndexes(db) {
  if (auditExportIndexesEnsured) return;
  const jobs = db.collection(AUDIT_EXPORT_JOBS_COLLECTION);
  try {
    await jobs.createIndex({ jobId: 1 }, { unique: true });
    await jobs.createIndex({ ownerUserId: 1, createdAt: -1 });
    await jobs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  } catch (error) {
    log('warn', 'Failed to ensure audit export indexes', { error: error.message });
  }
  auditExportIndexesEnsured = true;
}

const auditExportJobResponse = (job) => ({
  jobId: job.jobId,
  status: job.status,
  format: job.format,
  totalRecords: job.totalRecords || 0,
  processedRecords: job.processedRecords || 0,
  fileSizeBytes: job.fileSizeBytes || 0,
  fileName: job.fileName || null,
  errorMessage: job.errorMessage || null,
  statusPath: `/api/v1/admin/audit/export/jobs/${encodeURIComponent(job.jobId)}`,
  downloadPath: `/api/v1/admin/audit/export/jobs/${encodeURIComponent(job.jobId)}/download`,
});

async function processAuditExportJob(jobId) {
  const db = await getDbSafe();
  await ensureAuditExportIndexes(db);
  const jobs = db.collection(AUDIT_EXPORT_JOBS_COLLECTION);
  const claimed = await jobs.findOneAndUpdate(
    { jobId, status: 'QUEUED' },
    { $set: { status: 'PROCESSING', startedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  const job = claimed.value;
  if (!job) return;

  const filePath = path.join(AUDIT_EXPORT_TMP_DIR, `${job.jobId}.${job.format}`);
  let stream;
  let processedRecords = 0;
  try {
    await fsp.mkdir(AUDIT_EXPORT_TMP_DIR, { recursive: true });
    stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
    if (job.format === 'csv') await writeChunk(stream, `${AUDIT_EXPORT_HEADERS.join(',')}\n`);
    else await writeChunk(stream, '[');
    await streamAuditLogsForExport(job.filters, async (record) => {
      const row = job.format === 'csv' ? auditCsvRow(record) : JSON.stringify(record);
      await writeChunk(stream, `${processedRecords > 0 && job.format === 'json' ? ',' : ''}${row}${job.format === 'csv' ? '\n' : ''}`);
      processedRecords += 1;
      if (processedRecords % AUDIT_EXPORT_PROGRESS_INTERVAL === 0) {
        await jobs.updateOne({ jobId }, { $set: { processedRecords, updatedAt: new Date() } });
      }
    });
    if (job.format === 'json') await writeChunk(stream, ']');
    await endStream(stream);
    const stat = await fsp.stat(filePath);
    await jobs.updateOne({ jobId }, { $set: {
      status: 'COMPLETED', processedRecords, filePath, fileSizeBytes: stat.size, finishedAt: new Date(),
      updatedAt: new Date(), expiresAt: new Date(Date.now() + AUDIT_EXPORT_TTL_MS),
    } });
  } catch (error) {
    stream?.destroy();
    await fsp.rm(filePath, { force: true }).catch(() => {});
    await jobs.updateOne({ jobId }, { $set: {
      status: 'FAILED', processedRecords, errorMessage: error.message, finishedAt: new Date(),
      updatedAt: new Date(), expiresAt: new Date(Date.now() + AUDIT_EXPORT_TTL_MS),
    } });
    log('error', 'Audit export job failed', { jobId, error: error.message });
  }
}

async function startAuditExportJob(ownerUserId, filters, format) {
  const db = await getDbSafe();
  await ensureAuditExportIndexes(db);
  const now = new Date();
  const totalRecords = (await queryAuditLogs({ ...filters, page: 1, limit: 1 })).pagination.total;
  const job = {
    jobId: `auexp_${Date.now()}_${uuidv4().replace(/-/g, '').slice(0, 8)}`,
    ownerUserId, filters, format, status: 'QUEUED', totalRecords, processedRecords: 0, filePath: null,
    fileName: `audit-logs-${now.toISOString().slice(0, 10)}.${format}`, fileSizeBytes: 0, errorMessage: null,
    createdAt: now, updatedAt: now, startedAt: null, finishedAt: null,
    expiresAt: new Date(now.getTime() + AUDIT_EXPORT_TTL_MS),
  };
  await db.collection(AUDIT_EXPORT_JOBS_COLLECTION).insertOne(job);
  setImmediate(() => processAuditExportJob(job.jobId).catch((error) => log('error', 'Unhandled audit export job failure', { jobId: job.jobId, error: error.message })));
  return job;
}

async function recoverAuditExportJobs() {
  const db = await getDbSafe();
  await ensureAuditExportIndexes(db);
  const jobs = db.collection(AUDIT_EXPORT_JOBS_COLLECTION);
  const now = new Date();
  await jobs.updateMany(
    { status: 'PROCESSING', updatedAt: { $lt: new Date(now.getTime() - AUDIT_EXPORT_STALE_PROCESSING_MS) } },
    { $set: { status: 'QUEUED', updatedAt: now, errorMessage: null } }
  );
  const cursor = jobs.find(
    { status: 'QUEUED', expiresAt: { $gt: now } },
    { projection: { jobId: 1 } }
  ).limit(100);
  for await (const job of cursor) {
    setImmediate(() => processAuditExportJob(job.jobId).catch((error) => log('error', 'Recovered audit export job failed', { jobId: job.jobId, error: error.message })));
  }
}

setImmediate(() => {
  recoverAuditExportJobs().catch((error) => log('warn', 'Failed to recover pending audit export jobs', { error: error.message }));
  cleanupExpiredAuditExportFiles();
});
const auditExportCleanupTimer = setInterval(() => {
  cleanupExpiredAuditExportFiles();
}, EXPORT_FILE_CLEANUP_INTERVAL_MS);
auditExportCleanupTimer.unref?.();

async function ensureActivityRateLimitIndexes() {
  if (activityRateLimitIndexesEnsured) return;
  const db = await getDbSafe();
  await db.collection(ACTIVITY_RATE_LIMIT_COLLECTION).createIndexes([
    { key: { key: 1, windowStart: 1 }, unique: true },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);
  activityRateLimitIndexesEnsured = true;
}

function getActivityRateLimitKey(req) {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.ip || req.connection?.remoteAddress || 'unknown'}`;
}

async function activityBatchRateLimit(req, res, next) {
  try {
    await ensureActivityRateLimitIndexes();

    const db = await getDbSafe();
    const key = getActivityRateLimitKey(req);
    const nowMs = Date.now();
    const windowStartMs = Math.floor(nowMs / ACTIVITY_RATE_LIMIT_WINDOW_MS) * ACTIVITY_RATE_LIMIT_WINDOW_MS;
    const windowStart = new Date(windowStartMs);
    const windowEnd = new Date(windowStartMs + ACTIVITY_RATE_LIMIT_WINDOW_MS);

    const rateLimitEntry = await db.collection(ACTIVITY_RATE_LIMIT_COLLECTION).findOneAndUpdate(
      { key, windowStart },
      {
        $inc: { count: 1 },
        $set: {
          updatedAt: new Date(),
          windowEnd,
          expiresAt: windowEnd,
        },
        $setOnInsert: {
          key,
          windowStart,
          createdAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const count = rateLimitEntry?.value?.count || 1;
    if (count > ACTIVITY_RATE_LIMIT_MAX_REQUESTS) {
      return res.status(429).json({
        error: 'Too many activity tracking requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((windowEnd.getTime() - nowMs) / 1000),
      });
    }

    const remaining = ACTIVITY_RATE_LIMIT_MAX_REQUESTS - count;
    const resetTime = Math.ceil((windowEnd.getTime() - nowMs) / 1000);
    res.set({
      'X-RateLimit-Limit': ACTIVITY_RATE_LIMIT_MAX_REQUESTS,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset': resetTime,
    });

    next();
  } catch (error) {
    log('error', 'Activity batch rate limiter failed', {
      error: error.message,
      userId: req.user?.id || null,
    });
    // Fail-open to avoid blocking activity tracking on limiter/storage issues.
    next();
  }
}

// ============================================
// PUBLIC ACTIVITY TRACKING ENDPOINTS
// (Available to ALL authenticated users)
// ============================================

/**
 * POST /api/v1/admin/audit/activities/batch
 * Receive batched user activities from frontend
 * NOTE: This endpoint is available to ALL authenticated users (not just admins)
 */
router.post(
  '/activities/batch',
  auth,
  activityBatchRateLimit,
  asyncHandler(async (req, res) => {
    const { activities } = req.body;

    if (!activities || !Array.isArray(activities)) {
      throw new ValidationError('activities array is required');
    }

    if (activities.length > MAX_BATCH_SIZE) {
      throw new ValidationError(`Batch size cannot exceed ${MAX_BATCH_SIZE} activities`);
    }

    if (activities.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    // Enrich activities with user information from the authenticated request
    const enrichedActivities = activities.map((activity) => ({
      ...activity,
      userId: req.user?.id,
      userEmail: req.user?.email,
      userRole: req.user?.role,
      // Always use authenticated user's org to prevent cross-org activity injection.
      orgId: req.user?.orgId,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
    }));

    await trackActivitiesBatch(enrichedActivities);

    res.json({
      success: true,
      count: enrichedActivities.length,
    });
  })
);

// ============================================
// AUDIT ROUTES
// All routes below require SUPER_ADMIN, ADMIN, or ORG_ADMIN role
// ORG_ADMIN users can only see their organization's data (scoped below)
// ============================================

router.use(auth.requireRole(['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN']));

/**
 * GET /api/v1/admin/audit/logs
 * Query audit logs with filters
 */
router.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const { startDate, endDate, userId, action, resourceType, orgId, success, search, page, limit } = req.query;

    const filters = {};

    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (userId) filters.userId = userId;
    if (action) filters.action = action;
    if (resourceType) filters.resourceType = resourceType;
    if (orgId) filters.orgId = parseInt(orgId, 10);
    if (success !== undefined) filters.success = success === 'true';
    if (search) filters.search = search;
    if (page) filters.page = parseInt(page, 10);
    if (limit) filters.limit = parseInt(limit, 10);

    // Organization-scoped users can only see their org's logs
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      filters.orgId = req.user.orgId;
    }

    const result = await queryAuditLogs(filters);

    res.json(result);
  })
);

/**
 * GET /api/v1/admin/audit/stats
 * Get audit log statistics
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const filters = {};
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;

    // Organization-scoped users can only see their org's stats
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      filters.orgId = req.user.orgId;
    }

    const stats = await getAuditStats(filters);

    res.json(stats);
  })
);

/**
 * GET /api/v1/admin/audit/action-types
 * Get available action types
 */
router.get(
  '/action-types',
  asyncHandler(async (_req, res) => {
    res.json({
      actionTypes: Object.values(ACTION_TYPES),
    });
  })
);

/**
 * GET /api/v1/admin/audit/resource-types
 * Get available resource types
 */
router.get(
  '/resource-types',
  asyncHandler(async (_req, res) => {
    res.json({
      resourceTypes: Object.values(RESOURCE_TYPES),
    });
  })
);

/**
 * POST /api/v1/admin/audit/export
 * Queue a complete audit export. The worker writes cursor batches to a
 * temporary server file, so neither the API process nor the browser needs the
 * complete audit history before download begins.
 */
router.post(
  '/export',
  asyncHandler(async (req, res) => {
    const { format = 'json', ...filters } = req.body;

    if (!['json', 'csv'].includes(format)) {
      throw new ValidationError('Format must be json or csv');
    }

    // Organization-scoped users can only export their org's logs
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      filters.orgId = req.user.orgId;
    }

    const job = await startAuditExportJob(req.user?.id, filters, format);
    log('info', 'Audit export queued', {
      userId: req.user?.id,
      format,
      totalRecords: job.totalRecords,
    });
    return res.status(202).json({
      ...auditExportJobResponse(job),
      message: `Audit export queued (${job.totalRecords.toLocaleString()} rows).`,
    });
  })
);

router.get('/export/jobs/:jobId', asyncHandler(async (req, res) => {
  const db = await getDbSafe();
  await ensureAuditExportIndexes(db);
  const job = await db.collection(AUDIT_EXPORT_JOBS_COLLECTION).findOne({
    jobId: req.params.jobId,
    ownerUserId: req.user?.id,
  });
  if (!job) return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
  return res.json(auditExportJobResponse(job));
}));

router.get('/export/jobs/:jobId/download', asyncHandler(async (req, res) => {
  const db = await getDbSafe();
  await ensureAuditExportIndexes(db);
  const job = await db.collection(AUDIT_EXPORT_JOBS_COLLECTION).findOne({
    jobId: req.params.jobId,
    ownerUserId: req.user?.id,
  });
  if (!job) return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
  if (job.status !== 'COMPLETED') return res.status(409).json({ error: 'Export job is not ready', code: 'EXPORT_NOT_READY' });
  try { await fsp.access(job.filePath, fs.constants.R_OK); } catch (_error) {
    return res.status(410).json({ error: 'Export file expired', code: 'EXPORT_FILE_EXPIRED' });
  }
  res.setHeader('Content-Type', job.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${job.fileName}"`);
  return fs.createReadStream(job.filePath).pipe(res);
}));

/**
 * GET /api/v1/admin/audit/activities
 * Query user activities with filters
 */
router.get(
  '/activities',
  asyncHandler(async (req, res) => {
    const {
      startDate,
      endDate,
      userId,
      event,
      category,
      orgId,
      page,
      pageFilter, // Optional filter by page name (e.g. "/dashboard")
      feature,
      success,
      search,
      limit,
    } = req.query;

    const filters = {};

    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (userId) filters.userId = userId;
    if (event) filters.event = event;
    if (category) filters.category = category;
    if (orgId) filters.orgId = parseInt(orgId, 10);
    if (page) filters.page = parseInt(page, 10); // Used for pagination in queryActivities
    if (pageFilter) filters.pageFilter = pageFilter; // Filter by page name (e.g. "/dashboard")
    if (feature) filters.feature = feature;
    if (success !== undefined) filters.success = success === 'true';
    if (search) filters.search = search;
    if (limit) filters.limit = parseInt(limit, 10);

    // Organization-scoped admins can only see their org's activities
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      filters.orgId = req.user.orgId;
    }

    const result = await queryActivities(filters);

    res.json(result);
  })
);

/**
 * GET /api/v1/admin/audit/activities/stats
 * Get user activity statistics
 */
router.get(
  '/activities/stats',
  asyncHandler(async (req, res) => {
    const { startDate, endDate, userId, orgId } = req.query;

    const filters = {};
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (userId) filters.userId = userId;
    if (orgId) filters.orgId = parseInt(orgId, 10);

    // Organization-scoped admins can only see their org's stats
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      filters.orgId = req.user.orgId;
    }

    const stats = await getActivityStats(filters);

    res.json(stats);
  })
);

/**
 * GET /api/v1/admin/audit/activities/sessions/:userId
 * Get user session timeline (activities grouped by session)
 */
router.get(
  '/activities/sessions/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    const filters = {};
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN') {
      filters.orgId = req.user.orgId;
    }

    const sessions = await getUserSessions(userId, filters);

    res.json({
      userId,
      sessions,
      totalSessions: sessions.length,
    });
  })
);

/**
 * GET /api/v1/admin/audit/activity-events
 * Get available activity event types
 */
router.get(
  '/activity-events',
  asyncHandler(async (_req, res) => {
    res.json({
      events: Object.values(ACTIVITY_EVENTS),
    });
  })
);

/**
 * GET /api/v1/admin/audit/activity-categories
 * Get available activity categories
 */
router.get(
  '/activity-categories',
  asyncHandler(async (_req, res) => {
    res.json({
      categories: Object.values(ACTIVITY_CATEGORIES),
    });
  })
);

module.exports = router;
