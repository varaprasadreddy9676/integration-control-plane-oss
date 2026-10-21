'use strict';

const express = require('express');
const asyncHandler = require('../utils/async-handler');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/errors');
const data = require('../data');
const dlqData = require('../data/dlq');
const { getDbSafe } = require('../mongodb');
const { replayEvent } = require('../processor/retry-handler');
const { applyTransform } = require('../services/transformer');
const { logMcpAudit } = require('../services/mcp-audit');
const { ACTION_TYPES, RESOURCE_TYPES } = require('../services/audit-logger');
const { requirePermission } = require('../middleware/permission');
const { resolveScopedOrgId } = require('../utils/org-context');
const { maskLogResponses } = require('../middleware/mask-log-responses');

const router = express.Router();
router.use(maskLogResponses);

function parseOrgId(req) {
  // Org-bound callers may only act on their own org, even if the body names another.
  return resolveScopedOrgId(req, req.body?.orgId ?? req.query.orgId);
}

function requireReason(req) {
  const reason = String(req.body?.reason || req.query.reason || '').trim();
  if (!reason) {
    throw new ValidationError('reason is required for ops mutations');
  }
  return reason;
}

async function getScopedIntegration(orgId, integrationId) {
  const integration = await data.getIntegration(integrationId);
  if (!integration) throw new NotFoundError('Integration not found');
  if (Number(integration.orgId) !== Number(orgId)) {
    throw new ForbiddenError('Integration does not belong to this organization');
  }
  return integration;
}

function buildDateWindow(hours = 24) {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000);
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
}

async function getRecentFailureSummary(orgId, filters = {}) {
  const page = await data.getLogsPage(orgId, {
    ...filters,
    status: 'FAILED,ABANDONED',
    page: 1,
    limit: filters.limit || 10,
  });
  return {
    total: page.pagination?.total || 0,
    logs: page.data || [],
  };
}

router.get(
  '/integration-status/:integrationId',
  requirePermission('ops:read'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const integration = await getScopedIntegration(orgId, req.params.integrationId);
    const [circuit, failures, dlqStats] = await Promise.all([
      data.checkCircuitState(req.params.integrationId),
      getRecentFailureSummary(orgId, {
        integrationConfigId: req.params.integrationId,
        ...buildDateWindow(24),
        limit: 5,
      }),
      dlqData.getDLQStats(orgId, { integrationConfigId: req.params.integrationId }),
    ]);

    const response = {
      integration: {
        id: integration.id || integration._id?.toString?.() || req.params.integrationId,
        name: integration.name,
        type: integration.type,
        direction: integration.direction,
        isActive: integration.isActive,
        orgId: integration.orgId,
      },
      circuit,
      recentFailures: failures,
      dlq: dlqStats,
    };

    await logMcpAudit(req, {
      toolName: 'get_integration_status',
      action: ACTION_TYPES.READ,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: req.params.integrationId,
      orgId,
      arguments: req.query,
      result: { failureCount: failures.total, circuitState: circuit.state },
    });

    res.json({ success: true, data: response });
  })
);

router.get(
  '/org-diagnosis',
  requirePermission('ops:read'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const hours = Math.min(Math.max(Number.parseInt(req.query.hours, 10) || 24, 1), 168);
    const window = buildDateWindow(hours);
    const [failures, dlqStats, checkpoints, auditStats] = await Promise.all([
      getRecentFailureSummary(orgId, { ...window, limit: 20 }),
      dlqData.getDLQStats(orgId, window),
      data.getSourceCheckpoints(orgId).catch(() => []),
      data.getEventAuditStats(orgId, window).catch(() => null),
    ]);

    const response = {
      orgId,
      window,
      failures,
      dlq: dlqStats,
      sourceCheckpoints: checkpoints,
      eventAudit: auditStats,
      generatedAt: new Date().toISOString(),
    };

    await logMcpAudit(req, {
      toolName: 'diagnose_org_failures',
      action: ACTION_TYPES.READ,
      resourceType: RESOURCE_TYPES.ORGANIZATION,
      resourceId: orgId,
      orgId,
      arguments: req.query,
      result: { failureCount: failures.total },
    });

    res.json({ success: true, data: response });
  })
);

router.post(
  '/circuit-breaker/:integrationId/reset',
  requirePermission('ops:circuit_reset'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const reason = requireReason(req);
    await getScopedIntegration(orgId, req.params.integrationId);
    const result = await data.resetCircuitState(req.params.integrationId, {
      reason,
      userId: req.user?.id || req.user?._id || null,
    });
    if (!result) throw new NotFoundError('Integration not found');

    await logMcpAudit(req, {
      toolName: 'reset_circuit_breaker',
      action: ACTION_TYPES.UPDATE,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: req.params.integrationId,
      orgId,
      reason,
      arguments: req.body,
      changes: { before: result.before, after: result.after },
      result: { modifiedCount: result.modifiedCount },
    });

    res.json({ success: true, data: result });
  })
);

router.post(
  '/logs/:logId/replay',
  requirePermission('ops:replay'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const reason = requireReason(req);
    const result = await replayEvent(req.params.logId, orgId, {
      userId: req.user?.id || req.user?._id || null,
      source: 'ops_api',
      reason,
    });
    await logMcpAudit(req, {
      toolName: 'replay_delivery_log',
      action: ACTION_TYPES.UPDATE,
      resourceType: RESOURCE_TYPES.INTEGRATION,
      resourceId: req.params.logId,
      orgId,
      reason,
      arguments: req.body,
      result,
    });
    res.json({ success: true, data: result });
  })
);

router.post(
  '/test-run',
  requirePermission('ops:test'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const reason = requireReason(req);
    const type = String(req.body?.type || '').toUpperCase();
    const runId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const steps = [];

    if (type === 'INTEGRATION_HEALTH') {
      if (!req.body.integrationId) throw new ValidationError('integrationId is required');
      const integration = await getScopedIntegration(orgId, req.body.integrationId);
      const circuit = await data.checkCircuitState(req.body.integrationId);
      const failures = await getRecentFailureSummary(orgId, {
        integrationConfigId: req.body.integrationId,
        ...buildDateWindow(24),
        limit: 5,
      });
      steps.push({ name: 'load_integration', status: 'PASSED' });
      steps.push({ name: 'check_circuit', status: circuit.isOpen ? 'FAILED' : 'PASSED', data: circuit });
      steps.push({ name: 'recent_failures', status: failures.total > 0 ? 'WARNING' : 'PASSED', data: failures });

      const response = {
        id: runId,
        type,
        status: steps.some((step) => step.status === 'FAILED') ? 'FAILED' : 'PASSED',
        integration: { id: integration.id || req.body.integrationId, name: integration.name },
        steps,
      };
      await logMcpAudit(req, {
        toolName: 'run_integration_test',
        action: ACTION_TYPES.INTEGRATION_EXECUTED,
        resourceType: RESOURCE_TYPES.INTEGRATION,
        resourceId: req.body.integrationId,
        orgId,
        reason,
        arguments: req.body,
        result: { id: response.id, status: response.status },
      });
      return res.json({ success: true, data: response });
    }

    if (type === 'TRANSFORM') {
      if (!req.body.integrationId) throw new ValidationError('integrationId is required');
      const integration = await getScopedIntegration(orgId, req.body.integrationId);
      const output = await applyTransform(integration, req.body.payload || {}, {
        orgId,
        reason,
        testRun: true,
      });
      const response = {
        id: runId,
        type,
        status: 'PASSED',
        steps: [{ name: 'apply_transform', status: 'PASSED' }],
        output,
      };
      await logMcpAudit(req, {
        toolName: 'run_transform_test',
        action: ACTION_TYPES.INTEGRATION_EXECUTED,
        resourceType: RESOURCE_TYPES.INTEGRATION,
        resourceId: req.body.integrationId,
        orgId,
        reason,
        arguments: req.body,
        result: { id: response.id, status: response.status },
      });
      return res.json({ success: true, data: response });
    }

    throw new ValidationError('Unsupported test-run type');
  })
);

// GET /ops/audit-trail — query recent MCP audit logs for an org
router.get(
  '/audit-trail',
  requirePermission('ops:read'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 7, 1), 90);
    const toolName = req.query.toolName ? String(req.query.toolName).trim() : undefined;
    const source = req.query.source ? String(req.query.source).trim() : undefined;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const query = {
      orgId,
      createdAt: { $gte: since },
    };
    if (toolName) query['metadata.toolName'] = toolName;
    if (source) query['metadata.source'] = source;

    const db = await getDbSafe();
    const [logs, total] = await Promise.all([
      db.collection('audit_logs').find(query).sort({ createdAt: -1 }).limit(limit).toArray(),
      db.collection('audit_logs').countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        orgId,
        days,
        total,
        logs: logs.map((l) => ({
          id: l._id?.toString(),
          action: l.action,
          resourceType: l.resourceType,
          resourceId: l.resourceId,
          success: l.success,
          toolName: l.metadata?.toolName,
          source: l.metadata?.source,
          reason: l.metadata?.reason,
          clientName: l.metadata?.clientName,
          user: l.user ? { id: l.user.id || l.user._id?.toString(), email: l.user.email, role: l.user.role } : null,
          createdAt: l.createdAt,
        })),
      },
    });
  })
);

module.exports = router;
