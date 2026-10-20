import test from 'node:test';
import assert from 'node:assert/strict';
import { IntegrationControlPlaneClient } from '../src/api-client.js';

test('builds authenticated API requests with MCP client header', async () => {
  const calls = [];
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1/',
    apiKey: 'api-key',
    authToken: 'jwt-token',
    clientName: 'codex',
    env: 'staging',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 });
    },
  });

  const result = await client.getIntegrationStatus({ orgId: 892, integrationId: 'abc' });

  // Result is wrapped with env metadata
  assert.equal(result._env, 'staging');
  assert.equal(result._baseUrl, 'https://gateway.example.com/api/v1');
  assert.equal(result.ok, true);
  assert.equal(calls[0].url.toString(), 'https://gateway.example.com/api/v1/ops/integration-status/abc?orgId=892');
  assert.equal(calls[0].options.headers['X-API-Key'], 'api-key');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer jwt-token');
  assert.equal(calls[0].options.headers['X-MCP-Client'], 'codex');
  assert.match(calls[0].options.headers['X-Request-Id'], /^[0-9a-f-]{36}$/);
});

test('uses the service root for the gateway health check', async () => {
  const calls = [];
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/integration-gateway-server/api/v1',
    env: 'validation',
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), options });
      return new Response(JSON.stringify({ status: 'healthy' }), {
        status: 200,
        headers: { 'x-request-id': 'health-1' },
      });
    },
  });

  const result = await client.getGatewayHealth();
  assert.equal(result.status, 'healthy');
  assert.equal(result._env, 'validation');
  assert.equal(calls[0].url, 'https://gateway.example.com/integration-gateway-server/health');
  assert.match(calls[0].options.headers['X-Request-Id'], /^[0-9a-f-]{36}$/);
});

test('wraps results with env label', async () => {
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    env: 'production',
    fetchImpl: async () =>
      new Response(JSON.stringify({ success: true, data: { count: 5 } }), { status: 200 }),
  });

  const result = await client.diagnoseOrgFailures({ orgId: 1 });
  assert.equal(result._env, 'production');
  assert.equal(result.count, 5);
});

test('wraps raw array responses under data instead of exposing numeric object keys', async () => {
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async () => new Response(JSON.stringify([{ id: 'one' }]), { status: 200 }),
  });

  const result = await client.listScheduledJobLogs({ orgId: 1, jobId: 'job1' });
  assert.deepEqual(result.data, [{ id: 'one' }]);
  assert.equal(result[0], undefined);
});

test('check_audit_trail queries correct endpoint', async () => {
  const calls = [];
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ success: true, data: { total: 0, logs: [] } }), { status: 200 });
    },
  });

  await client.checkAuditTrail({ orgId: 1, days: 3, toolName: 'reset_circuit_breaker' });

  assert.ok(calls[0].url.toString().includes('/ops/audit-trail'));
  assert.ok(calls[0].url.toString().includes('toolName=reset_circuit_breaker'));
});

test('throws API error payloads for non-2xx responses', async () => {
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async () =>
      new Response(JSON.stringify({ code: 'VALIDATION_ERROR', message: 'reason is required' }), { status: 400 }),
  });

  await assert.rejects(
    () => client.resetCircuitBreaker({ orgId: 1, integrationId: 'abc' }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.message, 'reason is required');
      assert.equal(error.payload.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('redacts credential values from an error payload the API echoes back', async () => {
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          message: 'placeholder not found',
          // Simulates a backend that echoes the submitted body in a
          // validation error — the secret must never reach the caller.
          submitted: { placeholderId: 'p1', values: { apiKey: 'super-secret-value' } },
        }),
        { status: 404 }
      ),
  });

  await assert.rejects(
    () => client.setCredentialValues({ orgId: 1, placeholderId: 'p1', values: { apiKey: 'super-secret-value' } }),
    (error) => {
      assert.equal(error.payload.submitted.values, '[redacted]');
      assert.equal(JSON.stringify(error.payload).includes('super-secret-value'), false);
      return true;
    }
  );
});

test('redacts common credential key variants from error payloads', async () => {
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          submitted: {
            apiKey: 'secret-api-key',
            authorization: 'Bearer secret-token',
            client_secret: 'secret-client-value',
            clientSecret: 'secret-camel-case-value',
            visible: 'safe',
          },
        }),
        { status: 400 }
      ),
  });

  await assert.rejects(() => client.listIntegrations({ orgId: 1 }), (error) => {
    assert.equal(error.payload.submitted.apiKey, '[redacted]');
    assert.equal(error.payload.submitted.authorization, '[redacted]');
    assert.equal(error.payload.submitted.client_secret, '[redacted]');
    assert.equal(error.payload.submitted.clientSecret, '[redacted]');
    assert.equal(error.payload.submitted.visible, 'safe');
    return true;
  });
});

test('aborts and reports a clear timeout error when the backend never responds', async () => {
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    timeoutMs: 20,
    maxRetries: 0,
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  });

  await assert.rejects(
    () => client.listIntegrations({ orgId: 1 }),
    (error) => {
      assert.equal(error.status, 'TIMEOUT');
      assert.match(error.message, /timed out after 20ms/);
      return true;
    }
  );
});

test('retries a GET on a 5xx response and succeeds on the next attempt', async () => {
  let attempts = 0;
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    maxRetries: 2,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 2) {
        return new Response(JSON.stringify({ message: 'upstream unavailable' }), { status: 503 });
      }
      return new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 });
    },
  });

  const result = await client.listIntegrations({ orgId: 1 });
  assert.equal(attempts, 2);
  assert.equal(result.ok, true);
});

test('retries a GET on 429 and respects a bounded Retry-After delay', async () => {
  let attempts = 0;
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    maxRetries: 1,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ message: 'rate limited' }), {
          status: 429,
          headers: { 'retry-after': '0' },
        });
      }
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    },
  });

  const result = await client.listIntegrations({ orgId: 1 });
  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
});

test('does not retry a POST mutation on a 5xx response', async () => {
  let attempts = 0;
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    maxRetries: 2,
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ message: 'db unavailable' }), { status: 503 });
    },
  });

  await assert.rejects(() => client.resetCircuitBreaker({ orgId: 1, integrationId: 'abc' }));
  assert.equal(attempts, 1, 'a mutation must never be retried automatically');
});

test('does not retry a GET on a 4xx response (not transient)', async () => {
  let attempts = 0;
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    maxRetries: 2,
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ message: 'org not found' }), { status: 404 });
    },
  });

  await assert.rejects(() => client.listIntegrations({ orgId: 1 }));
  assert.equal(attempts, 1, 'client errors are not transient and should fail fast');
});

test('surfaces a clear error when the backend returns non-JSON (e.g. an HTML proxy error page)', async () => {
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    maxRetries: 0,
    fetchImpl: async () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }),
  });

  await assert.rejects(
    () => client.listIntegrations({ orgId: 1 }),
    (error) => {
      assert.match(error.message, /non-JSON response/);
      assert.match(error.message, /502/);
      return true;
    }
  );
});

test('create/update/delete outbound integration hit the correct method and URL, with orgId in the QUERY STRING', async () => {
  // outbound-integrations.js resolves org scope exclusively from req.orgId,
  // which the backend's auth middleware populates only from the query string
  // for API-key auth — never from the JSON body. If orgId only ended up in
  // the body, every one of these calls would silently operate with
  // orgId=undefined server-side. This test is the regression guard for that.
  const calls = [];
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), method: options.method, body: options.body ? JSON.parse(options.body) : null });
      return new Response(JSON.stringify({ success: true, data: { id: 'int1' } }), { status: 200 });
    },
  });

  await client.createOutboundIntegration({
    orgId: 892,
    name: 'Test Rule',
    eventType: 'FOO',
    targetUrl: 'https://x.example.com',
  });
  await client.updateOutboundIntegration({ orgId: 892, integrationId: 'int1', name: 'Renamed' });
  await client.deleteOutboundIntegration({ orgId: 892, integrationId: 'int1' });

  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://gateway.example.com/api/v1/outbound-integrations?orgId=892');
  assert.equal(calls[0].body.name, 'Test Rule');
  assert.equal(calls[0].body.orgId, undefined, 'orgId must not also be duplicated into the body');

  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].url, 'https://gateway.example.com/api/v1/outbound-integrations/int1?orgId=892');
  assert.equal(calls[1].body.name, 'Renamed');
  assert.equal(calls[1].body.integrationId, undefined, 'integrationId must not leak into the request body');

  assert.equal(calls[2].method, 'DELETE');
  assert.equal(calls[2].url, 'https://gateway.example.com/api/v1/outbound-integrations/int1?orgId=892');
});

test('scheduled job methods hit the correct URLs, including nested job id encoding', async () => {
  const calls = [];
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), method: options.method });
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    },
  });

  await client.createScheduledJob({ orgId: 892, name: 'Job', schedule: { type: 'CRON', expression: '0 2 * * *' } });
  await client.executeScheduledJob({ orgId: 892, jobId: 'job with spaces', reason: 'manual run' });
  await client.deleteScheduledJob({ orgId: 892, jobId: 'job1' });

  assert.equal(calls[0].url, 'https://gateway.example.com/api/v1/scheduled-jobs?orgId=892');
  assert.equal(
    calls[1].url,
    'https://gateway.example.com/api/v1/scheduled-jobs/job%20with%20spaces/execute?orgId=892'
  );
  assert.equal(calls[2].method, 'DELETE');
  assert.equal(calls[2].url, 'https://gateway.example.com/api/v1/scheduled-jobs/job1?orgId=892');
});

test('scheduled job log methods keep both job ID and org ID in the query-safe request', async () => {
  const calls = [];
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), method: options.method });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  });

  await client.listScheduledJobLogs({ orgId: 892, jobId: 'job with spaces', limit: 10, offset: 20, status: 'FAILED' });
  await client.getScheduledJobLog({ orgId: 892, jobId: 'job1', logId: 'log/1' });

  assert.equal(
    calls[0].url,
    'https://gateway.example.com/api/v1/scheduled-jobs/job%20with%20spaces/logs?orgId=892&limit=10&offset=20&status=FAILED'
  );
  assert.equal(calls[1].url, 'https://gateway.example.com/api/v1/scheduled-jobs/job1/logs/log%2F1?orgId=892');
});

test('inbound integration test call posts to the right sub-resource', async () => {
  const calls = [];
  const client = new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url: url.toString(), method: options.method });
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    },
  });

  await client.testInboundIntegration({ orgId: 892, integrationId: 'in1', payload: { hello: 'world' } });

  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://gateway.example.com/api/v1/inbound-integrations/in1/test?orgId=892');
});

const clientReturning = (status, body) =>
  new IntegrationControlPlaneClient({
    baseUrl: 'https://gateway.example.com/api/v1',
    apiKey: 'mdcs_pat_x',
    env: 'production',
    maxRetries: 0,
    fetchImpl: async () => new Response(JSON.stringify(body), { status }),
  });

// /health is public, so it cannot tell whether the key works. A rejected key
// must be reported as such instead of "ok".
test('reports a rejected API key', async () => {
  const result = await clientReturning(401, { error: 'Invalid API key' }).checkCredentials();
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(result.message, /Invalid API key/);
});

test('treats a key that authenticates but lacks this permission as valid', async () => {
  const result = await clientReturning(403, { error: 'Forbidden' }).checkCredentials();
  assert.equal(result.ok, true);
});

test('accepts a working key', async () => {
  const result = await clientReturning(200, { data: [] }).checkCredentials();
  assert.equal(result.ok, true);
});
