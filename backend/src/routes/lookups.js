const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const mongodb = require('../mongodb');
const { uuidv4 } = require('../utils/runtime');
const router = express.Router();
const {
  listLookups,
  streamLookupsForExport,
  getLookup,
  addLookup,
  updateLookup,
  deleteLookup,
  bulkCreateLookups,
  bulkDeleteLookups,
  resolveLookup,
  resolveLookupObject,
  reverseLookup,
  getLookupStats,
  getLookupTypes,
} = require('../data');
const { validateLookupEntry, validateBulkImport } = require('../services/lookup-validator');
const { testLookups } = require('../services/lookup-service');
const {
  parseImportFile,
  generateImportTemplate,
  createStreamingLookupXlsxWriter,
} = require('../services/lookup-import-export');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');
const { auditLookup } = require('../middleware/audit');

const LOOKUP_EXPORT_JOBS_COLLECTION = 'lookup_export_jobs';
const LOOKUP_EXPORT_TMP_DIR = path.join(os.tmpdir(), 'integration-control-plane-lookup-exports');
const LOOKUP_EXPORT_TTL_MS = Math.max(5 * 60 * 1000, Number(process.env.LOOKUP_EXPORT_TTL_MS) || 6 * 60 * 60 * 1000);
const LOOKUP_EXPORT_PROGRESS_INTERVAL = 100;
const LOOKUP_EXPORT_STALE_PROCESSING_MS = Math.max(5 * 60 * 1000, Number(process.env.LOOKUP_EXPORT_STALE_PROCESSING_MS) || 30 * 60 * 1000);
const EXPORT_FILE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lookupExportIndexesEnsured = false;

const escapeCsv = (value) => {
  const text = String(value ?? '');
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const lookupCsvRow = (lookup) => [
  lookup.source?.id, lookup.source?.key, lookup.source?.name, lookup.source?.supplierCode,
  lookup.source?.supplierName, lookup.target?.id, lookup.target?.name, JSON.stringify(lookup.target || {}),
  lookup.type, lookup.category, lookup.description, lookup.orgUnitRid ? `Org Unit ${lookup.orgUnitRid}` : 'Parent',
  lookup.usageCount || 0, lookup.lastUsedAt, lookup.isActive ? 'Yes' : 'No', lookup.createdAt, lookup.updatedAt,
].map(escapeCsv).join(',');

const LOOKUP_CSV_HEADERS = [
  'Source ID', 'Source Key', 'Source Name', 'Source Supplier Code', 'Source Supplier Name', 'Target ID',
  'Target Name', 'Target JSON', 'Type', 'Category', 'Description', 'Scope', 'Usage Count', 'Last Used',
  'Active', 'Created', 'Updated',
];

async function ensureLookupExportIndexes(db) {
  if (lookupExportIndexesEnsured) return;
  const jobs = db.collection(LOOKUP_EXPORT_JOBS_COLLECTION);
  try {
    await jobs.createIndex({ jobId: 1 }, { unique: true });
    await jobs.createIndex({ orgId: 1, createdAt: -1 });
    await jobs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  } catch (error) {
    log('warn', 'Failed to ensure lookup export indexes', { error: error.message });
  }
  lookupExportIndexesEnsured = true;
}

const lookupExportJobResponse = (job) => ({
  jobId: job.jobId,
  status: job.status,
  format: job.format,
  totalRecords: job.totalRecords || 0,
  processedRecords: job.processedRecords || 0,
  fileSizeBytes: job.fileSizeBytes || 0,
  fileName: job.fileName || null,
  errorMessage: job.errorMessage || null,
  statusPath: `/api/v1/lookups/export/jobs/${encodeURIComponent(job.jobId)}`,
  downloadPath: `/api/v1/lookups/export/jobs/${encodeURIComponent(job.jobId)}/download`,
});

const writeChunk = (stream, chunk) => new Promise((resolve, reject) => {
  const cleanup = () => { stream.off('error', onError); stream.off('drain', onDrain); };
  const onError = (error) => { cleanup(); reject(error); };
  const onDrain = () => { cleanup(); resolve(); };
  stream.once('error', onError);
  if (stream.write(chunk)) { cleanup(); resolve(); } else stream.once('drain', onDrain);
});

const finishStream = (stream) => new Promise((resolve, reject) => {
  stream.once('error', reject);
  stream.end(resolve);
});

async function cleanupExpiredLookupExportFiles() {
  let entries;
  try {
    entries = await fsp.readdir(LOOKUP_EXPORT_TMP_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') log('warn', 'Failed to inspect lookup export directory', { error: error.message });
    return;
  }
  const expiresBefore = Date.now() - LOOKUP_EXPORT_TTL_MS;
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('lkexp_'))
    .map(async (entry) => {
      const filePath = path.join(LOOKUP_EXPORT_TMP_DIR, entry.name);
      try {
        if ((await fsp.stat(filePath)).mtimeMs < expiresBefore) await fsp.unlink(filePath);
      } catch (error) {
        if (error.code !== 'ENOENT') log('warn', 'Failed to remove expired lookup export file', { filePath, error: error.message });
      }
    }));
}

async function processLookupExportJob(jobId) {
  const db = await mongodb.getDbSafe();
  await ensureLookupExportIndexes(db);
  const jobs = db.collection(LOOKUP_EXPORT_JOBS_COLLECTION);
  const claimed = await jobs.findOneAndUpdate(
    { jobId, status: 'QUEUED' },
    { $set: { status: 'PROCESSING', startedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  const job = claimed.value;
  if (!job) return;

  const filePath = path.join(LOOKUP_EXPORT_TMP_DIR, `${job.jobId}.${job.format}`);
  let processedRecords = 0;
  let csvStream;
  try {
    await fsp.mkdir(LOOKUP_EXPORT_TMP_DIR, { recursive: true });
    const writer = job.format === 'xlsx' ? createStreamingLookupXlsxWriter(filePath) : null;
    if (!writer) {
      csvStream = fs.createWriteStream(filePath, { encoding: 'utf8' });
      await writeChunk(csvStream, `${LOOKUP_CSV_HEADERS.join(',')}\n`);
    }
    await streamLookupsForExport(job.orgId, job.filters, async (lookup) => {
      if (writer) writer.write(lookup);
      else await writeChunk(csvStream, `${lookupCsvRow(lookup)}\n`);
      processedRecords += 1;
      if (processedRecords % LOOKUP_EXPORT_PROGRESS_INTERVAL === 0) {
        await jobs.updateOne({ jobId }, { $set: { processedRecords, updatedAt: new Date() } });
      }
    });
    if (writer) await writer.close();
    else await finishStream(csvStream);
    const stat = await fsp.stat(filePath);
    await jobs.updateOne({ jobId }, { $set: {
      status: 'COMPLETED', processedRecords, filePath, fileSizeBytes: stat.size, finishedAt: new Date(),
      updatedAt: new Date(), expiresAt: new Date(Date.now() + LOOKUP_EXPORT_TTL_MS),
    } });
  } catch (error) {
    csvStream?.destroy();
    await fsp.rm(filePath, { force: true }).catch(() => {});
    await jobs.updateOne({ jobId }, { $set: {
      status: 'FAILED', processedRecords, errorMessage: error.message, finishedAt: new Date(),
      updatedAt: new Date(), expiresAt: new Date(Date.now() + LOOKUP_EXPORT_TTL_MS),
    } });
    log('error', 'Lookup export job failed', { jobId, error: error.message });
  }
}

async function startLookupExportJob(orgId, filters, format, ownerUserId) {
  const db = await mongodb.getDbSafe();
  await ensureLookupExportIndexes(db);
  const now = new Date();
  const job = {
    jobId: `lkexp_${Date.now()}_${uuidv4().replace(/-/g, '').slice(0, 8)}`,
    orgId, ownerUserId: ownerUserId || null, filters, format, status: 'QUEUED', totalRecords: 0, processedRecords: 0, filePath: null,
    fileName: `lookups-${now.toISOString().slice(0, 10)}.${format}`, fileSizeBytes: 0, errorMessage: null,
    createdAt: now, updatedAt: now, startedAt: null, finishedAt: null,
    expiresAt: new Date(now.getTime() + LOOKUP_EXPORT_TTL_MS),
  };
  await db.collection(LOOKUP_EXPORT_JOBS_COLLECTION).insertOne(job);
  setImmediate(() => processLookupExportJob(job.jobId).catch((error) => log('error', 'Unhandled lookup export job failure', { jobId: job.jobId, error: error.message })));
  return job;
}

async function recoverLookupExportJobs() {
  const db = await mongodb.getDbSafe();
  await ensureLookupExportIndexes(db);
  const jobs = db.collection(LOOKUP_EXPORT_JOBS_COLLECTION);
  const now = new Date();
  await jobs.updateMany(
    { status: 'PROCESSING', updatedAt: { $lt: new Date(now.getTime() - LOOKUP_EXPORT_STALE_PROCESSING_MS) } },
    { $set: { status: 'QUEUED', updatedAt: now, errorMessage: null } }
  );
  const cursor = jobs.find(
    { status: 'QUEUED', expiresAt: { $gt: now } },
    { projection: { jobId: 1 } }
  ).limit(100);
  for await (const job of cursor) {
    setImmediate(() => processLookupExportJob(job.jobId).catch((error) => log('error', 'Recovered lookup export job failed', { jobId: job.jobId, error: error.message })));
  }
}

setImmediate(() => {
  recoverLookupExportJobs().catch((error) => log('warn', 'Failed to recover pending lookup export jobs', { error: error.message }));
  cleanupExpiredLookupExportFiles();
});
const lookupExportCleanupTimer = setInterval(() => {
  cleanupExpiredLookupExportFiles();
}, EXPORT_FILE_CLEANUP_INTERVAL_MS);
lookupExportCleanupTimer.unref?.();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Accept Excel and CSV files
    const allowedMimes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed.'));
    }
  },
});

/**
 * @route GET /api/v1/lookups
 * @desc List lookups with filters
 * @query orgId (required), type, orgUnitRid (optional), category, isActive, search, limit
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }
    if (Object.hasOwn(req.query, 'tenantId')) {
      return res.status(400).json({
        success: false,
        error: 'tenantId query parameter is not supported. Use orgUnitRid or orgId.',
        code: 'TENANT_ID_NOT_ALLOWED',
      });
    }

    const filters = {
      type: req.query.type,
      orgUnitRid: req.query.orgUnitRid !== undefined ? parseInt(req.query.orgUnitRid, 10) : undefined,
      category: req.query.category,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      search: req.query.search,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 1000,
    };

    const lookups = await listLookups(parseInt(orgId, 10), filters);

    res.json({
      success: true,
      data: lookups,
      count: lookups.length,
    });
  })
);

/**
 * @route GET /api/v1/lookups/stats
 * @desc Get lookup statistics
 * @query orgId (required), type (optional)
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { orgId, type } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const filters = { type };
    const stats = await getLookupStats(parseInt(orgId, 10), filters);

    res.json({
      success: true,
      data: stats,
    });
  })
);

/**
 * @route GET /api/v1/lookups/types
 * @desc Get available lookup types for an entity
 * @query orgId (required)
 */
router.get(
  '/types',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const types = await getLookupTypes(parseInt(orgId, 10));

    res.json({
      success: true,
      data: types,
    });
  })
);

/**
 * @route GET /api/v1/lookups/export
 * @desc Queue a complete lookup export. XLSX is written on disk with ExcelJS's
 * streaming writer so large lookup sets never become an in-memory workbook.
 * @query orgId (required), type (optional), format (optional: "xlsx" or "csv")
 */
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const { orgId, type, format = 'xlsx' } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!['xlsx', 'csv'].includes(format)) {
      return res.status(400).json({ success: false, error: 'format must be xlsx or csv' });
    }

    const filters = {
      type,
      orgUnitRid: req.query.orgUnitRid !== undefined ? parseInt(req.query.orgUnitRid, 10) : undefined,
      category: req.query.category,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : true,
      search: req.query.search,
    };
    const job = await startLookupExportJob(parseInt(orgId, 10), filters, format, req.user?.id);
    return res.status(202).json({
      ...lookupExportJobResponse(job),
      message: 'Lookup export queued.',
    });
  })
);

router.get('/export/jobs/:jobId', asyncHandler(async (req, res) => {
  const db = await mongodb.getDbSafe();
  await ensureLookupExportIndexes(db);
  const query = {
    jobId: req.params.jobId,
    orgId: parseInt(req.query.orgId, 10),
  };
  if (req.user?.id) query.ownerUserId = req.user.id;
  const job = await db.collection(LOOKUP_EXPORT_JOBS_COLLECTION).findOne(query);
  if (!job) return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
  return res.json(lookupExportJobResponse(job));
}));

router.get('/export/jobs/:jobId/download', asyncHandler(async (req, res) => {
  const db = await mongodb.getDbSafe();
  await ensureLookupExportIndexes(db);
  const query = {
    jobId: req.params.jobId,
    orgId: parseInt(req.query.orgId, 10),
  };
  if (req.user?.id) query.ownerUserId = req.user.id;
  const job = await db.collection(LOOKUP_EXPORT_JOBS_COLLECTION).findOne(query);
  if (!job) return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
  if (job.status !== 'COMPLETED') return res.status(409).json({ error: 'Export job is not ready', code: 'EXPORT_NOT_READY' });
  try { await fsp.access(job.filePath, fs.constants.R_OK); } catch (_error) {
    return res.status(410).json({ error: 'Export file expired', code: 'EXPORT_FILE_EXPIRED' });
  }
  res.setHeader('Content-Type', job.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${job.fileName}"`);
  return fs.createReadStream(job.filePath).pipe(res);
}));

/**
 * @route GET /api/v1/lookups/import/template
 * @desc Download import template (empty Excel file with headers)
 */
router.get(
  '/import/template',
  asyncHandler(async (_req, res) => {
    const buffer = await generateImportTemplate();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="lookups_import_template.xlsx"');
    res.send(buffer);
  })
);

/**
 * @route GET /api/v1/lookups/:id
 * @desc Get single lookup by ID
 * @query orgId (required)
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const { id } = req.params;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const lookup = await getLookup(id);

    if (!lookup || lookup.orgId !== parseInt(orgId, 10)) {
      return res.status(404).json({
        success: false,
        error: 'Lookup not found',
      });
    }

    res.json({
      success: true,
      data: lookup,
    });
  })
);

/**
 * @route POST /api/v1/lookups
 * @desc Create new lookup
 * @query orgId (required)
 * @body type, source, target, description, category, orgUnitRid, isActive
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const payload = {
      ...req.body,
      orgId: parseInt(orgId, 10),
    };

    // Validate
    try {
      validateLookupEntry(payload);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }

    try {
      const lookup = await addLookup(parseInt(orgId, 10), payload);

      await auditLookup.created(req, lookup);

      res.status(201).json({
        success: true,
        data: lookup,
      });
    } catch (err) {
      if (err.message.includes('Duplicate lookup')) {
        return res.status(409).json({
          success: false,
          error: err.message,
        });
      }
      throw err;
    }
  })
);

/**
 * @route PUT /api/v1/lookups/:id
 * @desc Update existing lookup
 * @query orgId (required)
 * @body type, source, target, description, category, isActive
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const { id } = req.params;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    try {
      const beforeLookup = await getLookup(id).catch(() => null);

      const updated = await updateLookup(parseInt(orgId, 10), id, req.body);

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Lookup not found',
        });
      }

      await auditLookup.updated(req, id, { before: beforeLookup, after: updated });

      res.json({
        success: true,
        data: updated,
      });
    } catch (err) {
      if (err.message.includes('Duplicate lookup')) {
        return res.status(409).json({
          success: false,
          error: err.message,
        });
      }
      throw err;
    }
  })
);

/**
 * @route DELETE /api/v1/lookups/:id
 * @desc Delete lookup
 * @query orgId (required)
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const { id } = req.params;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    const beforeLookup = await getLookup(id).catch(() => null);

    const deleted = await deleteLookup(parseInt(orgId, 10), id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Lookup not found',
      });
    }

    await auditLookup.deleted(req, id, beforeLookup);

    res.json({
      success: true,
      message: 'Lookup deleted successfully',
    });
  })
);

/**
 * @route POST /api/v1/lookups/bulk
 * @desc Bulk create or update lookups (for import)
 * @query orgId (required), mode (optional: "replace"), type, orgUnitRid
 * @body Array of lookup objects
 */
router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { orgId, mode, type } = req.query;
    const orgUnitRid = req.query.orgUnitRid;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!type) {
      return res.status(400).json({
        success: false,
        error: 'type query parameter is required for bulk operations',
      });
    }

    const lookups = req.body;

    // Validate
    try {
      validateBulkImport(lookups);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }

    const options = {
      mode,
      type,
      orgUnitRid: orgUnitRid !== undefined ? parseInt(orgUnitRid, 10) : undefined,
    };

    const result = await bulkCreateLookups(parseInt(orgId, 10), lookups, options);

    await auditLookup.bulkImported(req, type, result.inserted || result.count || result.created || lookups.length);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * @route DELETE /api/v1/lookups/bulk
 * @desc Bulk delete lookups
 * @query orgId (required)
 * @body { ids: ["id1", "id2", ...] }
 */
router.delete(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const { ids } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'ids array is required',
      });
    }

    const result = await bulkDeleteLookups(parseInt(orgId, 10), ids);

    await auditLookup.bulkDeleted(req, null, result.deletedCount || ids.length);

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * @route POST /api/v1/lookups/resolve
 * @desc Resolve single code (forward lookup)
 * @query orgId (required), orgUnitRid (optional)
 * @body { type, sourceId, targetField?, returnMode? }
 */
router.post(
  '/resolve',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const orgUnitRid = req.query.orgUnitRid;
    const { type, sourceId, targetField, returnMode } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!type || !sourceId) {
      return res.status(400).json({
        success: false,
        error: 'type and sourceId are required in request body',
      });
    }

    const normalizedOrgId = parseInt(orgId, 10);
    const normalizedOrgUnitRid = orgUnitRid ? parseInt(orgUnitRid, 10) : null;
    const resolvedReturnMode = String(returnMode || 'SCALAR').toUpperCase();
    const targetObject =
      resolvedReturnMode === 'OBJECT'
        ? await resolveLookupObject(sourceId, type, normalizedOrgId, normalizedOrgUnitRid)
        : null;
    const targetId =
      resolvedReturnMode === 'OBJECT'
        ? (targetObject?.id ?? null)
        : await resolveLookup(sourceId, type, normalizedOrgId, normalizedOrgUnitRid, targetField || 'id');

    const found = resolvedReturnMode === 'OBJECT' ? targetObject !== null : targetId !== null;

    if (!found) {
      return res.status(404).json({
        success: false,
        error: 'No mapping found',
      });
    }

    res.json({
      success: true,
      data: {
        sourceId,
        targetId,
        target: targetObject,
        found,
        type,
      },
    });
  })
);

/**
 * @route POST /api/v1/lookups/resolve-bulk
 * @desc Resolve multiple codes
 * @query orgId (required), orgUnitRid (optional)
 * @body { type, sourceIds: ["id1", "id2", ...], targetField?, returnMode? }
 */
router.post(
  '/resolve-bulk',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const orgUnitRid = req.query.orgUnitRid;
    const { type, sourceIds, targetField, returnMode } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!type || !Array.isArray(sourceIds)) {
      return res.status(400).json({
        success: false,
        error: 'type and sourceIds array are required in request body',
      });
    }

    const results = [];
    const parentRid = parseInt(orgId, 10);
    const scopedOrgUnitRid = orgUnitRid ? parseInt(orgUnitRid, 10) : null;

    const resolvedReturnMode = String(returnMode || 'SCALAR').toUpperCase();
    for (const sourceId of sourceIds) {
      const targetObject =
        resolvedReturnMode === 'OBJECT' ? await resolveLookupObject(sourceId, type, parentRid, scopedOrgUnitRid) : null;
      const targetId =
        resolvedReturnMode === 'OBJECT'
          ? (targetObject?.id ?? null)
          : await resolveLookup(sourceId, type, parentRid, scopedOrgUnitRid, targetField || 'id');
      results.push({
        sourceId,
        targetId,
        target: targetObject,
        found: resolvedReturnMode === 'OBJECT' ? targetObject !== null : targetId !== null,
      });
    }

    res.json({
      success: true,
      data: results,
    });
  })
);

/**
 * @route POST /api/v1/lookups/reverse
 * @desc Reverse lookup (target -> source)
 * @query orgId (required), orgUnitRid (optional)
 * @body { type, targetId }
 */
router.post(
  '/reverse',
  asyncHandler(async (req, res) => {
    const { orgId } = req.query;
    const orgUnitRid = req.query.orgUnitRid;
    const { type, targetId } = req.body;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'orgId query parameter is required',
      });
    }

    if (!type || !targetId) {
      return res.status(400).json({
        success: false,
        error: 'type and targetId are required in request body',
      });
    }

    const result = await reverseLookup(
      targetId,
      type,
      parseInt(orgId, 10),
      orgUnitRid ? parseInt(orgUnitRid, 10) : null
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'No mapping found',
      });
    }

    res.json({
      success: true,
      data: {
        targetId,
        sourceId: result.sourceId,
        scope: result.scope,
        type,
      },
    });
  })
);

/**
 * @route POST /api/v1/lookups/test
 * @desc Test lookup configurations against sample payload
 * @query orgId (required), orgUnitRid (optional), type (required)
 * @body { lookupConfigs: [...], samplePayload: {...} }
 */
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const { orgId, type } = req.query;
    const orgUnitRid = req.query.orgUnitRid;
    const { lookupConfigs, samplePayload } = req.body;

    if (!orgId || !type) {
      return res.status(400).json({
        success: false,
        error: 'orgId and type query parameters are required',
      });
    }

    if (!lookupConfigs || !samplePayload) {
      return res.status(400).json({
        success: false,
        error: 'lookupConfigs and samplePayload are required in request body',
      });
    }

    const result = await testLookups(
      samplePayload,
      lookupConfigs,
      parseInt(orgId, 10),
      orgUnitRid ? parseInt(orgUnitRid, 10) : null
    );

    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * @route POST /api/v1/lookups/import
 * @desc Import lookups from Excel/CSV file
 * @query orgId (required), type (required), orgUnitRid (optional), mode (optional: "replace")
 * @body multipart/form-data with 'file' field
 */
router.post(
  '/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { orgId, type, mode } = req.query;
    const orgUnitRid = req.query.orgUnitRid;

    if (!orgId || !type) {
      return res.status(400).json({
        success: false,
        error: 'orgId and type query parameters are required',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    try {
      // Parse the uploaded file
      const parseResult = await parseImportFile(
        req.file.buffer,
        type,
        parseInt(orgId, 10),
        orgUnitRid ? parseInt(orgUnitRid, 10) : null,
        req.file.originalname
      );

      if (parseResult.lookups.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No valid lookups found in file',
          errors: parseResult.errors,
        });
      }

      // Validate
      try {
        validateBulkImport(parseResult.lookups);
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: err.message,
          parseErrors: parseResult.errors,
        });
      }

      // Import
      const options = {
        mode,
        type,
        orgUnitRid: orgUnitRid ? parseInt(orgUnitRid, 10) : undefined,
      };

      const importResult = await bulkCreateLookups(parseInt(orgId, 10), parseResult.lookups, options);

      await auditLookup.bulkImported(
        req,
        type,
        importResult.inserted || importResult.count || importResult.created || parseResult.lookups.length
      );

      res.json({
        success: true,
        data: {
          ...importResult,
          totalRows: parseResult.totalRows,
          parseErrors: parseResult.errors,
        },
      });
    } catch (err) {
      log('error', 'Import failed', { error: err.message });
      res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  })
);

module.exports = router;
