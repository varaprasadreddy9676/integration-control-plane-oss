const express = require('express');
const data = require('../data');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');
const followUps = require('../data/delivery-follow-ups');
const { summarizeFollowUpStats } = require('../services/delivery-follow-up-config');
const { maskIntegrationSecrets, maskLogSecrets, maskUrlSecrets } = require('../utils/integration-secrets');
const { createExportJobStore, exportSettings, parseBooleanQuery, writeFileChunk, writeWithBackpressure } = require('../services/export-jobs');
const { isPortalScopedSession, assertViewAllowed, assertIntegrationInScope } = require('../middleware/portal-scope');
const mongodb = require('../mongodb');
const { similarFailures } = require('../data/log-insights');

const router = express.Router();

/**
 * Portal scope: ensure a log's integration is within scope. Use the full integration
 * object (with tags) when there is one, so tag-scoped profiles are checked correctly.
 */
function assertLogInScope(req, integrationConfigId, integration = null) {
  if (isPortalScopedSession(req) && integrationConfigId) {
    assertIntegrationInScope(req, integration ?? { _id: integrationConfigId, id: integrationConfigId });
  }
}

/**
 * Build an integrationId filter clause for portal-scoped log queries.
 * When the session has allowedIntegrationIds restrictions, inject them into the
 * filters so the DB query returns only the permitted logs — instead of fetching
 * all and filtering in-memory (which would break pagination).
 */
function applyPortalLogFilters(req, filters) {
  if (!isPortalScopedSession(req)) return filters;
  const { allowedIntegrationIds } = req.portalScope;
  if (!allowedIntegrationIds || allowedIntegrationIds.length === 0) return filters;

  // If the caller already requested a specific integrationId, verify it is allowed.
  if (filters.integrationConfigId) {
    const requested = String(filters.integrationConfigId);
    if (!allowedIntegrationIds.includes(requested)) {
      // Return a never-matching filter by requesting an impossible ID
      return { ...filters, integrationConfigId: '__portal_scope_blocked__' };
    }
    return filters;
  }

  // No specific integrationId requested — restrict to allowed ones.
  // Pass as comma-separated list which data.listLogs already supports via `integrationIds`.
  return { ...filters, portalAllowedIntegrationIds: allowedIntegrationIds };
}
const { asyncThreshold: LOG_EXPORT_ASYNC_THRESHOLD, ttlMs: LOG_EXPORT_JOB_TTL_MS } = exportSettings('LOG');
const exportJobs = createExportJobStore({
  collection: 'log_export_jobs',
  idPrefix: 'exp',
  basePath: '/api/v1/logs',
  tmpDirName: 'integration-control-plane-log-exports',
  ttlMs: LOG_EXPORT_JOB_TTL_MS,
  orgScoped: true,
  label: 'log',
});

const EXPORT_CSV_HEADERS = [
  'Log ID',
  'Timestamp',
  'Integration Name',
  'Event Type',
  'Flow',
  'Status',
  'HTTP Status',
  'Response Time (ms)',
  'Attempt Count',
  'Target URL',
  'HTTP Method',
  'cURL Command',
  'Request Payload (JSON)',
  'Response Body',
  'Error Message',
];

const isSupportedExportFormat = (value) => value === 'csv' || value === 'json';

function filterLogsForPortalScope(req, logs) {
  if (!isPortalScopedSession(req)) return logs;
  const { allowedIntegrationIds } = req.portalScope;
  if (!Array.isArray(allowedIntegrationIds) || allowedIntegrationIds.length === 0) {
    return [];
  }
  const allowed = new Set(allowedIntegrationIds.map(String));
  return logs.filter((logEntry) => {
    if (!logEntry?.integrationConfigId) return false;
    return allowed.has(String(logEntry.integrationConfigId));
  });
}

const buildExportFiltersFromReq = (req) => ({
  status: req.query.status,
  integrationConfigId: req.query.integrationId || req.query.integrationId,
  provider: req.query.provider,
  eventType: req.query.eventType,
  direction: req.query.direction,
  triggerType: req.query.triggerType,
  errorCategory: req.query.errorCategory,
  clientIp: req.query.clientIp,
  hour: req.query.hour,
  dayOfWeek: req.query.dayOfWeek,
  timezoneOffset: req.query.timezoneOffset,
  search: req.query.search,
  startDate: req.query.startDate,
  endDate: req.query.endDate,
});

const getFlowLabel = (logEntry) =>
  logEntry.direction === 'OUTBOUND' && logEntry.triggerType === 'SCHEDULED'
    ? 'SCHEDULED'
    : logEntry.direction || 'OUTBOUND';

const resolveResponseBodyForExport = (logEntry) =>
  logEntry?.response?.body !== undefined ? logEntry.response.body : logEntry.responseBody;

const escapeCsvCell = (cell) => {
  if (cell == null) return '';
  const str = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
  const sanitized = str.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
  if (sanitized.includes(',') || sanitized.includes('"')) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
};

const generateExportCurlCommand = (integration, payload) => {
  if (!integration) return 'N/A';

  // Exports get shared: never include credentials, not even a prefix of them.
  let curl = `curl -X ${integration.httpMethod} "${maskUrlSecrets(integration.targetUrl)}"`;
  curl += ' -H "Content-Type: application/json"';

  if (integration.outgoingAuthType === 'API_KEY' && integration.outgoingAuthConfig) {
    const headerName = integration.outgoingAuthConfig.headerName || 'X-API-Key';
    curl += ` -H "${headerName}: [REDACTED]"`;
  } else if (integration.outgoingAuthType === 'BEARER' && integration.outgoingAuthConfig) {
    curl += ' -H "Authorization: Bearer [REDACTED]"';
  } else if (integration.outgoingAuthType === 'BASIC' && integration.outgoingAuthConfig) {
    curl += ' -H "Authorization: Basic [REDACTED]"';
  }

  const payloadJson = JSON.stringify(payload || {});
  curl += ` -d '${payloadJson.substring(0, 200)}${payloadJson.length > 200 ? '...' : ''}'`;

  return curl;
};

/** What a background log export writes: one row (CSV) or object (JSON) per delivery log. */
const writeExport = async ({ job, openStream, progress }) => {
  const stream = openStream();
  const integrationCache = new Map();
  const selectedIds = Array.isArray(job.selectedIds) ? job.selectedIds : null;
  let count = 0;

  await writeFileChunk(stream, job.format === 'csv' ? `${EXPORT_CSV_HEADERS.map(escapeCsvCell).join(',')}\r\n` : '[');

  const exportLogEntry = async (logEntry) => {
    if (job.format === 'csv') {
      let integration = null;
      if (logEntry.integrationConfigId) {
        if (integrationCache.has(logEntry.integrationConfigId)) {
          integration = integrationCache.get(logEntry.integrationConfigId);
        } else {
          try {
            integration = await data.getIntegrationById(logEntry.integrationConfigId);
            if (integration) integrationCache.set(logEntry.integrationConfigId, integration);
          } catch (_err) {
            integration = null;
          }
        }
      }

      const row = [
        logEntry.id,
        logEntry.createdAt,
        logEntry.integrationName,
        logEntry.eventType,
        getFlowLabel(logEntry),
        logEntry.status,
        logEntry.responseStatus ?? 'N/A',
        logEntry.responseTimeMs ?? 'N/A',
        logEntry.attemptCount ?? 0,
        maskUrlSecrets(integration?.targetUrl) ?? 'N/A',
        integration?.httpMethod ?? 'N/A',
        generateExportCurlCommand(integration, logEntry.requestPayload),
        logEntry.requestPayload,
        resolveResponseBodyForExport(logEntry),
        logEntry.errorMessage ?? '',
      ];
      await writeFileChunk(stream, `${row.map(escapeCsvCell).join(',')}\r\n`);
    } else {
      const { tenantId, ...rest } = logEntry;
      const exportLog = { ...rest, flow: getFlowLabel(rest), responseBody: resolveResponseBodyForExport(logEntry) };
      await writeFileChunk(stream, `${count === 0 ? '' : ','}${JSON.stringify(maskLogSecrets(exportLog))}`);
    }
    count += 1;
    await progress(count);
  };

  if (selectedIds && selectedIds.length > 0) {
    const logs = (await Promise.all(selectedIds.map((id) => data.getLogById(job.orgId, id)))).filter(Boolean);
    if (logs.length === 0) throw new Error('No logs found for selected IDs');
    for (const logEntry of logs) {
      await exportLogEntry(logEntry);
    }
  } else {
    await data.streamLogsForExport(job.orgId, job.filters || {}, exportLogEntry, { includeFullResponseBody: true });
  }

  if (job.format === 'json') await writeFileChunk(stream, ']');
  return { processedRecords: count, totalRecords: count };
};

const startLogExportJob = async ({ orgId, format, filters, totalRecords, selectedIds }) =>
  exportJobs.start(
    await exportJobs.create({
      orgId,
      format,
      fileStem: 'integration-delivery-logs',
      totalRecords,
      fields: { filters, selectedIds: Array.isArray(selectedIds) && selectedIds.length ? selectedIds : null },
    }),
    writeExport
  );

const buildQueuedExportMessage = (totalRecords, forcedAsync = false) => {
  if (forcedAsync) {
    return 'Export queued for background processing.';
  }
  if (Number.isFinite(totalRecords) && totalRecords > 0) {
    return `Large export queued (${totalRecords.toLocaleString()} logs).`;
  }
  return `Large export queued (more than ${LOG_EXPORT_ASYNC_THRESHOLD.toLocaleString()} logs).`;
};

// Bulk operations - Must be defined BEFORE /:id routes to avoid parameter matching
router.post(
  '/bulk/retry',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    // Validation
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids must be a non-empty array',
        code: 'VALIDATION_ERROR',
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        error: 'Cannot retry more than 100 logs at once',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.bulkRetryLogs(req.orgId, ids);

    log('info', 'Bulk log retry', {
      orgId: req.orgId,
      idsCount: ids.length,
      retriedCount: result.retriedCount,
    });

    return res.json({
      message: `Successfully queued ${result.retriedCount} log(s) for retry`,
      retriedCount: result.retriedCount,
      failedIds: result.failedIds,
    });
  })
);

router.delete(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    // Validation
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids must be a non-empty array',
        code: 'VALIDATION_ERROR',
      });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        error: 'Cannot delete more than 100 logs at once',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.bulkDeleteLogs(req.orgId, ids);

    log('info', 'Bulk log delete', {
      orgId: req.orgId,
      idsCount: ids.length,
      deletedCount: result.deletedCount,
    });

    return res.json({
      message: `Successfully deleted ${result.deletedCount} log(s)`,
      deletedCount: result.deletedCount,
      failedIds: result.failedIds,
    });
  })
);

// Cleanup stuck RETRYING logs
router.post(
  '/cleanup/stuck-retrying',
  asyncHandler(async (req, res) => {
    const { hoursThreshold } = req.body;

    // Default to 4 hours if not specified
    const threshold = hoursThreshold && hoursThreshold > 0 ? hoursThreshold : 4;

    // Prevent unreasonably low thresholds
    if (threshold < 1) {
      return res.status(400).json({
        error: 'hoursThreshold must be at least 1 hour',
        code: 'VALIDATION_ERROR',
      });
    }

    const result = await data.cleanupStuckRetryingLogs(threshold);

    log('info', 'Cleaned up stuck RETRYING logs', {
      orgId: req.orgId,
      hoursThreshold: threshold,
      logsUpdated: result.logsUpdated,
    });

    return res.json({
      success: true,
      message: `Successfully marked ${result.logsUpdated} stuck log(s) as ABANDONED`,
      logsUpdated: result.logsUpdated,
      hoursThreshold: result.hoursThreshold,
    });
  })
);

router.get(
  '/stats/summary',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    // Require orgId — without it we'd query across all orgs and return garbage counts
    if (!req.orgId) {
      return res.json({ total: 0, failed: 0, skipped: 0, pending: 0, success: 0 });
    }

    // Use dedicated aggregation function for unbounded stats calculation
    // This does NOT use listLogs() to avoid the 500-row cap
    // Status is intentionally excluded — stats cards always show counts across all statuses
    const baseFilters = {
      integrationConfigId: req.query.integrationId || req.query.integrationId,
      provider: req.query.provider,
      eventType: req.query.eventType,
      direction: req.query.direction,
      triggerType: req.query.triggerType,
      errorCategory: req.query.errorCategory,
      clientIp: req.query.clientIp,
      search: req.query.search,
      hour: req.query.hour,
      dayOfWeek: req.query.dayOfWeek,
      timezoneOffset: req.query.timezoneOffset,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      groupBy: req.query.groupBy,
    };

    const filters = applyPortalLogFilters(req, baseFilters);
    const stats = await data.getLogStatsSummary(req.orgId, filters);
    res.json(stats);
  })
);

// Delivered / read / failed for accepted sends that have a follow-up script.
router.get(
  '/stats/delivery-follow-up',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    const empty = { ...summarizeFollowUpStats({}), topErrors: [] };
    if (!req.orgId) return res.json(empty);

    const filters = applyPortalLogFilters(req, { integrationConfigId: req.query.integrationId });
    const stats = await followUps.getStats(req.orgId, {
      startDate: req.query.startDate ? new Date(req.query.startDate) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate) : undefined,
      integrationId: filters.integrationConfigId,
      integrationIds: filters.portalAllowedIntegrationIds,
    });
    res.json({ ...summarizeFollowUpStats(stats.byStatus), topErrors: stats.topErrors });
  })
);

router.post(
  '/:id/replay',
  asyncHandler(async (req, res) => {
    try {
      const logEntry = await data.getLogById(req.orgId, req.params.id);
      if (!logEntry) {
        return res.status(404).json({ error: 'Log not found', code: 'NOT_FOUND' });
      }

      const replayableStatuses = ['FAILED', 'ABANDONED'];
      if (!replayableStatuses.includes(logEntry.status)) {
        return res.status(400).json({
          error: 'Can only replay failed or abandoned deliveries',
          code: 'INVALID_REPLAY',
        });
      }

      // Get integration configuration
      const integration = await data.getIntegrationById(logEntry.integrationConfigId);
      if (!integration || !integration.isActive) {
        return res.status(400).json({
          error: 'Integration configuration not found or inactive',
          code: 'WEBHOOK_INACTIVE',
        });
      }

      // Create replay event with marker
      const replayData = {
        id: logEntry.id,
        event_type: logEntry.eventType,
        entity_rid: req.orgId,
        payload: logEntry.requestPayload,
        replayed: true,
        original_log_id: req.params.id,
        replay_reason: req.body.reason || 'Manual replay by user',
      };

      // Process replay using existing delivery logic
      const { replayEvent } = require('../processor/retry-handler');
      const forceReplay = Boolean(req.body?.force);
      await replayEvent(req.params.id, req.orgId, { ...req.body, force: forceReplay });

      log('info', 'Event replayed', {
        originalLogId: req.params.id,
        integrationConfigId: logEntry.integrationConfigId,
        eventType: logEntry.eventType,
        reason: req.body.reason || 'Manual replay',
        force: forceReplay,
      });

      res.json({
        message: 'Event replay initiated',
        replayId: replayData.id,
        status: 'queued',
      });
    } catch (error) {
      log('error', 'Replay failed', { error: error.message, scope: 'replay-event' });
      res.status(500).json({
        error: 'Replay failed',
        code: 'INTERNAL_ERROR',
      });
    }
  })
);

router.get(
  '/',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    const baseFilters = {
      status: req.query.status,
      integrationConfigId: req.query.integrationId || req.query.integrationId,
      provider: req.query.provider,
      eventType: req.query.eventType,
      direction: req.query.direction,
      triggerType: req.query.triggerType,
      errorCategory: req.query.errorCategory,
      clientIp: req.query.clientIp,
      hour: req.query.hour,
      dayOfWeek: req.query.dayOfWeek,
      timezoneOffset: req.query.timezoneOffset,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit,
    };

    const filters = applyPortalLogFilters(req, baseFilters);

    const groupMode = (req.query.groupBy || '').toLowerCase();
    const response =
      groupMode === 'message'
        ? await data.getLogsPageGroupedByMessage(req.orgId, filters)
        : await data.getLogsPage(req.orgId, filters);
    res.json(maskLogSecrets(response));
  })
);

router.get(
  '/export',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    let aborted = false;

    try {
      const filters = applyPortalLogFilters(req, buildExportFiltersFromReq(req));
      const forceAsyncExport = parseBooleanQuery(req.query.async);
      const exportProbe = forceAsyncExport
        ? { exceedsThreshold: true, exactCount: null }
        : await data.probeLogsThreshold(req.orgId, filters, LOG_EXPORT_ASYNC_THRESHOLD);
      const useAsyncExport = forceAsyncExport || exportProbe.exceedsThreshold;
      if (useAsyncExport) {
        const job = await startLogExportJob({
          orgId: req.orgId,
          format: 'csv',
          filters,
          totalRecords: exportProbe.exactCount || 0,
        });
        return res.status(202).json({
          ...exportJobs.toResponse(job),
          message: buildQueuedExportMessage(exportProbe.exactCount, forceAsyncExport),
        });
      }

      const markAborted = () => {
        aborted = true;
      };
      req.on('close', markAborted);
      req.on('aborted', markAborted);

      const isAborted = () => aborted;

      // Set headers for streaming CSV download
      const filename = `integration-delivery-logs-${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Transfer-Encoding', 'chunked');

      // Write CSV header row — use \r\n (RFC 4180) so Excel treats it as a row boundary
      const headerWritten = await writeWithBackpressure(
        req,
        res,
        `${EXPORT_CSV_HEADERS.map(escapeCsvCell).join(',')}\r\n`,
        isAborted
      );
      if (!headerWritten) {
        return;
      }

      // Cache for integration configs to avoid duplicate fetches
      const integrationCache = new Map();

      let exportCount = 0;

      // Stream logs using cursor-based iteration
      await data.streamLogsForExport(
        req.orgId,
        filters,
        async (logEntry) => {
          if (isAborted()) {
            return;
          }

          // Fetch integration config if not cached
          let integration = null;
          if (logEntry.integrationConfigId) {
            if (integrationCache.has(logEntry.integrationConfigId)) {
              integration = integrationCache.get(logEntry.integrationConfigId);
            } else {
              try {
                integration = await data.getIntegrationById(logEntry.integrationConfigId);
                if (integration) {
                  integrationCache.set(logEntry.integrationConfigId, integration);
                }
              } catch (_err) {
                // Integration might be deleted, use null
              }
            }
          }

          // Build CSV row
          const responseBodyForExport = resolveResponseBodyForExport(logEntry);
          const flowLabel = getFlowLabel(logEntry);
          const row = [
            logEntry.id,
            logEntry.createdAt,
            logEntry.integrationName,
            logEntry.eventType,
            flowLabel,
            logEntry.status,
            logEntry.responseStatus ?? 'N/A',
            logEntry.responseTimeMs ?? 'N/A',
            logEntry.attemptCount ?? 0,
            maskUrlSecrets(integration?.targetUrl) ?? 'N/A',
            integration?.httpMethod ?? 'N/A',
            generateExportCurlCommand(integration, logEntry.requestPayload),
            logEntry.requestPayload, // escapeCsvCell serializes objects
            responseBodyForExport, // Full response.body exported by default
            logEntry.errorMessage ?? '',
          ];

          // Write row to stream with backpressure handling
          const canContinue = await writeWithBackpressure(
            req,
            res,
            `${row.map(escapeCsvCell).join(',')}\r\n`,
            isAborted
          );
          if (!canContinue) return;

          exportCount++;

          // Yield control to event loop every 100 rows for better performance
          if (exportCount % 100 === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        },
        { shouldStop: isAborted, includeFullResponseBody: true }
      );

      // End the stream
      if (!isAborted()) {
        res.end();

        log('info', 'CSV export completed', {
          orgId: req.orgId,
          exportCount,
          filters,
        });
      } else {
        log('warn', 'CSV export aborted by client', {
          orgId: req.orgId,
          filters,
        });
      }
    } catch (error) {
      log('error', 'CSV export failed', { error: error.message, aborted });
      // If headers not sent yet, send error response
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
      } else if (!aborted) {
        // If streaming already started but not aborted, end the stream
        res.end();
      }
    }
  })
);

// Export selected logs by IDs (POST for bulk IDs)
router.post(
  '/export/selected',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    try {
      const { ids, format = 'json' } = req.body;
      const useAsyncExport = parseBooleanQuery(req.query.async);

      // Validation
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({
          error: 'ids must be a non-empty array',
          code: 'VALIDATION_ERROR',
        });
      }

      if (ids.length > 1000) {
        return res.status(400).json({
          error: 'Cannot export more than 1000 logs at once',
          code: 'VALIDATION_ERROR',
        });
      }

      if (!isSupportedExportFormat(format)) {
        return res.status(400).json({
          error: 'format must be either csv or json',
          code: 'VALIDATION_ERROR',
        });
      }

      const fetchedLogs = (await Promise.all(ids.map((id) => data.getLogById(req.orgId, id)))).filter(Boolean);
      const logs = filterLogsForPortalScope(req, fetchedLogs);

      if (logs.length === 0) {
        return res.status(404).json({
          error: 'No logs found for the provided IDs',
          code: 'NOT_FOUND',
        });
      }

      if (useAsyncExport) {
        const job = await startLogExportJob({
          orgId: req.orgId,
          format,
          filters: {},
          totalRecords: logs.length,
          selectedIds: logs.map((logEntry) => logEntry.id),
        });
        return res.status(202).json({
          ...exportJobs.toResponse(job),
          message: `Selected export queued (${logs.length.toLocaleString()} logs).`,
        });
      }

      // Fetch integration configs to enrich log data
      const integrationCache = new Map();
      for (const logEntry of logs) {
        if (
          logEntry.integrationConfigId &&
          !integrationCache.has(logEntry.integrationConfigId)
        ) {
          try {
            const integration = await data.getIntegrationById(logEntry.integrationConfigId);
            if (integration) {
              integrationCache.set(logEntry.integrationConfigId, integration);
            }
          } catch (_err) {
            // Integration might be deleted
          }
        }
      }

      if (format === 'csv') {
        // CSV export
        const headers = [
          'Log ID',
          'Timestamp',
          'Integration Name',
          'Event Type',
          'Flow',
          'Status',
          'HTTP Status',
          'Response Time (ms)',
          'Attempt Count',
          'Target URL',
          'HTTP Method',
          'Request Payload (JSON)',
          'Response Body',
          'Error Message',
        ];

        const escapeCsvCell = (cell) => {
          if (cell == null) return '';
          const str = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
          const sanitized = str.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
          if (sanitized.includes(',') || sanitized.includes('"')) {
            return `"${sanitized.replace(/"/g, '""')}"`;
          }
          return sanitized;
        };

        const csvRows = logs.map((logEntry) => {
          const integration = integrationCache.get(logEntry.integrationConfigId);
          const flowLabel = getFlowLabel(logEntry);
          const responseBodyForExport = resolveResponseBodyForExport(logEntry);
          return [
            logEntry.id,
            logEntry.createdAt,
            logEntry.integrationName,
            logEntry.eventType,
            flowLabel,
            logEntry.status,
            logEntry.responseStatus ?? 'N/A',
            logEntry.responseTimeMs ?? 'N/A',
            logEntry.attemptCount ?? 0,
            maskUrlSecrets(integration?.targetUrl) ?? 'N/A',
            integration?.httpMethod ?? 'N/A',
            logEntry.requestPayload,
            responseBodyForExport,
            logEntry.errorMessage ?? '',
          ];
        });

        const csvContent = [
          headers.map(escapeCsvCell).join(','),
          ...csvRows.map((row) => row.map(escapeCsvCell).join(',')),
        ].join('\r\n');

        const filename = `integration-logs-selected-${logs.length}-${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
      } else {
        // JSON export
        const cleanLogs = logs.map(({ tenantId, ...rest }) => {
          const flow = getFlowLabel(rest);
          return { ...rest, responseBody: resolveResponseBodyForExport(rest), flow };
        });
        const filename = `integration-logs-selected-${logs.length}-${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(maskLogSecrets(cleanLogs));
      }

      log('info', 'Selected logs exported', {
        orgId: req.orgId,
        count: logs.length,
        format,
      });
    } catch (error) {
      log('error', 'Selected export failed', { error: error.message });
      res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    }
  })
);

router.get(
  '/export/json',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    try {
      const filters = applyPortalLogFilters(req, buildExportFiltersFromReq(req));
      const forceAsyncExport = parseBooleanQuery(req.query.async);
      const exportProbe = forceAsyncExport
        ? { exceedsThreshold: true, exactCount: null }
        : await data.probeLogsThreshold(req.orgId, filters, LOG_EXPORT_ASYNC_THRESHOLD);
      const useAsyncExport = forceAsyncExport || exportProbe.exceedsThreshold;
      if (useAsyncExport) {
        const job = await startLogExportJob({
          orgId: req.orgId,
          format: 'json',
          filters,
          totalRecords: exportProbe.exactCount || 0,
        });
        return res.status(202).json({
          ...exportJobs.toResponse(job),
          message: buildQueuedExportMessage(exportProbe.exactCount, forceAsyncExport),
        });
      }

      let aborted = false;
      const markAborted = () => {
        aborted = true;
      };
      req.on('close', markAborted);
      req.on('aborted', markAborted);

      const isAborted = () => aborted;

      // Set headers for JSON file download
      const filename = `integration-delivery-logs-${new Date().toISOString().split('T')[0]}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const opened = await writeWithBackpressure(req, res, '[', isAborted);
      if (!opened) {
        return;
      }

      let isFirst = true;
      await data.streamLogsForExport(
        req.orgId,
        filters,
        async (logEntry) => {
          if (isAborted()) {
            return;
          }

          const { tenantId, ...rest } = logEntry;
          const flow =
            rest.direction === 'OUTBOUND' && rest.triggerType === 'SCHEDULED'
              ? 'SCHEDULED'
              : rest.direction || 'OUTBOUND';
          const chunk = (isFirst ? '' : ',') + JSON.stringify(maskLogSecrets({ ...rest, flow }));
          isFirst = false;

          const wrote = await writeWithBackpressure(req, res, chunk, isAborted);
          if (!wrote) {
            return;
          }
        },
        { shouldStop: isAborted, includeFullResponseBody: true }
      );

      if (!isAborted()) {
        await writeWithBackpressure(req, res, ']', isAborted);
        res.end();
      }
    } catch (error) {
      log('error', 'JSON export failed', { error: error.message });
      if (res.writableEnded || res.destroyed) {
        return;
      }
      if (res.headersSent) {
        try {
          res.end();
        } catch (_err) {
          // Response might already be closed; ignore.
        }
        return;
      }
      return res.status(500).json({ error: 'Export failed', code: 'INTERNAL_ERROR' });
    }
  })
);

router.get(
  '/export/jobs/:jobId',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    const job = await exportJobs.get(req.params.jobId, req.orgId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
    }
    return res.json(exportJobs.toResponse(job));
  })
);

router.get('/export/jobs/:jobId/download', assertViewAllowed('logs'), exportJobs.downloadHandler());

/** How many other deliveries of this integration failed the same way within `minutes` (default 60) of this one. */
router.get(
  '/:id/similar-failures',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    const db = await mongodb.getDbSafe();
    const logId = mongodb.toObjectId(req.params.id);
    const logDoc = logId ? await db.collection('execution_logs').findOne({ _id: logId, orgId: req.orgId }) : null;
    if (!logDoc) {
      return res.status(404).json({ error: 'Log not found', code: 'NOT_FOUND' });
    }
    if (isPortalScopedSession(req) && logDoc.integrationConfigId) {
      const integration = await data.getIntegrationById(String(logDoc.integrationConfigId)).catch(() => null);
      assertLogInScope(req, String(logDoc.integrationConfigId), integration);
    }
    return res.json(await similarFailures(req.orgId, logDoc, { minutes: req.query.minutes }));
  })
);

router.get(
  '/:id',
  assertViewAllowed('logs'),
  asyncHandler(async (req, res) => {
    const logEntry = await data.getLogById(req.orgId, req.params.id);
    if (!logEntry) {
      return res.status(404).json({ error: 'Log not found', code: 'NOT_FOUND' });
    }

    // Include integration configuration details for enhanced UI
    // Fetch first so the scope check has full integration data (including tags) for tag-scoped profiles
    let __KEEP_integrationConfig__ = null;
    if (logEntry.integrationConfigId) {
      try {
        // Credentials are masked like every integration response; admins who need
        // a runnable cURL fetch real values from the audited /credentials endpoint.
        const integration = await data.getIntegrationById(logEntry.integrationConfigId);
        __KEEP_integrationConfig__ = integration ? maskIntegrationSecrets(integration) : null;
      } catch (_err) {
        // Integration might be deleted, ignore error
      }
    }

    assertLogInScope(req, logEntry.integrationConfigId, __KEEP_integrationConfig__);

    return res.json({
      ...maskLogSecrets(logEntry),
      __KEEP_integrationConfig__,
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = req.body;
    if (!payload.integrationConfigId) {
      return res
        .status(400)
        .json({ error: 'integrationConfigId is required', code: 'VALIDATION_ERROR' });
    }
    await data.recordLog(req.orgId, payload);
    log('info', 'Log recorded', {
      integrationConfigId: payload.integrationConfigId,
    });
    return res.status(201).json({ message: 'Logged' });
  })
);

module.exports = router;
