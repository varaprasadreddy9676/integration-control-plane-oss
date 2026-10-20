import { randomUUID } from 'node:crypto';

// Keys that must never appear in a tool response, even inside an error payload
// echoed back by the API (e.g. a validation error that includes the request
// body). Credential values are write-only from the MCP client's perspective.
const REDACTED_KEY_PATTERN = /(?:^|[_-])(value|values|secret|password|passwd|token|key|authorization|credential|private_key|client_secret)$/i;

function isRedactedKey(key) {
  const normalized = String(key).replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  return REDACTED_KEY_PATTERN.test(normalized);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) =>
        isRedactedKey(key) ? [key, '[redacted]'] : [key, redact(val)]
      )
    );
  }
  return value;
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 30_000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.min(timestamp - Date.now(), 30_000)) : null;
}

export class IntegrationControlPlaneClient {
  constructor({
    baseUrl = process.env.ICP_API_BASE_URL || 'http://localhost:3001/api/v1',
    apiKey = process.env.ICP_API_KEY,
    authToken = process.env.ICP_AUTH_TOKEN,
    env = process.env.ICP_ENV || 'unknown',
    fetchImpl = globalThis.fetch,
    clientName = process.env.ICP_MCP_CLIENT_NAME || 'integration-control-plane-mcp',
    timeoutMs = Number(process.env.ICP_REQUEST_TIMEOUT_MS) || 30_000,
    maxRetries = Number(process.env.ICP_MAX_RETRIES) || 2,
  } = {}) {
    if (!fetchImpl) {
      throw new Error('fetch is required; use Node.js 18+ or provide fetchImpl');
    }
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.authToken = authToken;
    this.env = env;
    this.fetch = fetchImpl;
    this.clientName = clientName;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.serviceBaseUrl = this.baseUrl.replace(/\/api\/v\d+\/?$/, '');
  }

  buildUrl(path, query = {}) {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    return url;
  }

  buildHeaders(extraHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-MCP-Client': this.clientName,
      ...extraHeaders,
    };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (this.authToken)
      headers.Authorization = this.authToken.startsWith('Bearer ')
        ? this.authToken
        : `Bearer ${this.authToken}`;
    return headers;
  }

  async fetchOnce(method, path, { query, body, baseUrl = this.baseUrl } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestId = randomUUID();

    let response;
    try {
      response = await this.fetch(this.buildUrlWithBase(baseUrl, path, query), {
        method,
        headers: this.buildHeaders({ 'X-Request-Id': requestId }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutError = new Error(`Request to ${path} timed out after ${this.timeoutMs}ms`);
        timeoutError.status = 'TIMEOUT';
        timeoutError.requestId = requestId;
        throw timeoutError;
      }
      if (err && typeof err === 'object') err.requestId = requestId;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      const parseError = new Error(
        `Backend returned non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`
      );
      parseError.status = response.status;
      parseError.requestId = response.headers.get('x-request-id') || requestId;
      throw parseError;
    }

    if (!response.ok) {
      const message = payload?.message || payload?.error || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = redact(payload);
      error.requestId = response.headers.get('x-request-id') || requestId;
      error.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      throw error;
    }
    return payload?.data ?? payload;
  }

  buildUrlWithBase(baseUrl, path, query = {}) {
    const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    return url;
  }

  /**
   * Retries idempotent GET requests on network errors, timeouts, or 5xx
   * responses (bounded, exponential backoff). Mutations (POST) are never
   * retried automatically — a retried mutation could double-apply a
   * side effect the caller didn't ask for twice.
   */
  async request(method, path, opts = {}) {
    const retryable = method === 'GET';
    let lastError;

    for (let attempt = 0; attempt <= (retryable ? this.maxRetries : 0); attempt += 1) {
      try {
        return await this.fetchOnce(method, path, opts);
      } catch (err) {
        lastError = err;
        const isServerError = typeof err.status === 'number' && err.status >= 500;
        const isTransient =
          err.status === 'TIMEOUT' ||
          err.status === 408 ||
          err.status === 429 ||
          isServerError ||
          err instanceof TypeError;
        if (!retryable || !isTransient || attempt === this.maxRetries) {
          throw err;
        }
        const exponentialDelay = 250 * 2 ** attempt;
        const retryAfterDelay = Number.isFinite(err.retryAfterMs) ? err.retryAfterMs : 0;
        await new Promise((resolve) => setTimeout(resolve, Math.max(exponentialDelay, retryAfterDelay)));
      }
    }
    throw lastError;
  }

  /** Wrap any result with a consistent env label so callers always know which environment they're talking to. */
  withEnv(data) {
    const normalized = Array.isArray(data)
      ? { data }
      : typeof data === 'object' && data !== null
        ? data
        : { result: data };
    return { ...normalized, _env: this.env, _baseUrl: this.baseUrl };
  }

  async call(method, path, opts) {
    const data = await this.request(method, path, opts);
    return this.withEnv(data);
  }

  getGatewayHealth() {
    return this.call('GET', '/health', { baseUrl: this.serviceBaseUrl });
  }

  /**
   * /health is public, so it says nothing about the key. Make one
   * authenticated call: 401 means the key was rejected; a 403 still means
   * the key authenticated (it just may not list keys).
   */
  async checkCredentials() {
    try {
      await this.request('GET', '/api-keys');
      return { ok: true };
    } catch (error) {
      if (error.status === 403) return { ok: true };
      const hint =
        error.status === 401
          ? 'The gateway rejected this API key. Check ICP_API_KEY, or create a new key under Settings → API Keys.'
          : 'Could not verify the API key. Check ICP_API_BASE_URL (it should end in /api/v1).';
      return { ok: false, status: error.status ?? 'UNKNOWN', message: `${error.message}. ${hint}` };
    }
  }

  // ─── Read operations ────────────────────────────────────────────────────────

  diagnoseOrgFailures(args) {
    return this.call('GET', '/ops/org-diagnosis', { query: args });
  }

  getIntegrationStatus(args) {
    const { integrationId, ...query } = args;
    return this.call('GET', `/ops/integration-status/${encodeURIComponent(integrationId)}`, { query });
  }

  checkAuditTrail(args) {
    return this.call('GET', '/ops/audit-trail', { query: args });
  }

  listIntegrations(args) {
    return this.call('GET', '/integrations', { query: args });
  }

  searchDeliveryLogs(args) {
    return this.call('GET', '/logs', { query: args });
  }

  getExecutionTrace(args) {
    const { orgId, logId } = args;
    return this.call('GET', `/logs/${encodeURIComponent(logId)}`, { query: { orgId } });
  }

  listCredentialPlaceholders(args) {
    return this.call('GET', '/credentials', { query: args });
  }

  // ─── Mutation operations ────────────────────────────────────────────────────

  resetCircuitBreaker(args) {
    const { integrationId, ...body } = args;
    return this.call('POST', `/ops/circuit-breaker/${encodeURIComponent(integrationId)}/reset`, { body });
  }

  replayDeliveryLog(args) {
    const { logId, ...body } = args;
    return this.call('POST', `/ops/logs/${encodeURIComponent(logId)}/replay`, { body });
  }

  runTest(args) {
    return this.call('POST', '/ops/test-run', { body: args });
  }

  createCredentialPlaceholder(args) {
    return this.call('POST', '/credentials/placeholders', { body: args });
  }

  setCredentialValues(args) {
    const { placeholderId, ...body } = args;
    return this.call('POST', `/credentials/${encodeURIComponent(placeholderId)}/values`, { body });
  }

  testCredentialPlaceholder(args) {
    const { placeholderId, ...body } = args;
    return this.call('POST', `/credentials/${encodeURIComponent(placeholderId)}/test`, { body });
  }

  // ─── Outbound integrations (event rules) ───────────────────────────────────

  // outbound-integrations.js, integrations.js (inbound), and scheduled-jobs.js
  // all resolve org scope EXCLUSIVELY from `req.orgId`, which the backend's
  // auth middleware populates only from the QUERY STRING for API-key auth
  // (never from the JSON body) — unlike ops.js/credentials.js, which have
  // their own `req.query.orgId || req.body?.orgId || req.orgId` fallback.
  // So orgId must always be sent as a query param here, even on POST/PUT/
  // DELETE calls, or every request silently operates with orgId=undefined.
  splitOrgQuery(args, extraQuery = {}) {
    const { orgId, ...rest } = args;
    return { query: { orgId, ...extraQuery }, rest };
  }

  listOutboundIntegrations(args) {
    return this.call('GET', '/outbound-integrations', { query: args });
  }

  listEventTypes(args) {
    return this.call('GET', '/outbound-integrations/event-types', { query: args });
  }

  getOutboundIntegration(args) {
    const { integrationId, orgId } = args;
    return this.call('GET', `/outbound-integrations/${encodeURIComponent(integrationId)}`, { query: { orgId } });
  }

  createOutboundIntegration(args) {
    const { query, rest } = this.splitOrgQuery(args);
    return this.call('POST', '/outbound-integrations', { query, body: rest });
  }

  updateOutboundIntegration(args) {
    const { integrationId, ...remainder } = args;
    const { query, rest } = this.splitOrgQuery(remainder);
    return this.call('PUT', `/outbound-integrations/${encodeURIComponent(integrationId)}`, { query, body: rest });
  }

  deleteOutboundIntegration(args) {
    const { integrationId, orgId } = args;
    return this.call('DELETE', `/outbound-integrations/${encodeURIComponent(integrationId)}`, { query: { orgId } });
  }

  duplicateOutboundIntegration(args) {
    const { integrationId, orgId } = args;
    return this.call('POST', `/outbound-integrations/${encodeURIComponent(integrationId)}/duplicate`, {
      query: { orgId },
    });
  }

  testOutboundIntegration(args) {
    const { integrationId, ...remainder } = args;
    const { query, rest } = this.splitOrgQuery(remainder);
    return this.call('POST', `/outbound-integrations/${encodeURIComponent(integrationId)}/test`, {
      query,
      body: rest,
    });
  }

  validateOutboundTransformation(args) {
    const { query, rest } = this.splitOrgQuery(args);
    return this.call('POST', '/outbound-integrations/validate-transformation', { query, body: rest });
  }

  // ─── Inbound integrations ───────────────────────────────────────────────────

  listInboundIntegrations(args) {
    return this.call('GET', '/inbound-integrations', { query: args });
  }

  getInboundIntegration(args) {
    const { integrationId, orgId } = args;
    return this.call('GET', `/inbound-integrations/${encodeURIComponent(integrationId)}`, { query: { orgId } });
  }

  createInboundIntegration(args) {
    const { query, rest } = this.splitOrgQuery(args);
    return this.call('POST', '/inbound-integrations', { query, body: rest });
  }

  updateInboundIntegration(args) {
    const { integrationId, ...remainder } = args;
    const { query, rest } = this.splitOrgQuery(remainder);
    return this.call('PUT', `/inbound-integrations/${encodeURIComponent(integrationId)}`, { query, body: rest });
  }

  deleteInboundIntegration(args) {
    const { integrationId, orgId } = args;
    return this.call('DELETE', `/inbound-integrations/${encodeURIComponent(integrationId)}`, { query: { orgId } });
  }

  testInboundIntegration(args) {
    const { integrationId, ...remainder } = args;
    const { query, rest } = this.splitOrgQuery(remainder);
    return this.call('POST', `/inbound-integrations/${encodeURIComponent(integrationId)}/test`, { query, body: rest });
  }

  // ─── Scheduled jobs ─────────────────────────────────────────────────────────

  listScheduledJobs(args) {
    return this.call('GET', '/scheduled-jobs', { query: args });
  }

  getScheduledJob(args) {
    const { jobId, orgId } = args;
    return this.call('GET', `/scheduled-jobs/${encodeURIComponent(jobId)}`, { query: { orgId } });
  }

  createScheduledJob(args) {
    const { query, rest } = this.splitOrgQuery(args);
    return this.call('POST', '/scheduled-jobs', { query, body: rest });
  }

  updateScheduledJob(args) {
    const { jobId, ...remainder } = args;
    const { query, rest } = this.splitOrgQuery(remainder);
    return this.call('PUT', `/scheduled-jobs/${encodeURIComponent(jobId)}`, { query, body: rest });
  }

  deleteScheduledJob(args) {
    const { jobId, orgId } = args;
    return this.call('DELETE', `/scheduled-jobs/${encodeURIComponent(jobId)}`, { query: { orgId } });
  }

  executeScheduledJob(args) {
    const { jobId, ...remainder } = args;
    const { query, rest } = this.splitOrgQuery(remainder);
    return this.call('POST', `/scheduled-jobs/${encodeURIComponent(jobId)}/execute`, { query, body: rest });
  }

  testScheduledJobDataSource(args) {
    const { query, rest } = this.splitOrgQuery(args);
    return this.call('POST', '/scheduled-jobs/test-datasource', { query, body: rest });
  }

  listScheduledJobLogs(args) {
    const { jobId, ...remainder } = args;
    const { query, rest } = this.splitOrgQuery(remainder);
    return this.call('GET', `/scheduled-jobs/${encodeURIComponent(jobId)}/logs`, { query: { ...query, ...rest } });
  }

  getScheduledJobLog(args) {
    const { jobId, logId, orgId } = args;
    return this.call('GET', `/scheduled-jobs/${encodeURIComponent(jobId)}/logs/${encodeURIComponent(logId)}`, {
      query: { orgId },
    });
  }
}
