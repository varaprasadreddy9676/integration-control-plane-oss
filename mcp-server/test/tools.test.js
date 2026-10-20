import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { registerTools } from '../src/tools.js';

/**
 * Minimal stand-in for McpServer that just records what registerTools
 * registers, so we can invoke handlers and validate schemas directly
 * without spinning up the real MCP protocol/transport.
 */
function fakeServer() {
  const tools = new Map();
  const resources = new Map();
  const prompts = new Map();
  return {
    tool(name, description, shape, handler) {
      tools.set(name, { description, shape: z.object(shape), handler });
    },
    registerResource(name, uri, config, handler) {
      resources.set(name, { uri, config, handler });
    },
    registerPrompt(name, config, handler) {
      prompts.set(name, { config, handler });
    },
    tools,
    resources,
    prompts,
  };
}

function fakeClient(overrides = {}) {
  return {
    getGatewayHealth: async () => ({ _env: 'test', status: 'healthy' }),
    listIntegrations: async () => ({ _env: 'test', data: [] }),
    diagnoseOrgFailures: async () => ({ _env: 'test' }),
    getIntegrationStatus: async () => ({ _env: 'test' }),
    searchDeliveryLogs: async () => ({ _env: 'test', data: [] }),
    getExecutionTrace: async () => ({ _env: 'test' }),
    listCredentialPlaceholders: async () => ({ _env: 'test', data: [] }),
    resetCircuitBreaker: async () => ({ _env: 'test' }),
    replayDeliveryLog: async () => ({ _env: 'test' }),
    runTest: async () => ({ _env: 'test' }),
    setCredentialValues: async () => ({ _env: 'test' }),
    testCredentialPlaceholder: async () => ({ _env: 'test' }),
    checkAuditTrail: async () => ({ _env: 'test', logs: [] }),
    listOutboundIntegrations: async () => ({ _env: 'test', data: [] }),
    listEventTypes: async () => ({ _env: 'test', eventTypes: [] }),
    getOutboundIntegration: async () => ({ _env: 'test' }),
    createOutboundIntegration: async () => ({ _env: 'test' }),
    updateOutboundIntegration: async () => ({ _env: 'test' }),
    deleteOutboundIntegration: async () => ({ _env: 'test' }),
    duplicateOutboundIntegration: async () => ({ _env: 'test' }),
    testOutboundIntegration: async () => ({ _env: 'test' }),
    validateOutboundTransformation: async () => ({ _env: 'test' }),
    listInboundIntegrations: async () => ({ _env: 'test', data: [] }),
    getInboundIntegration: async () => ({ _env: 'test' }),
    createInboundIntegration: async () => ({ _env: 'test' }),
    updateInboundIntegration: async () => ({ _env: 'test' }),
    deleteInboundIntegration: async () => ({ _env: 'test' }),
    testInboundIntegration: async () => ({ _env: 'test' }),
    listScheduledJobs: async () => ({ _env: 'test', data: [] }),
    getScheduledJob: async () => ({ _env: 'test' }),
    createScheduledJob: async () => ({ _env: 'test' }),
    updateScheduledJob: async () => ({ _env: 'test' }),
    deleteScheduledJob: async () => ({ _env: 'test' }),
    executeScheduledJob: async () => ({ _env: 'test' }),
    testScheduledJobDataSource: async () => ({ _env: 'test' }),
    listScheduledJobLogs: async () => ({ _env: 'test', data: [] }),
    getScheduledJobLog: async () => ({ _env: 'test' }),
    createCredentialPlaceholder: async () => ({ _env: 'test' }),
    ...overrides,
  };
}

const EXPECTED_TOOLS = [
  'gateway_health',
  // Ops (original 12)
  'list_integrations',
  'diagnose_org',
  'get_integration_status',
  'search_delivery_logs',
  'get_execution_trace',
  'list_credentials',
  'reset_circuit_breaker',
  'replay_delivery',
  'run_integration_test',
  'set_credential_value',
  'test_credential',
  'check_audit_trail',
  // Outbound integrations
  'list_outbound_integrations',
  'list_event_types',
  'get_outbound_integration',
  'create_outbound_integration',
  'update_outbound_integration',
  'delete_outbound_integration',
  'duplicate_outbound_integration',
  'test_outbound_integration',
  'validate_outbound_transformation',
  // Inbound integrations
  'list_inbound_integrations',
  'get_inbound_integration',
  'create_inbound_integration',
  'update_inbound_integration',
  'delete_inbound_integration',
  'test_inbound_integration',
  // Scheduled jobs
  'list_scheduled_jobs',
  'get_scheduled_job',
  'create_scheduled_job',
  'update_scheduled_job',
  'delete_scheduled_job',
  'execute_scheduled_job',
  'test_scheduled_job_datasource',
  'list_scheduled_job_logs',
  'get_scheduled_job_log',
  // Credentials
  'create_credential_placeholder',
  // Issue reporting
  'report_issue',
  'request_feature',
];

test('registers every documented tool, and nothing undocumented', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());
  assert.equal(server.tools.size, EXPECTED_TOOLS.length);
  for (const name of EXPECTED_TOOLS) {
    assert.ok(server.tools.has(name), `expected tool ${name} to be registered`);
  }
});

test('registers reusable MCP resources and workflow prompts', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  assert.deepEqual([...server.resources.keys()], ['quickstart', 'safety']);
  assert.deepEqual([...server.prompts.keys()], ['incident_triage', 'integration_change_review']);
});

test('safe() returns a readable error content block instead of throwing when the API call fails', async () => {
  const server = fakeServer();
  const err = new Error('org not found');
  err.status = 404;
  err.payload = { code: 'NOT_FOUND' };
  registerTools(
    server,
    fakeClient({
      diagnoseOrgFailures: async () => {
        throw err;
      },
    })
  );

  const result = await server.tools.get('diagnose_org').handler({ orgId: 1 });
  const body = JSON.parse(result.content[0].text);

  assert.equal(body.error, true);
  assert.equal(body.status, 404);
  assert.equal(body.message, 'org not found');
  assert.deepEqual(body.detail, { code: 'NOT_FOUND' });
  assert.equal(body.requestId, null);
  assert.equal(result.isError, true);
});

test('safe() does not crash when a thrown error has no status/payload', async () => {
  const server = fakeServer();
  registerTools(
    server,
    fakeClient({
      listIntegrations: async () => {
        throw new Error('network unreachable');
      },
    })
  );

  const result = await server.tools.get('list_integrations').handler({ orgId: 1 });
  const body = JSON.parse(result.content[0].text);

  assert.equal(body.status, 'UNKNOWN');
  assert.equal(body.message, 'network unreachable');
});

test('mutation tools reject a reason shorter than 5 characters', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('reset_circuit_breaker');
  const result = shape.safeParse({ orgId: 1, integrationId: 'abc', reason: 'no' });

  assert.equal(result.success, false);
});

test('mutation tools accept a valid reason', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('reset_circuit_breaker');
  const result = shape.safeParse({ orgId: 1, integrationId: 'abc', reason: 'upstream fixed' });

  assert.equal(result.success, true);
});

test('read-only tools do not require a reason', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('list_integrations');
  const result = shape.safeParse({ orgId: 1 });

  assert.equal(result.success, true);
});

test('set_credential_value requires a values map alongside a reason', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('set_credential_value');

  assert.equal(
    shape.safeParse({ orgId: 1, placeholderId: 'p1', reason: 'rotating key' }).success,
    false,
    'missing values should fail validation'
  );
  assert.equal(
    shape.safeParse({
      orgId: 1,
      placeholderId: 'p1',
      values: { apiKey: 'secret' },
      reason: 'rotating key',
    }).success,
    true
  );
});

test('orgId must be a positive integer', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('list_integrations');
  assert.equal(shape.safeParse({ orgId: -1 }).success, false);
  assert.equal(shape.safeParse({ orgId: 1.5 }).success, false);
  assert.equal(shape.safeParse({ orgId: 892 }).success, true);
});

test('create_outbound_integration requires the core fields and rejects an invalid scope', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('create_outbound_integration');

  assert.equal(shape.safeParse({ name: 'Only a name' }).success, false, 'missing required fields should fail');
  assert.equal(
    shape.safeParse({
      name: 'Lab Result Webhook',
      eventType: 'LAB_RESULT_READY',
      targetUrl: 'https://partner.example.com/webhook',
      httpMethod: 'POST',
      scope: 'GLOBAL', // not a valid enum value
      outgoingAuthType: 'NONE',
      timeoutMs: 10000,
      retryCount: 3,
    }).success,
    false,
    'invalid scope enum should fail'
  );
  assert.equal(
    shape.safeParse({
      orgId: 892,
      name: 'Lab Result Webhook',
      eventType: 'LAB_RESULT_READY',
      targetUrl: 'https://partner.example.com/webhook',
      httpMethod: 'POST',
      scope: 'ENTITY_ONLY',
      outgoingAuthType: 'NONE',
      timeoutMs: 10000,
      retryCount: 3,
    }).success,
    true
  );
});

test('create_outbound_integration requires orgId', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('create_outbound_integration');
  const result = shape.safeParse({
    name: 'Lab Result Webhook',
    eventType: 'LAB_RESULT_READY',
    targetUrl: 'https://partner.example.com/webhook',
    httpMethod: 'POST',
    scope: 'ENTITY_ONLY',
    outgoingAuthType: 'NONE',
    timeoutMs: 10000,
    retryCount: 3,
  });

  assert.equal(result.success, false, 'orgId is required — the backend resolves org scope only from it');
});

test('create_scheduled_job accepts a CRON schedule and rejects an INTERVAL below the 60s floor', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('create_scheduled_job');

  assert.equal(
    shape.safeParse({
      orgId: 892,
      name: 'Daily Cleanup',
      direction: 'SCRIPT_JOB',
      schedule: { type: 'CRON', expression: '0 2 * * *' },
      script: 'console.log("hi")',
    }).success,
    true
  );
  assert.equal(
    shape.safeParse({
      orgId: 892,
      name: 'Too Frequent',
      schedule: { type: 'INTERVAL', intervalMs: 1000 },
      dataSource: { type: 'MYSQL' },
      targetUrl: 'https://example.com/ingest',
    }).success,
    false,
    'intervalMs below 60000 must fail validation'
  );
});

test('create_credential_placeholder requires at least one field and a reason', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const { shape } = server.tools.get('create_credential_placeholder');

  assert.equal(
    shape.safeParse({ orgId: 1, provider: 'Stripe', fields: [], reason: 'new integration' }).success,
    false,
    'empty fields array should fail'
  );
  assert.equal(
    shape.safeParse({
      orgId: 1,
      provider: 'Stripe',
      fields: [{ key: 'apiKey' }],
      reason: 'new integration',
    }).success,
    true
  );
});

test('delete tools require orgId + the resource id, no reason', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  assert.equal(
    server.tools.get('delete_outbound_integration').shape.safeParse({ integrationId: 'abc' }).success,
    false,
    'orgId must be required — the backend has no fallback for it on this route'
  );
  assert.equal(
    server.tools.get('delete_outbound_integration').shape.safeParse({ orgId: 892, integrationId: 'abc' }).success,
    true
  );
  assert.equal(
    server.tools.get('delete_scheduled_job').shape.safeParse({ orgId: 892, jobId: 'abc' }).success,
    true
  );
});

test('report_issue and request_feature require a real title and description', () => {
  const server = fakeServer();
  registerTools(server, fakeClient());

  const reportShape = server.tools.get('report_issue').shape;
  assert.equal(reportShape.safeParse({ title: 'ok', description: 'short but not too short' }).success, false, 'title under 5 chars must fail');
  assert.equal(
    reportShape.safeParse({ title: 'Something is broken', description: 'short' }).success,
    false,
    'description under 10 chars must fail'
  );
  assert.equal(
    reportShape.safeParse({ title: 'Something is broken', description: 'A full description of the bug' }).success,
    true
  );

  const featureShape = server.tools.get('request_feature').shape;
  assert.equal(
    featureShape.safeParse({ title: 'Support bulk export', description: 'Users need to export 1000+ rows at once' })
      .success,
    true
  );
});

test('report_issue defaults severity to medium and passes structured error detail through to the reporter', async () => {
  const server = fakeServer();
  const fileCalls = [];
  const fakeIssueReporter = {
    configured: true,
    file: async (args) => {
      fileCalls.push(args);
      return { filed: true, duplicate: false, issueUrl: 'https://github.com/acme/widgets/issues/1', issueNumber: 1 };
    },
  };
  registerTools(server, fakeClient(), { issueReporter: fakeIssueReporter });

  const result = await server.tools.get('report_issue').handler({
    title: 'Circuit breaker stuck open',
    description: 'Reset succeeded but it re-opened within a minute',
    severity: 'medium',
    errorDetail: { status: 503, message: 'Service Unavailable' },
  });
  const body = JSON.parse(result.content[0].text);

  assert.equal(body.filed, true);
  assert.equal(body.issueNumber, 1);
  assert.equal(fileCalls[0].kind, 'bug');
  assert.deepEqual(fileCalls[0].labels, ['mcp-server', 'bug', 'severity:medium']);
  assert.ok(fileCalls[0].body.includes('503'));
});

test('request_feature reports filed:false with a reason when GitHub is not configured', async () => {
  const server = fakeServer();
  registerTools(server, fakeClient(), {
    issueReporter: {
      configured: false,
      file: async () => ({ filed: false, duplicate: false, reason: 'GitHub issue reporting is not configured' }),
    },
  });

  const result = await server.tools.get('request_feature').handler({
    title: 'Support bulk export',
    description: 'Users need to export 1000+ rows at once',
  });
  const body = JSON.parse(result.content[0].text);

  assert.equal(body.filed, false);
  assert.match(body.reason, /not configured/);
});
