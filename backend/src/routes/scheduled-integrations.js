const express = require('express');
const data = require('../data');
const { log } = require('../logger');
const asyncHandler = require('../utils/async-handler');
const { executeSchedulingScript } = require('../services/scheduler');
const { auditScheduledIntegration } = require('../middleware/audit');

const router = express.Router();

const SCHEDULED_EXPORT_HEADERS = [
  'Schedule ID',
  'Scheduled For',
  'Integration Name',
  'Event Type',
  'Status',
  'Target URL',
  'HTTP Method',
  'Original Event ID',
  'Delivery Log ID',
  'Recurring Occurrence',
  'Error Message',
  'Created At',
  'Updated At',
];

const escapeCsvCell = (value) => {
  if (value == null) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  text = text.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
  if (/^[\t ]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[,"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const writeWithBackpressure = (res, chunk) =>
  new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      res.off('error', onError);
      res.off('drain', onDrain);
      res.off('close', onClose);
    };

    res.once('error', onError);
    res.once('close', onClose);
    if (res.write(chunk)) {
      cleanup();
      resolve(true);
      return;
    }
    res.once('drain', onDrain);
  });

const recurringOccurrenceLabel = (recurringConfig) => {
  if (!recurringConfig) return '';
  const occurrence = recurringConfig.occurrenceNumber;
  const max = recurringConfig.maxOccurrences;
  if (occurrence != null && max != null) return `${occurrence} of ${max}`;
  return occurrence != null ? String(occurrence) : '';
};

/**
 * GET /api/v1/scheduled-integrations/export
 * Streams all historical rows matching the requested filters; it never exports
 * only the operational page currently held in the browser.
 */
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const filters = {
      status: req.query.status,
      integrationConfigId: req.query.integrationConfigId,
      eventType: req.query.eventType,
    };
    let aborted = false;
    const markAborted = () => {
      aborted = true;
    };
    req.on('close', markAborted);
    req.on('aborted', markAborted);

    const filename = `scheduled-deliveries-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Transfer-Encoding', 'chunked');
    const headerWritten = await writeWithBackpressure(res, `${SCHEDULED_EXPORT_HEADERS.map(escapeCsvCell).join(',')}\r\n`);
    if (!headerWritten) return;

    let exported = 0;
    await data.streamScheduledIntegrationsForExport(
      req.orgId,
      filters,
      async (scheduledIntegration) => {
        if (aborted) return;
        const row = [
          scheduledIntegration.id,
          scheduledIntegration.scheduledFor,
          scheduledIntegration.integrationName,
          scheduledIntegration.eventType,
          scheduledIntegration.status,
          scheduledIntegration.targetUrl,
          scheduledIntegration.httpMethod,
          scheduledIntegration.originalEventId,
          scheduledIntegration.deliveryLogId,
          recurringOccurrenceLabel(scheduledIntegration.recurringConfig),
          scheduledIntegration.errorMessage,
          scheduledIntegration.createdAt,
          scheduledIntegration.updatedAt,
        ];
        const rowWritten = await writeWithBackpressure(res, `${row.map(escapeCsvCell).join(',')}\r\n`);
        if (!rowWritten) {
          aborted = true;
          return;
        }
        exported += 1;
      },
      { shouldStop: () => aborted }
    );

    if (!aborted) {
      res.end();
      log('info', 'Scheduled deliveries exported', { orgId: req.orgId, exported, filters });
    }
  })
);

/**
 * GET /api/v1/scheduled-integrations
 * List scheduled integrations with optional filters
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = {
      status: req.query.status, // PENDING | SENT | FAILED | CANCELLED | OVERDUE
      integrationConfigId: req.query.integrationConfigId,
      eventType: req.query.eventType,
      limit: parseInt(req.query.limit, 10) || 500,
    };

    const scheduledIntegrations = await data.listScheduledIntegrations(req.orgId, filters);

    log('info', 'Listed scheduled integrations', {
      orgId: req.orgId,
      count: scheduledIntegrations.length,
      filters,
    });

    res.json({ scheduledIntegrations });
  })
);

/**
 * GET /api/v1/scheduled-integrations/stats
 * Get status counts for stats cards (not affected by status filter)
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const filters = {
      integrationConfigId: req.query.integrationConfigId,
      eventType: req.query.eventType,
    };

    const stats = await data.getScheduledIntegrationsStats(req.orgId, filters);

    res.json({ stats });
  })
);

/**
 * POST /api/v1/scheduled-integrations/validate
 * Validate a scheduling script without saving
 */
router.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const { script, deliveryMode, timezone = 'UTC', eventType } = req.body;

    if (!script) {
      return res.status(400).json({
        success: false,
        error: 'Script is required',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!deliveryMode || !['DELAYED', 'RECURRING'].includes(deliveryMode)) {
      return res.status(400).json({
        success: false,
        error: 'deliveryMode must be DELAYED or RECURRING',
        code: 'VALIDATION_ERROR',
      });
    }

    // Get event-specific sample payload if eventType is provided
    let mockEvent = null;
    if (eventType) {
      const eventTypeSample = await data.getEventTypeSamplePayload(eventType);
      if (eventTypeSample) {
        mockEvent = {
          ...eventTypeSample,
          sample: true,
          testMode: true,
          timestamp: eventTypeSample.timestamp || new Date().toISOString(),
          createdAt: eventTypeSample.createdAt || new Date().toISOString(),
        };
        log('info', 'Using event-specific sample payload for validation', { eventType });
      }
    }

    // Fallback to generic appointment-based sample if no event-specific sample found
    if (!mockEvent) {
      const futureApptTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days from now
      mockEvent = {
        sample: true,
        testMode: true,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        arrivedAt: new Date().toISOString(),
        // Generic appointment data (for templates when event type is unknown)
        appt: {
          apptDate: futureApptTime.toISOString().split('T')[0],
          fromDate: futureApptTime.toISOString().split('T')[0],
          apptTime: '14:00:00',
          fromTime: '14:00:00',
          patientName: 'Test Patient',
          reasonForVisit: 'new consult',
        },
        patient: {
          fullName: 'Test Patient',
          phone: '9876543210',
          uhid: 'TEST_UHID_001',
        },
        appointmentDateTime: futureApptTime.toISOString(),
        patientRid: 12345,
        eventType: 'TEST_EVENT',
        patientName: 'Test Patient',
      };
      log('debug', 'Using generic appointment sample payload for validation', { eventType });
    }

    try {
      const result = await executeSchedulingScript(script, mockEvent, { timezone });

      // Validate result based on delivery mode
      if (deliveryMode === 'DELAYED') {
        if (typeof result !== 'number') {
          return res.status(400).json({
            success: false,
            error: `DELAYED mode must return a number (timestamp). Got: ${typeof result}`,
            code: 'VALIDATION_ERROR',
          });
        }
        const isOverdue = result <= Date.now();

        log('info', 'Scheduling script validated (DELAYED)', {
          orgId: req.orgId,
          scheduledFor: new Date(result).toISOString(),
          isOverdue,
        });

        return res.json({
          success: true,
          message: isOverdue
            ? `Valid DELAYED script. Sample calculation shows scheduled time in the past (would be marked OVERDUE): ${new Date(result).toISOString()}`
            : `Valid DELAYED script. Sample calculation schedules for: ${new Date(result).toISOString()} (actual time depends on real event data)`,
          result: {
            type: 'DELAYED',
            scheduledFor: new Date(result).toISOString(),
            timestamp: result,
            isOverdue,
          },
        });
      }

      if (deliveryMode === 'RECURRING') {
        if (typeof result !== 'object' || result === null) {
          return res.status(400).json({
            success: false,
            error: `RECURRING mode must return an object. Got: ${typeof result}`,
            code: 'VALIDATION_ERROR',
          });
        }
        if (!result.firstOccurrence || typeof result.firstOccurrence !== 'number') {
          return res.status(400).json({
            success: false,
            error: 'RECURRING config missing valid firstOccurrence (number)',
            code: 'VALIDATION_ERROR',
          });
        }
        if (!result.intervalMs || typeof result.intervalMs !== 'number' || result.intervalMs < 60000) {
          return res.status(400).json({
            success: false,
            error: 'RECURRING config missing valid intervalMs (number >= 60000)',
            code: 'VALIDATION_ERROR',
          });
        }
        if (!result.maxOccurrences && !result.endDate) {
          return res.status(400).json({
            success: false,
            error: 'RECURRING config must have either maxOccurrences or endDate',
            code: 'VALIDATION_ERROR',
          });
        }
        if (result.maxOccurrences && (result.maxOccurrences < 2 || result.maxOccurrences > 365)) {
          return res.status(400).json({
            success: false,
            error: 'RECURRING maxOccurrences must be between 2-365',
            code: 'VALIDATION_ERROR',
          });
        }

        log('info', 'Scheduling script validated (RECURRING)', {
          orgId: req.orgId,
          firstOccurrence: new Date(result.firstOccurrence).toISOString(),
          intervalMs: result.intervalMs,
          maxOccurrences: result.maxOccurrences,
        });

        return res.json({
          success: true,
          message: `Valid RECURRING script. Sample calculation - First: ${new Date(result.firstOccurrence).toISOString()}, Interval: ${result.intervalMs}ms, Max: ${result.maxOccurrences || 'until endDate'} (actual times depend on real event data)`,
          result: {
            type: 'RECURRING',
            firstOccurrence: new Date(result.firstOccurrence).toISOString(),
            intervalMs: result.intervalMs,
            maxOccurrences: result.maxOccurrences,
            endDate: result.endDate ? new Date(result.endDate).toISOString() : null,
          },
        });
      }
    } catch (err) {
      log('error', 'Scheduling script validation failed', {
        orgId: req.orgId,
        error: err.message,
      });

      return res.status(400).json({
        success: false,
        error: err.message || 'Script execution failed',
        code: 'SCRIPT_ERROR',
      });
    }
  })
);

/**
 * DELETE /api/v1/scheduled-integrations/bulk
 * Bulk delete/cancel scheduled integrations
 * NOTE: Must be before /:id route to avoid matching "bulk" as an ID
 */
router.delete(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids array is required',
        code: 'VALIDATION_ERROR',
      });
    }

    let deletedCount = 0;
    const failedIds = [];

    for (const id of ids) {
      try {
        const success = await data.deleteScheduledIntegration(req.orgId, id);
        if (success) {
          deletedCount++;
        } else {
          failedIds.push(id);
        }
      } catch (_err) {
        failedIds.push(id);
      }
    }

    log('info', 'Bulk scheduled integrations deletion', {
      orgId: req.orgId,
      total: ids.length,
      deleted: deletedCount,
      failed: failedIds.length,
    });

    const succeededIds = ids.filter((id) => !failedIds.includes(id));
    await auditScheduledIntegration.bulkCancelled(req, succeededIds);

    res.json({
      message: `Successfully deleted ${deletedCount} scheduled integration(s)`,
      deletedCount,
      failedIds,
    });
  })
);

/**
 * PATCH /api/v1/scheduled-integrations/:id
 * Update a scheduled integration (e.g., change scheduled time)
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { scheduledFor } = req.body;

    if (!scheduledFor) {
      return res.status(400).json({
        error: 'scheduledFor is required',
        code: 'VALIDATION_ERROR',
      });
    }

    // Validate scheduledFor is a valid date
    const scheduledForDate = new Date(scheduledFor);
    if (Number.isNaN(scheduledForDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid scheduledFor date',
        code: 'VALIDATION_ERROR',
      });
    }

    const success = await data.updateScheduledIntegration(req.orgId, id, {
      scheduledFor: scheduledForDate,
    });

    if (!success) {
      return res.status(404).json({
        error: 'Scheduled integration not found',
        code: 'NOT_FOUND',
      });
    }

    log('info', 'Scheduled integration updated', {
      orgId: req.orgId,
      scheduledIntegrationId: id,
      scheduledFor: scheduledForDate.toISOString(),
    });

    res.json({
      message: 'Scheduled integration updated successfully',
      scheduledFor: scheduledForDate.toISOString(),
    });
  })
);

/**
 * POST /api/v1/scheduled-integrations/:id/retry
 * Retry a FAILED scheduled integration by rescheduling it to run immediately.
 * Requires a reason string for audit purposes.
 */
router.post(
  '/:id/retry',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      return res.status(400).json({
        error: 'A reason of at least 3 characters is required for retry',
        code: 'VALIDATION_ERROR',
      });
    }

    // Fetch existing record to verify it is FAILED
    const db = await require('../mongodb').getDbSafe();
    if (!db) {
      return res.status(503).json({ error: 'Database unavailable', code: 'DB_UNAVAILABLE' });
    }
    const { ObjectId } = require('mongodb');
    let docId;
    try {
      docId = new ObjectId(id);
    } catch {
      return res.status(400).json({ error: 'Invalid id', code: 'VALIDATION_ERROR' });
    }

    const existing = await db.collection('scheduled_integrations').findOne({
      _id: docId,
      orgId: req.orgId,
    });

    if (!existing) {
      return res.status(404).json({ error: 'Scheduled integration not found', code: 'NOT_FOUND' });
    }

    if (existing.status !== 'FAILED') {
      return res.status(400).json({
        error: `Cannot retry a delivery with status "${existing.status}". Only FAILED deliveries can be retried.`,
        code: 'INVALID_STATUS',
      });
    }

    // Reschedule to 30 seconds from now so it fires on the next worker tick
    const retryAt = new Date(Date.now() + 30_000);

    await db.collection('scheduled_integrations').updateOne(
      { _id: docId },
      {
        $set: {
          status: 'PENDING',
          scheduledFor: retryAt,
          errorMessage: null,
          attemptCount: 0,
          retryReason: reason.trim(),
          retriedAt: new Date(),
          retriedBy: req.user?.id || null,
          updatedAt: new Date(),
        },
      }
    );

    log('info', 'Scheduled integration retried', {
      orgId: req.orgId,
      scheduledIntegrationId: id,
      retryAt: retryAt.toISOString(),
      reason: reason.trim(),
    });

    res.json({
      message: 'Scheduled integration queued for retry',
      scheduledFor: retryAt.toISOString(),
    });
  })
);

/**
 * DELETE /api/v1/scheduled-integrations/:id
 * Cancel a scheduled integration
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const success = await data.deleteScheduledIntegration(req.orgId, id);

    if (!success) {
      return res.status(404).json({
        error: 'Scheduled integration not found',
        code: 'NOT_FOUND',
      });
    }

    log('info', 'Scheduled integration cancelled', {
      orgId: req.orgId,
      scheduledIntegrationId: id,
      reason: reason || null,
    });

    await auditScheduledIntegration.cancelled(req, id);

    res.json({
      message: 'Scheduled integration cancelled successfully',
    });
  })
);

module.exports = router;
