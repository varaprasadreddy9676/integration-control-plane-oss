'use strict';

const express = require('express');
const asyncHandler = require('../utils/async-handler');
const { ValidationError, NotFoundError } = require('../utils/errors');
const credentialData = require('../data/credentials');
const { logMcpAudit } = require('../services/mcp-audit');
const { ACTION_TYPES, RESOURCE_TYPES } = require('../services/audit-logger');
const { requirePermission } = require('../middleware/permission');
const { resolveScopedOrgId } = require('../utils/org-context');

const router = express.Router();

function parseOrgId(req) {
  // Org-bound callers may only act on their own org, even if the body names another.
  return resolveScopedOrgId(req, req.body?.orgId ?? req.query.orgId);
}

function requireReason(req) {
  const reason = String(req.body?.reason || req.query.reason || '').trim();
  if (!reason) {
    throw new ValidationError('reason is required for credential mutations');
  }
  return reason;
}

router.get(
  '/',
  requirePermission('credentials:view'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const data = await credentialData.listCredentialPlaceholders(orgId, req.query);
    await logMcpAudit(req, {
      toolName: 'list_credential_placeholders',
      action: ACTION_TYPES.READ,
      resourceType: RESOURCE_TYPES.CONFIG,
      orgId,
      arguments: req.query,
      result: { count: data.length },
    });
    res.json({ success: true, data });
  })
);

router.post(
  '/placeholders',
  requirePermission('credentials:manage'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const reason = requireReason(req);
    try {
      const data = await credentialData.createCredentialPlaceholder(orgId, req.body, {
        userId: req.user?.id || req.user?._id || null,
      });
      await logMcpAudit(req, {
        toolName: 'create_credential_placeholder',
        action: ACTION_TYPES.CREATE,
        resourceType: RESOURCE_TYPES.CONFIG,
        resourceId: data.id,
        orgId,
        reason,
        arguments: req.body,
        result: { id: data.id, status: data.status },
      });
      res.status(201).json({ success: true, data });
    } catch (err) {
      throw new ValidationError(err.message);
    }
  })
);

router.get(
  '/:placeholderId/status',
  requirePermission('credentials:view'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const data = await credentialData.getCredentialPlaceholder(orgId, req.params.placeholderId);
    if (!data) throw new NotFoundError('Credential placeholder not found');
    await logMcpAudit(req, {
      toolName: 'get_credential_placeholder_status',
      action: ACTION_TYPES.READ,
      resourceType: RESOURCE_TYPES.CONFIG,
      resourceId: req.params.placeholderId,
      orgId,
    });
    res.json({ success: true, data });
  })
);

router.post(
  '/:placeholderId/values',
  requirePermission('credentials:manage'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const reason = requireReason(req);
    if (!req.body?.values || typeof req.body.values !== 'object' || Array.isArray(req.body.values)) {
      throw new ValidationError('values object is required');
    }
    const data = await credentialData.setCredentialValues(orgId, req.params.placeholderId, req.body.values, {
      userId: req.user?.id || req.user?._id || null,
    });
    if (!data) throw new NotFoundError('Credential placeholder not found');
    await logMcpAudit(req, {
      toolName: 'set_credential_values',
      action: ACTION_TYPES.UPDATE,
      resourceType: RESOURCE_TYPES.CONFIG,
      resourceId: req.params.placeholderId,
      orgId,
      reason,
      arguments: req.body,
      result: { id: data.id, status: data.status },
    });
    res.json({ success: true, data });
  })
);

router.post(
  '/:placeholderId/test',
  requirePermission('credentials:manage'),
  asyncHandler(async (req, res) => {
    const orgId = parseOrgId(req);
    const reason = requireReason(req);
    const placeholder = await credentialData.getCredentialPlaceholder(orgId, req.params.placeholderId);
    if (!placeholder) throw new NotFoundError('Credential placeholder not found');
    const missing = (placeholder.fields || []).filter((field) => field.required !== false && field.status !== 'PROVIDED');
    const data = await credentialData.updateCredentialTestStatus(orgId, req.params.placeholderId, {
      success: missing.length === 0,
      message: missing.length === 0 ? 'Credential fields are present' : `Missing required fields: ${missing.map((f) => f.key).join(', ')}`,
    });
    await logMcpAudit(req, {
      toolName: 'test_credential_placeholder',
      action: ACTION_TYPES.UPDATE,
      resourceType: RESOURCE_TYPES.CONFIG,
      resourceId: req.params.placeholderId,
      orgId,
      reason,
      arguments: req.body,
      result: { id: data.id, status: data.status, testStatus: data.testStatus },
    });
    res.json({ success: true, data });
  })
);

module.exports = router;
