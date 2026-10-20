import { z } from 'zod';
import { createIssueReporterFromEnv } from './issue-reporter.js';
import { registerContext } from './context.js';

// ─── Shared schema fragments ──────────────────────────────────────────────────

const orgId = z.number().int().positive().describe('Organization ID');
const reason = z
  .string()
  .min(5)
  .describe('Operational reason — recorded in audit logs. Required for all mutations.');

/**
 * Serialize any value to a JSON text content block.
 * All tool handlers return this shape; MCP clients render the text.
 */
function jsonContent(data) {
  const structuredContent = data && typeof data === 'object' && !Array.isArray(data) ? data : { result: data };
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent,
  };
}

/**
 * Wrap a tool handler so API errors are returned as readable content
 * rather than crashing the MCP session. Logs each call (name, duration,
 * outcome) to stderr for local operational visibility — never to stdout,
 * which is the MCP protocol channel.
 */
function safe(name, handler) {
  return async (args) => {
    const startedAt = Date.now();
    try {
      const result = await handler(args);
      process.stderr.write(`[icp-mcp] ${name} ok (${Date.now() - startedAt}ms)\n`);
      return result;
    } catch (err) {
      process.stderr.write(
        `[icp-mcp] ${name} failed (${Date.now() - startedAt}ms) status=${err.status ?? 'UNKNOWN'}: ${err.message}\n`
      );
      const detail = err.payload ?? {};
      return {
        isError: true,
        ...jsonContent({
        error: true,
        status: err.status ?? 'UNKNOWN',
        message: err.message,
        detail,
        requestId: err.requestId ?? null,
        }),
      };
    }
  };
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerTools(server, client, { issueReporter = createIssueReporterFromEnv() } = {}) {
  registerContext(server);

  // ── Discovery ────────────────────────────────────────────────────────────────

  server.tool(
    'gateway_health',
    `Read the gateway and worker health state for the configured environment.
Permission: system:health
Use this as the first connection and environment check. It does not require an orgId and never mutates data.
auth.ok is false when the gateway rejects the configured API key — fix that before calling other tools.

Example response shape: { _env, _baseUrl, auth: { ok }, status, workers, mysql, timestamp }`,
    {},
    safe('gateway_health', async () => {
      const [health, auth] = await Promise.all([client.getGatewayHealth(), client.checkCredentials()]);
      return jsonContent({ auth, ...health });
    })
  );

  server.tool(
    'list_integrations',
    `List integrations for an organization.
Permission: ops:read
Use this first to discover integration IDs before calling get_integration_status or run_integration_test.

Example prompt: "List all active integrations for org 892"
Example response shape: { _env, data: [{ id, name, type, direction, isActive }] }`,
    {
      orgId,
      type: z.string().optional().describe('Filter by integration type (e.g. HTTP_PUSH)'),
      isActive: z.boolean().optional().describe('Filter by active state'),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    safe('list_integrations', async (args) => jsonContent(await client.listIntegrations(args)))
  );

  // ── Diagnosis ────────────────────────────────────────────────────────────────

  server.tool(
    'diagnose_org',
    `Summarize recent failures, DLQ state, source checkpoints, and event audit health for an organization.
Permission: ops:read
Use when an org is reporting delivery problems or you need a health overview.

Example prompt: "Why is org 892 failing deliveries in the last 6 hours?"
Example response shape: { _env, orgId, window, failures, dlq, sourceCheckpoints, eventAudit }`,
    {
      orgId,
      hours: z
        .number()
        .int()
        .min(1)
        .max(168)
        .optional()
        .describe('Lookback window in hours (default 24, max 168)'),
    },
    safe('diagnose_org', async (args) => jsonContent(await client.diagnoseOrgFailures(args)))
  );

  server.tool(
    'get_integration_status',
    `Inspect one integration: active state, circuit breaker state, recent failures (24 h), and DLQ summary.
Permission: ops:read
Requires integrationId — use list_integrations to discover IDs.

Example prompt: "What is the circuit breaker state for integration abc123 in org 892?"
Example response shape: { _env, integration, circuit, recentFailures, dlq }`,
    {
      orgId,
      integrationId: z.string().min(1).describe('Integration config ID (MongoDB ObjectId string)'),
    },
    safe('get_integration_status', async (args) => jsonContent(await client.getIntegrationStatus(args)))
  );

  // ── Delivery logs ─────────────────────────────────────────────────────────────

  server.tool(
    'search_delivery_logs',
    `Search delivery logs by org, status, event type, integration, date window, or keyword.
Permission: ops:read

Example prompt: "Show me the last 10 FAILED deliveries for org 892 today"
Example response shape: { _env, data: [...logs], pagination }`,
    {
      orgId,
      status: z.string().optional().describe('DELIVERED | FAILED | ABANDONED | RETRYING'),
      eventType: z.string().optional(),
      integrationConfigId: z.string().optional(),
      search: z.string().optional(),
      startDate: z.string().optional().describe('ISO 8601 date string'),
      endDate: z.string().optional().describe('ISO 8601 date string'),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    safe('search_delivery_logs', async (args) => jsonContent(await client.searchDeliveryLogs(args)))
  );

  server.tool(
    'get_execution_trace',
    `Fetch one delivery log with the full request, response, and retry attempt details.
Permission: ops:read
Use logId from search_delivery_logs results.

Example prompt: "Show me the full trace for log 6849a1f2..."
Example response shape: { _env, ...logDocument }`,
    {
      orgId,
      logId: z.string().min(1).describe('Delivery log ID'),
    },
    safe('get_execution_trace', async (args) => jsonContent(await client.getExecutionTrace(args)))
  );

  // ── Mutations ─────────────────────────────────────────────────────────────────

  server.tool(
    'reset_circuit_breaker',
    `Reset an integration circuit breaker from OPEN to CLOSED.
Permission: ops:circuit_reset
Requires: reason (min 5 chars) — recorded in audit log.
⚠️  PRODUCTION MUTATION — always confirm environment and provide a clear reason before calling.

Example prompt: "Reset the circuit breaker for integration abc123 org 892 — reason: 'upstream resolved at 14:05'"
Example response shape: { _env, modifiedCount, before, after }`,
    { orgId, integrationId: z.string().min(1), reason },
    safe('reset_circuit_breaker', async (args) => jsonContent(await client.resetCircuitBreaker(args)))
  );

  server.tool(
    'replay_delivery',
    `Replay a failed or abandoned delivery log through the backend retry handler.
Permission: ops:replay
Requires: reason (min 5 chars) — recorded in audit log.
⚠️  PRODUCTION MUTATION — always confirm the log ID and environment before calling.

Example prompt: "Replay delivery 6849a1f2 for org 892 — reason: 'circuit reset, safe to retry'"
Example response shape: { _env, replayedId, newStatus }`,
    { orgId, logId: z.string().min(1), reason },
    safe('replay_delivery', async (args) => jsonContent(await client.replayDeliveryLog(args)))
  );

  server.tool(
    'run_integration_test',
    `Run a safe integration health check or transform test without changing configuration.
Permission: ops:test
Requires: reason (min 5 chars) — recorded in audit log.
type=INTEGRATION_HEALTH checks circuit state and recent failures.
type=TRANSFORM runs the transformer script against a sample payload.

Example prompt: "Test health of integration abc123 org 892 after the circuit reset"
Example response shape: { _env, id, type, status, steps }`,
    {
      orgId,
      integrationId: z.string().min(1),
      type: z.enum(['INTEGRATION_HEALTH', 'TRANSFORM']),
      payload: z.record(z.any()).optional().describe('Sample payload for TRANSFORM tests'),
      reason,
    },
    safe('run_integration_test', async (args) => jsonContent(await client.runTest(args)))
  );

  // ── Credentials ───────────────────────────────────────────────────────────────

  server.tool(
    'list_credentials',
    `List credential placeholders and masked completion status for an organization.
Permission: ops:read
Secret values are never returned — only field presence and status.

Example prompt: "Which credentials are still pending for org 892 in production?"
Example response shape: { _env, data: [{ id, provider, name, environment, status, fields }] }`,
    {
      orgId,
      provider: z.string().optional(),
      environment: z.enum(['validation', 'production']).optional(),
      status: z.enum(['PENDING', 'PROVIDED', 'TESTED', 'FAILED']).optional(),
    },
    safe('list_credentials', async (args) => jsonContent(await client.listCredentialPlaceholders(args)))
  );

  server.tool(
    'set_credential_value',
    `Set credential field values for a placeholder. Values are stored encrypted; only masked status is returned.
Permission: ops:credentials (SUPER_ADMIN)
Requires: reason (min 5 chars) — recorded in audit log.
⚠️  Never log or display the values field after calling — treat it as write-only.

Example prompt: "Set the API key for credential placeholder xyz789 org 892"
Example response shape: { _env, placeholderId, status, maskedFields }`,
    {
      orgId,
      placeholderId: z.string().min(1),
      values: z.record(z.string()).describe('Map of field key → secret value. Never echoed back.'),
      reason,
    },
    safe('set_credential_value', async (args) => jsonContent(await client.setCredentialValues(args)))
  );

  server.tool(
    'test_credential',
    `Validate that required credential fields have been supplied for a placeholder.
Permission: ops:read
Does NOT make live API calls — only checks field presence and status.
Requires: reason (min 5 chars) — recorded in audit log.

Example prompt: "Check if credentials are complete for placeholder xyz789 org 892"
Example response shape: { _env, placeholderId, status, missingFields }`,
    { orgId, placeholderId: z.string().min(1), reason },
    safe('test_credential', async (args) => jsonContent(await client.testCredentialPlaceholder(args)))
  );

  // ── Audit trail ───────────────────────────────────────────────────────────────

  server.tool(
    'check_audit_trail',
    `Query recent audit log entries for an organization.
Permission: ops:read
Filters by MCP tool calls by default. Use toolName or source to narrow results.

Example prompt: "Show me all circuit-breaker resets for org 892 in the last 3 days"
Example response shape: { _env, orgId, days, total, logs: [{ action, toolName, reason, user, createdAt }] }`,
    {
      orgId,
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe('Lookback window in days (default 7, max 90)'),
      toolName: z
        .string()
        .optional()
        .describe('Filter by MCP tool name, e.g. reset_circuit_breaker'),
      source: z.string().optional().describe('Filter by source (e.g. MCP)'),
      limit: z.number().int().min(1).max(200).optional(),
    },
    safe('check_audit_trail', async (args) => jsonContent(await client.checkAuditTrail(args)))
  );

  // ── Outbound integrations (event rules) ─────────────────────────────────────
  // NOTE: the backend's outbound-integrations routes currently enforce only
  // `auth`, not a `requirePermission()` check — any authenticated API key can
  // write here today. Treat the "Permission:" lines below as the *intended*
  // RBAC scope (see backend rbac/permissions.js's integration:* family), not
  // an enforced guarantee — flag this to the backend team if that matters for
  // your deployment.

  const integrationId = z.string().min(1).describe('Integration config ID (MongoDB ObjectId string)');

  server.tool(
    'list_outbound_integrations',
    `List outbound integrations (event rules) for the caller's org scope.
Permission (intended): integration:view
Lighter payload than get_outbound_integration — auth configs, scripts, and signing secrets are omitted.

Example prompt: "List all outbound integrations for org 892"
Example response shape: { _env, data: [{ id, name, eventType, targetUrl, isActive, direction }] }`,
    { orgId },
    safe('list_outbound_integrations', async (args) => jsonContent(await client.listOutboundIntegrations(args)))
  );

  server.tool(
    'list_event_types',
    `List all event types available to trigger an outbound integration.
Permission (intended): integration:view
Use before create_outbound_integration to pick a valid eventType.

Example response shape: { _env, eventTypes: [...] }`,
    {},
    safe('list_event_types', async () => jsonContent(await client.listEventTypes()))
  );

  server.tool(
    'get_outbound_integration',
    `Fetch the full configuration of one outbound integration, including auth, transformation script, retry policy, and lookups.
Permission (intended): integration:view

Example response shape: { _env, id, name, eventType, targetUrl, httpMethod, scope, outgoingAuthType, transformationMode, transformation, retryCount, timeoutMs, ... }`,
    { orgId, integrationId },
    safe('get_outbound_integration', async (args) => jsonContent(await client.getOutboundIntegration(args)))
  );

  server.tool(
    'create_outbound_integration',
    `Create a new outbound integration (event rule) — fires an HTTP call to targetUrl when eventType occurs.
Permission (intended): integration:create
⚠️  WRITE OPERATION. Validate with validate_outbound_transformation first if using a custom transformation script.

Required: name, eventType, targetUrl, httpMethod, scope ('ENTITY_ONLY' | 'INCLUDE_CHILDREN'), outgoingAuthType, timeoutMs, retryCount.
Optional: transformationMode ('SCRIPT' | 'MAPPING' | 'NONE'), transformation ({ script } or { mappings, staticFields }),
lookups (array), excludedOrgUnits (array, only valid when scope='INCLUDE_CHILDREN'), actions (array, for multi-action
integrations — each needs its own targetUrl or falls back to the top-level one).
Do NOT send entityRid — use orgUnitRid instead (entityRid is rejected).

Example prompt: "Create an outbound integration named 'Lab Result Webhook' for eventType LAB_RESULT_READY, POST to https://partner.example.com/webhook, ENTITY_ONLY scope, no auth, 10s timeout, 3 retries"
Example response shape: { _env, id, name, eventType, targetUrl, ... } (full created document)`,
    {
      orgId,
      name: z.string().min(1),
      eventType: z.string().min(1).describe('Event type this integration fires on — see list_event_types'),
      targetUrl: z.string().min(1),
      httpMethod: z.string().describe('e.g. POST, PUT, PATCH'),
      scope: z.enum(['ENTITY_ONLY', 'INCLUDE_CHILDREN']),
      outgoingAuthType: z.string().describe('e.g. NONE, API_KEY, BASIC, BEARER, OAUTH2, CUSTOM, HMAC'),
      outgoingAuthConfig: z.record(z.any()).optional(),
      timeoutMs: z.number().int().positive(),
      retryCount: z.number().int().min(0),
      transformationMode: z.enum(['SCRIPT', 'MAPPING', 'NONE']).optional(),
      transformation: z
        .record(z.any())
        .optional()
        .describe('{ script } for SCRIPT mode, or { mappings, staticFields } for MAPPING mode'),
      lookups: z.array(z.record(z.any())).optional(),
      excludedOrgUnits: z.array(z.string()).optional().describe('Only valid when scope=INCLUDE_CHILDREN'),
      actions: z
        .array(z.record(z.any()))
        .optional()
        .describe('Multi-action integrations — each action needs its own targetUrl or inherits the top-level one'),
      isActive: z.boolean().optional(),
    },
    safe('create_outbound_integration', async (args) => jsonContent(await client.createOutboundIntegration(args)))
  );

  server.tool(
    'update_outbound_integration',
    `Update an existing outbound integration. Partial update — only send fields you want to change.
Permission (intended): integration:edit
⚠️  WRITE OPERATION — affects live event delivery immediately.
Same validation as create_outbound_integration. Do NOT send entityRid.

Example response shape: { _env, id, name, ... } (full updated document)`,
    {
      orgId,
      integrationId,
      name: z.string().min(1).optional(),
      eventType: z.string().min(1).optional(),
      targetUrl: z.string().min(1).optional(),
      httpMethod: z.string().optional(),
      scope: z.enum(['ENTITY_ONLY', 'INCLUDE_CHILDREN']).optional(),
      outgoingAuthType: z.string().optional(),
      outgoingAuthConfig: z.record(z.any()).optional(),
      timeoutMs: z.number().int().positive().optional(),
      retryCount: z.number().int().min(0).optional(),
      transformationMode: z.enum(['SCRIPT', 'MAPPING', 'NONE']).optional(),
      transformation: z.record(z.any()).optional(),
      lookups: z.array(z.record(z.any())).optional(),
      excludedOrgUnits: z.array(z.string()).optional(),
      actions: z.array(z.record(z.any())).optional(),
      isActive: z.boolean().optional(),
    },
    safe('update_outbound_integration', async (args) => jsonContent(await client.updateOutboundIntegration(args)))
  );

  server.tool(
    'delete_outbound_integration',
    `Permanently delete an outbound integration.
Permission (intended): integration:delete
⚠️  WRITE OPERATION — irreversible. Stops all future deliveries for this event rule immediately.

Example response shape: { _env, message: 'Integration deleted' }`,
    { orgId, integrationId },
    safe('delete_outbound_integration', async (args) => jsonContent(await client.deleteOutboundIntegration(args)))
  );

  server.tool(
    'duplicate_outbound_integration',
    `Clone an outbound integration as a new, independent copy (name suffixed " (Copy)", active by default).
Permission (intended): integration:create
Useful for creating a near-identical integration for a different event type or target.

Example response shape: { _env, id, name, ... } (full new document)`,
    { orgId, integrationId },
    safe('duplicate_outbound_integration', async (args) => jsonContent(await client.duplicateOutboundIntegration(args)))
  );

  server.tool(
    'test_outbound_integration',
    `Send a REAL live test delivery for an outbound integration and record it as a delivery log.
Permission (intended): integration:test
⚠️  This is NOT a dry run — it makes an actual HTTP call to targetUrl with real auth headers.
Use validate_outbound_transformation instead if you only want to check the transformation script.

Example response shape: { _env, id, status: 'success'|'failed'|'skipped', responseStatus, responseBody, responseTimeMs }`,
    {
      orgId,
      integrationId,
      payload: z.record(z.any()).optional().describe('Custom test payload — defaults to a sample payload'),
    },
    safe('test_outbound_integration', async (args) => jsonContent(await client.testOutboundIntegration(args)))
  );

  server.tool(
    'validate_outbound_transformation',
    `Dry-run a transformation script against a sample payload WITHOUT saving or sending anything.
Permission (intended): integration:test
Use this before create_outbound_integration/update_outbound_integration when authoring a SCRIPT transformation.

Example response shape: { _env, success, message, result: { input, output, skipped, skipReason } }`,
    {
      script: z.string().min(1).describe('The transformation script to validate'),
      samplePayload: z.record(z.any()).optional(),
    },
    safe('validate_outbound_transformation', async (args) =>
      jsonContent(await client.validateOutboundTransformation(args))
    )
  );

  // ── Inbound integrations ─────────────────────────────────────────────────────

  server.tool(
    'list_inbound_integrations',
    `List inbound integrations (webhook receivers) for the caller's org scope.
Permission (intended): integration:view

Example response shape: { _env, data: [{ id, name, type, targetUrl, isActive }] }`,
    { orgId },
    safe('list_inbound_integrations', async (args) => jsonContent(await client.listInboundIntegrations(args)))
  );

  server.tool(
    'get_inbound_integration',
    `Fetch the full configuration of one inbound integration (webhook receiver).
Permission (intended): integration:view

Example response shape: { _env, id, name, type, inboundAuthType, requestTransformation, responseTransformation, ... }`,
    { orgId, integrationId },
    safe('get_inbound_integration', async (args) => jsonContent(await client.getInboundIntegration(args)))
  );

  server.tool(
    'create_inbound_integration',
    `Create a new inbound integration — a webhook receiver endpoint that accepts incoming requests of the given \`type\`.
Permission (intended): integration:create
⚠️  WRITE OPERATION. \`type\` must be unique per org among inbound integrations (409 if duplicate).

Required: name, type, targetUrl (unless a COMMUNICATION action is supplied instead).
Optional: httpMethod (default POST), inboundAuthType (default NONE — 'HMAC' requires inboundAuthConfig.secret or .secrets[]),
inboundAuthConfig, outgoingAuthType, outgoingAuthConfig, requestTransformation ({ mode: 'SCRIPT', script }),
responseTransformation, timeout (ms, default 10000), retryCount (default 3), contentType (default application/json),
requestPolicy, rateLimits, lookups (array), actions (array — COMMUNICATION-kind actions route to a messaging provider
instead of an HTTP call), isActive (default true).

Example response shape: { _env, id, message } — note: does NOT return the full document, only the new id.`,
    {
      orgId,
      name: z.string().min(1),
      type: z.string().min(1).describe('Unique-per-org identifier this webhook is reachable at'),
      targetUrl: z.string().optional().describe('Required unless a COMMUNICATION action is supplied instead'),
      httpMethod: z.string().optional(),
      inboundAuthType: z.string().optional().describe('e.g. NONE, API_KEY, HMAC, BASIC'),
      inboundAuthConfig: z.record(z.any()).optional(),
      outgoingAuthType: z.string().optional(),
      outgoingAuthConfig: z.record(z.any()).optional(),
      requestTransformation: z.record(z.any()).optional().describe('{ mode: "SCRIPT", script }'),
      responseTransformation: z.record(z.any()).optional(),
      timeout: z.number().int().positive().optional(),
      retryCount: z.number().int().min(0).optional(),
      contentType: z.string().optional(),
      requestPolicy: z.record(z.any()).optional(),
      rateLimits: z.record(z.any()).optional(),
      lookups: z.array(z.record(z.any())).optional(),
      actions: z.array(z.record(z.any())).optional(),
      isActive: z.boolean().optional(),
    },
    safe('create_inbound_integration', async (args) => jsonContent(await client.createInboundIntegration(args)))
  );

  server.tool(
    'update_inbound_integration',
    `Update an existing inbound integration. Partial update — only send fields you want to change.
Permission (intended): integration:edit
⚠️  WRITE OPERATION — affects live webhook receiving immediately. Same validation as create_inbound_integration.

Example response shape: { _env, message } — does NOT return the updated document; use get_inbound_integration to confirm.`,
    {
      orgId,
      integrationId,
      name: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      targetUrl: z.string().optional(),
      httpMethod: z.string().optional(),
      inboundAuthType: z.string().optional(),
      inboundAuthConfig: z.record(z.any()).optional(),
      outgoingAuthType: z.string().optional(),
      outgoingAuthConfig: z.record(z.any()).optional(),
      requestTransformation: z.record(z.any()).optional(),
      responseTransformation: z.record(z.any()).optional(),
      timeout: z.number().int().positive().optional(),
      retryCount: z.number().int().min(0).optional(),
      contentType: z.string().optional(),
      requestPolicy: z.record(z.any()).optional(),
      rateLimits: z.record(z.any()).optional(),
      lookups: z.array(z.record(z.any())).optional(),
      actions: z.array(z.record(z.any())).optional(),
      isActive: z.boolean().optional(),
    },
    safe('update_inbound_integration', async (args) => jsonContent(await client.updateInboundIntegration(args)))
  );

  server.tool(
    'delete_inbound_integration',
    `Permanently delete an inbound integration.
Permission (intended): integration:delete
⚠️  WRITE OPERATION — irreversible. The webhook URL stops accepting requests immediately.

Example response shape: { _env, message }`,
    { orgId, integrationId },
    safe('delete_inbound_integration', async (args) => jsonContent(await client.deleteInboundIntegration(args)))
  );

  server.tool(
    'test_inbound_integration',
    `Send a REAL test payload through an inbound integration's configured transformation/routing.
Permission (intended): integration:test
⚠️  For HTTP-type integrations this makes an actual outbound call and applies the response transformation.
For COMMUNICATION-type integrations this sends a real message via the configured provider.

Example response shape: { _env, success, status, responseTime, response, message }`,
    {
      orgId,
      integrationId,
      payload: z.record(z.any()).optional().describe('Custom test payload — defaults to { test: true, timestamp }'),
    },
    safe('test_inbound_integration', async (args) => jsonContent(await client.testInboundIntegration(args)))
  );

  // ── Scheduled jobs ───────────────────────────────────────────────────────────

  const jobId = z.string().min(1).describe('Scheduled job ID');
  const scheduledLogId = z.string().min(1).describe('Scheduled job execution log ID');
  const schedule = z
    .object({
      type: z.enum(['CRON', 'INTERVAL']),
      expression: z.string().optional().describe('Required for CRON — a standard cron expression'),
      intervalMs: z.number().int().min(60000).optional().describe('Required for INTERVAL — minimum 60000ms (1 minute)'),
    })
    .describe('Either { type: "CRON", expression } or { type: "INTERVAL", intervalMs }');

  server.tool(
    'list_scheduled_jobs',
    `List scheduled jobs (SCRIPT_JOB and data-source SCHEDULED jobs) with their last execution status.
Permission: scheduled:view

Example response shape: { _env, data: [{ _id, name, direction, isActive, schedule, lastExecution }] }
Note: unlike the integration tools, scheduled-job responses use the raw Mongo \`_id\` field, not \`id\` —
use that value as \`jobId\` in get/update/delete/execute calls.`,
    { orgId },
    safe('list_scheduled_jobs', async (args) => jsonContent(await client.listScheduledJobs(args)))
  );

  server.tool(
    'get_scheduled_job',
    `Fetch the full configuration of one scheduled job. Environment variable VALUES are never returned
(only key/hasValue/updatedAt) — use reveal separately via the admin UI if a Super Admin truly needs to see one.
Permission: scheduled:view

Example response shape: { _env, _id, name, direction, schedule, script?, dataSource?, environmentVariables }`,
    { orgId, jobId },
    safe('get_scheduled_job', async (args) => jsonContent(await client.getScheduledJob(args)))
  );

  server.tool(
    'create_scheduled_job',
    `Create a scheduled job — either a SCRIPT_JOB (runs custom script code on a schedule) or a data-source
SCHEDULED job (polls a data source and pushes to targetUrl on a schedule).
Permission: scheduled:create
⚠️  WRITE OPERATION. If isActive (default true), the job is scheduled immediately.

For a SCRIPT_JOB: set direction (or jobType) = 'SCRIPT_JOB' at the TOP LEVEL of the args (not nested) and
  provide \`script\`. Optional: runtime ('NODE_PROCESS' triggers an async dependency install), dependencies
  ({name: version}), environmentVariables ([{key, value, secretKey?}] — key must match /^[A-Z_][A-Z0-9_]*$/,
  max 100, values are encrypted and never returned in any response).
For a data-source job: provide dataSource ({type, ...}) and targetUrl. httpMethod defaults to POST.

Example prompt: "Create a SCRIPT_JOB called 'Daily Cleanup' running every day at 2am (cron: '0 2 * * *') with this script: ..."
Example response shape: { _env, _id, name, direction, schedule, ... } (full created document, env var values stripped — use _id, not id, for subsequent jobId args)`,
    {
      orgId,
      name: z.string().min(1),
      direction: z
        .string()
        .optional()
        .describe('Set to "SCRIPT_JOB" to create a script job instead of a data-source job'),
      jobType: z.string().optional().describe('Alternative to direction — either one set to "SCRIPT_JOB" works'),
      schedule,
      script: z.string().optional().describe('Required for SCRIPT_JOB'),
      runtime: z.string().optional().describe('e.g. NODE_PROCESS to enable npm dependency installs'),
      dependencies: z.record(z.string()).optional().describe('npm package name -> version, SCRIPT_JOB only'),
      environmentVariables: z
        .array(
          z.object({
            key: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
            value: z.string().optional(),
            secretKey: z.string().optional(),
          })
        )
        .max(100)
        .optional(),
      dataSource: z.record(z.any()).optional().describe('Required for a data-source job: { type, ... }'),
      targetUrl: z.string().optional().describe('Required for a data-source job'),
      httpMethod: z.string().optional(),
      isActive: z.boolean().optional(),
    },
    safe('create_scheduled_job', async (args) => jsonContent(await client.createScheduledJob(args)))
  );

  server.tool(
    'update_scheduled_job',
    `Update an existing scheduled job. Partial update — only send fields you want to change.
Permission: scheduled:edit
⚠️  WRITE OPERATION — reschedules (or unschedules, if isActive becomes false) immediately.
Cannot change _id, direction, or createdAt. Do NOT send tenantId — use orgId at the top level if needed.
Changing script/dependencies on a NODE_PROCESS SCRIPT_JOB re-triggers a dependency install if they actually changed.

Example response shape: { _env, _id, name, ... } (full updated document, env var values stripped)`,
    {
      orgId,
      jobId,
      name: z.string().min(1).optional(),
      schedule: schedule.optional(),
      script: z.string().optional(),
      runtime: z.string().optional(),
      dependencies: z.record(z.string()).optional(),
      environmentVariables: z
        .array(
          z.object({
            key: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
            value: z.string().optional(),
            secretKey: z.string().optional(),
          })
        )
        .max(100)
        .optional(),
      dataSource: z.record(z.any()).optional(),
      targetUrl: z.string().optional(),
      httpMethod: z.string().optional(),
      isActive: z.boolean().optional(),
    },
    safe('update_scheduled_job', async (args) => jsonContent(await client.updateScheduledJob(args)))
  );

  server.tool(
    'delete_scheduled_job',
    `Permanently delete a scheduled job. Unschedules it, deletes orphaned env-var secrets, and (for
NODE_PROCESS runtime SCRIPT_JOBs) removes the on-disk job directory.
Permission: scheduled:delete
⚠️  WRITE OPERATION — irreversible.

Example response shape: { _env, message: 'Scheduled job deleted successfully' }`,
    { orgId, jobId },
    safe('delete_scheduled_job', async (args) => jsonContent(await client.deleteScheduledJob(args)))
  );

  server.tool(
    'execute_scheduled_job',
    `Trigger an immediate, out-of-schedule run of a scheduled job. Fire-and-forget — the response returns
immediately; poll the job's logs (via the admin UI, or search_delivery_logs for data-source jobs) to see the result.
Permission: scheduled:execute
Requires: reason (min 5 chars) — recorded in audit log.

Example response shape: { _env, message, dryRun }`,
    {
      orgId,
      jobId,
      dryRun: z.boolean().optional().describe('If true, simulates without side effects where the job supports it'),
      reason,
    },
    safe('execute_scheduled_job', async (args) => jsonContent(await client.executeScheduledJob(args)))
  );

  server.tool(
    'test_scheduled_job_datasource',
    `Dry-run a data source configuration live (with a 30s timeout) WITHOUT creating or saving a job.
Permission: scheduled:create
Truncates the result to the first 10 records (or if the serialized size exceeds 100000 chars).

Example response shape: { _env, success, message, recordsFetched, sampleData, limitedRecords }`,
    {
      orgId,
      dataSource: z.record(z.any()).describe('{ type, ... } — the data source config to test'),
    },
    safe('test_scheduled_job_datasource', async (args) => jsonContent(await client.testScheduledJobDataSource(args)))
  );

  server.tool(
    'list_scheduled_job_logs',
    `List execution history for one scheduled job.
Permission: scheduled:view
Use after execute_scheduled_job to monitor the run. Results are newest first and can be filtered by status.

Example response shape: { _env, data: [{ _id, status, startedAt, completedAt, error }], total }`,
    {
      orgId,
      jobId,
      limit: z.number().int().positive().max(100).optional(),
      offset: z.number().int().min(0).optional(),
      status: z.string().optional().describe('Optional execution status filter'),
    },
    safe('list_scheduled_job_logs', async (args) => jsonContent(await client.listScheduledJobLogs(args)))
  );

  server.tool(
    'get_scheduled_job_log',
    `Fetch one scheduled-job execution log with its complete result and error details.
Permission: scheduled:view
Use logId from list_scheduled_job_logs. The organization and job ID are both required for tenant-safe lookup.

Example response shape: { _env, _id, status, startedAt, completedAt, result, error }`,
    { orgId, jobId, logId: scheduledLogId },
    safe('get_scheduled_job_log', async (args) => jsonContent(await client.getScheduledJobLog(args)))
  );

  // ── Credential placeholders (create) ─────────────────────────────────────────

  server.tool(
    'create_credential_placeholder',
    `Create a credential placeholder — metadata + field definitions for a set of secrets (e.g. an API key
and a webhook secret for a given provider). Does NOT set any actual secret values; use set_credential_value
for that once the placeholder exists.
Permission: credentials:manage
Requires: reason (min 5 chars) — recorded in audit log.

Example prompt: "Create a credential placeholder for org 892, provider 'Stripe', production environment, with fields apiKey (secret) and webhookSecret (secret)"
Example response shape: { _env, id, provider, name, environment, status: 'PENDING', fields: [{key, label, secret, required, status}] }`,
    {
      orgId,
      provider: z.string().min(1),
      name: z.string().optional().describe('Defaults to provider name if omitted'),
      environment: z.enum(['validation', 'production']).optional().describe('Default validation'),
      authType: z.string().optional().describe('Default API_KEY'),
      notes: z.string().optional(),
      fields: z
        .array(
          z.object({
            key: z.string().min(1),
            label: z.string().optional(),
            secret: z.boolean().optional().describe('Default true'),
            required: z.boolean().optional().describe('Default true'),
          })
        )
        .min(1),
      reason,
    },
    safe('create_credential_placeholder', async (args) =>
      jsonContent(await client.createCredentialPlaceholder(args))
    )
  );

  // ── Issue reporting (GitHub) ──────────────────────────────────────────────────

  server.tool(
    'report_issue',
    `File (or update) a GitHub issue when something is actually broken — a bug, a persistent error, a data
inconsistency, or backend behavior that doesn't match the docs.
NOT for transient, self-recovering errors — a single timeout or a 503 that clears up on retry is not
issue-worthy on its own; only call this once you've confirmed the problem is real and reproducible.
Deduplicates: if an issue for the same underlying problem (same dedupKey, or same title if dedupKey is
omitted) is already open, this adds a "recurred again" comment to it instead of creating a duplicate.
Requires GITHUB_TOKEN and GITHUB_REPO ("owner/repo") to be set in the MCP server's environment — returns
{ filed: false, reason } instead of throwing if they aren't configured.

Example response shape: { filed: true, duplicate: false, issueUrl, issueNumber }`,
    {
      title: z.string().min(5).max(200).describe('Short, specific issue title'),
      description: z
        .string()
        .min(10)
        .describe(
          'What happened, what was expected, and relevant context (tool name, args, org/integration ids). Never include secret values.'
        ),
      severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      errorDetail: z
        .record(z.any())
        .optional()
        .describe('Structured error payload (status, message, etc.) to include verbatim in the issue body'),
      dedupKey: z
        .string()
        .optional()
        .describe('Stable key identifying the underlying problem — defaults to title. Prevents duplicate issues for the same recurring error.'),
    },
    safe('report_issue', async (args) => {
      const body = [
        args.description,
        '',
        `**Severity:** ${args.severity}`,
        args.errorDetail ? `\n**Error detail:**\n\`\`\`json\n${JSON.stringify(args.errorDetail, null, 2)}\n\`\`\`` : '',
        '',
        '_Filed automatically by the integration-control-plane MCP server._',
      ]
        .filter(Boolean)
        .join('\n');

      return jsonContent(
        await issueReporter.file({
          kind: 'bug',
          title: args.title,
          body,
          labels: ['mcp-server', 'bug', `severity:${args.severity}`],
          dedupKey: args.dedupKey,
        })
      );
    })
  );

  server.tool(
    'request_feature',
    `File a GitHub feature request when a user asks for something this MCP server (or the underlying
Integration Gateway API) genuinely can't do yet. Call this only after confirming there's really no existing
tool or capability that covers the ask — don't file speculative requests without checking first.
Deduplicates against any existing open request for the same capability (same dedupKey, or same title if
dedupKey is omitted).
Requires GITHUB_TOKEN and GITHUB_REPO ("owner/repo") to be set in the MCP server's environment — returns
{ filed: false, reason } instead of throwing if they aren't configured.

Example response shape: { filed: true, duplicate: false, issueUrl, issueNumber }`,
    {
      title: z.string().min(5).max(200).describe('Short, specific feature title'),
      description: z
        .string()
        .min(10)
        .describe("What the user asked for, why the current toolset can't do it, and any useful context"),
      requestedBy: z.string().optional().describe('Who asked for this, if known — omit if unknown'),
      dedupKey: z
        .string()
        .optional()
        .describe('Stable key identifying the requested capability — defaults to title.'),
    },
    safe('request_feature', async (args) => {
      const body = [
        args.description,
        '',
        args.requestedBy ? `**Requested by:** ${args.requestedBy}` : '',
        '',
        '_Filed automatically by the integration-control-plane MCP server._',
      ]
        .filter(Boolean)
        .join('\n');

      return jsonContent(
        await issueReporter.file({
          kind: 'feature',
          title: args.title,
          body,
          labels: ['mcp-server', 'enhancement'],
          dedupKey: args.dedupKey,
        })
      );
    })
  );
}
