const express = require('express');
const data = require('../data');
const asyncHandler = require('../utils/async-handler');
const {
  createExportJobStore,
  exportSettings,
  parseBooleanQuery,
  writeFileChunk,
  writeWithBackpressure,
  trackAbort,
} = require('../services/export-jobs');

const router = express.Router();
const { asyncThreshold: ALERT_CENTER_EXPORT_ASYNC_THRESHOLD, ttlMs: ALERT_CENTER_EXPORT_JOB_TTL_MS } = exportSettings('ALERT_CENTER');
const exportJobs = createExportJobStore({
  collection: 'alert_center_export_jobs',
  idPrefix: 'ace',
  basePath: '/api/v1/alert-center',
  tmpDirName: 'integration-control-plane-alert-center-exports',
  ttlMs: ALERT_CENTER_EXPORT_JOB_TTL_MS,
  orgScoped: true,
  label: 'alert-center',
});

/** What a background alert-center export writes: one row per alert, as JSON or CSV. */
const writeExport = async ({ job, openStream, progress }) => {
  const stream = openStream();
  await writeFileChunk(stream, job.format === 'json' ? '[' : `${buildCsvHeader()}\n`);
  let count = 0;
  await data.streamAlertCenterLogsForExport(job.orgId, job.filters || {}, async (row) => {
    const chunk = job.format === 'json' ? `${count === 0 ? '' : ','}${JSON.stringify(row)}` : `${buildCsvRow(row)}\n`;
    await writeFileChunk(stream, chunk);
    count += 1;
    await progress(count);
  });
  if (job.format === 'json') await writeFileChunk(stream, ']');
  return { processedRecords: count };
};

const startExportJob = async (orgId, format, filters, totalRecords) =>
  exportJobs.start(await exportJobs.create({ orgId, format, fileStem: 'alert-center', totalRecords, fields: { filters } }), writeExport);

const toCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const ALERT_CENTER_CSV_HEADERS = [
  'Alert ID',
  'Timestamp',
  'Status',
  'Channel',
  'Type',
  'Subject',
  'Recipients',
  'Total Failures',
  'Window Start',
  'Window End',
  'Error Message',
  'Error Stack',
];

const buildCsvHeader = () => ALERT_CENTER_CSV_HEADERS.join(',');

const buildCsvRow = (row) =>
  [
    toCsvValue(row.id),
    toCsvValue(row.createdAt),
    toCsvValue(row.status),
    toCsvValue(row.channel),
    toCsvValue(row.type),
    toCsvValue(row.subject),
    toCsvValue((row.recipients || []).join('; ')),
    toCsvValue(row.totalFailures),
    toCsvValue(row.windowStart),
    toCsvValue(row.windowEnd),
    toCsvValue(row.errorMessage),
    toCsvValue(row.errorStack),
  ].join(',');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const filters = {
      status: req.query.status,
      channel: req.query.channel,
      type: req.query.type,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };

    const logs = await data.listAlertCenterLogs(orgId, filters);
    return res.json({ logs });
  })
);

router.get(
  '/stats/summary',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const filters = {
      channel: req.query.channel,
      type: req.query.type,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    };

    const summary = await data.getAlertCenterStatsSummary(orgId, filters);
    return res.json(summary);
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    const status = await data.getFailureReportSchedulerStatus(orgId);
    return res.json(status);
  })
);

router.get(
  '/export/json',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const filters = {
      status: req.query.status,
      channel: req.query.channel,
      type: req.query.type,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    };

    const totalRecords = await data.countAlertCenterLogs(orgId, filters);
    const useAsyncExport = parseBooleanQuery(req.query.async) || totalRecords >= ALERT_CENTER_EXPORT_ASYNC_THRESHOLD;
    if (useAsyncExport) {
      const job = await startExportJob(orgId, 'json', filters, totalRecords);
      return res.status(202).json({
        ...exportJobs.toResponse(job),
        message: `Alert center export queued (${totalRecords.toLocaleString()} rows).`,
      });
    }

    const isAborted = trackAbort(req);

    const filename = `alert-center-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const opened = await writeWithBackpressure(req, res, '[', isAborted);
    if (!opened) {
      return;
    }
    let isFirst = true;
    await data.streamAlertCenterLogsForExport(
      orgId,
      filters,
      async (row) => {
        if (isAborted()) return;
        const wrote = await writeWithBackpressure(req, res, `${isFirst ? '' : ','}${JSON.stringify(row)}`, isAborted);
        if (!wrote) return;
        isFirst = false;
      },
      { shouldStop: isAborted }
    );
    if (!isAborted()) {
      await writeWithBackpressure(req, res, ']', isAborted);
      res.end();
    }
  })
);

router.get(
  '/export/csv',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }

    const filters = {
      status: req.query.status,
      channel: req.query.channel,
      type: req.query.type,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    };

    const totalRecords = await data.countAlertCenterLogs(orgId, filters);
    const useAsyncExport = parseBooleanQuery(req.query.async) || totalRecords >= ALERT_CENTER_EXPORT_ASYNC_THRESHOLD;
    if (useAsyncExport) {
      const job = await startExportJob(orgId, 'csv', filters, totalRecords);
      return res.status(202).json({
        ...exportJobs.toResponse(job),
        message: `Alert center export queued (${totalRecords.toLocaleString()} rows).`,
      });
    }

    const isAborted = trackAbort(req);

    const filename = `alert-center-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Transfer-Encoding', 'chunked');
    const headerWritten = await writeWithBackpressure(req, res, `${buildCsvHeader()}\n`, isAborted);
    if (!headerWritten) {
      return;
    }
    await data.streamAlertCenterLogsForExport(
      orgId,
      filters,
      async (row) => {
        if (isAborted()) return;
        await writeWithBackpressure(req, res, `${buildCsvRow(row)}\n`, isAborted);
      },
      { shouldStop: isAborted }
    );
    if (!isAborted()) {
      res.end();
    }
  })
);

router.get(
  '/export/jobs/:jobId',
  asyncHandler(async (req, res) => {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
    }
    const job = await exportJobs.get(req.params.jobId, orgId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
    }
    return res.json(exportJobs.toResponse(job));
  })
);

router.get('/export/jobs/:jobId/download', exportJobs.downloadHandler());

module.exports = router;
