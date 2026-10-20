'use strict';

const { logAudit, ACTION_TYPES, RESOURCE_TYPES } = require('./audit-logger');
const { log } = require('../logger');

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[-_]?key|authorization|bearer|credential|client[-_]?secret|private[-_]?key)/i;

function redactSensitive(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, seen));
  }

  return Object.entries(value).reduce((acc, [key, item]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      acc[key] = '[REDACTED]';
    } else {
      acc[key] = redactSensitive(item, seen);
    }
    return acc;
  }, {});
}

function getClientName(req) {
  return req.get?.('x-mcp-client') || req.get?.('x-client-name') || 'api';
}

async function logMcpAudit(
  req,
  {
    toolName,
    action = ACTION_TYPES.READ,
    resourceType = RESOURCE_TYPES.SYSTEM_CONFIG || 'system_config',
    resourceId = null,
    orgId = req?.orgId || null,
    reason = null,
    arguments: args = null,
    result = null,
    changes = null,
    success = true,
    errorMessage = null,
  } = {}
) {
  try {
    await logAudit({
      action,
      resourceType,
      resourceId,
      user: req?.user || null,
      orgId,
      changes: changes ? redactSensitive(changes) : null,
      metadata: {
        source: 'MCP',
        clientName: getClientName(req),
        toolName,
        reason,
        requestId: req?.id || req?.requestId || null,
        arguments: redactSensitive(args),
        result: redactSensitive(result),
      },
      ipAddress: req?.ip || null,
      userAgent: req?.get?.('user-agent') || null,
      success,
      errorMessage,
    });
  } catch (err) {
    log('warn', 'MCP audit write failed', {
      toolName,
      resourceType,
      resourceId,
      error: err.message,
    });
  }
}

module.exports = {
  redactSensitive,
  logMcpAudit,
};
