const { fetch, AbortController } = require('../utils/runtime');
const { validateTargetUrl } = require('../utils/url-check');

/**
 * Pre-delivery checks: fetch URLs that the target will download on its own
 * later (a document link inside a message, an image the target renders...)
 * before the delivery is sent.
 *
 * Many targets accept the request straight away and fetch the linked URL
 * afterwards. When that later fetch is slow or fails, the target reports it
 * out of band and the gateway, having already logged SUCCESS, never retries.
 * Checking the URL first moves that failure back into the delivery attempt,
 * where the normal retry rules apply, and warms any cache the URL's server
 * keeps so the target's own fetch is fast.
 *
 * Outcome per check:
 *  - 2xx and every expectation met         -> pass
 *  - timeout, network error, 408/425/429/5xx -> retryable (normal backoff)
 *  - any other status, or an unmet expectation -> permanent (no retry)
 */

const MAX_CHECKS = 5;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const METHODS = ['GET', 'HEAD'];
const SOURCES = ['request', 'event'];
const ON_MISSING_URL = ['PASS', 'FAIL'];
const RETRYABLE_STATUSES = new Set([408, 425, 429]);

function getByPath(obj, path) {
  return String(path)
    .split('.')
    .reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), obj);
}

/**
 * Returns an error message for an invalid preDeliveryChecks value, or null.
 */
function validatePreDeliveryChecks(checks) {
  if (checks === undefined || checks === null) return null;
  if (!Array.isArray(checks)) return 'preDeliveryChecks must be an array';
  if (checks.length > MAX_CHECKS) return `preDeliveryChecks allows at most ${MAX_CHECKS} checks`;

  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    const label = `preDeliveryChecks[${i}]`;
    if (!check || typeof check !== 'object' || Array.isArray(check)) return `${label} must be an object`;
    if (typeof check.urlPath !== 'string' || !check.urlPath.trim()) return `${label}.urlPath is required`;
    if (check.source !== undefined && !SOURCES.includes(check.source)) {
      return `${label}.source must be one of ${SOURCES.join(', ')}`;
    }
    if (check.method !== undefined && !METHODS.includes(String(check.method).toUpperCase())) {
      return `${label}.method must be one of ${METHODS.join(', ')}`;
    }
    if (check.timeoutMs !== undefined) {
      const timeoutMs = Number(check.timeoutMs);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
        return `${label}.timeoutMs must be between 1000 and ${MAX_TIMEOUT_MS}`;
      }
    }
    if (check.expectedContentTypes !== undefined) {
      if (
        !Array.isArray(check.expectedContentTypes) ||
        check.expectedContentTypes.some((type) => typeof type !== 'string' || !type.trim())
      ) {
        return `${label}.expectedContentTypes must be an array of strings`;
      }
    }
    if (check.minBytes !== undefined) {
      const minBytes = Number(check.minBytes);
      if (!Number.isInteger(minBytes) || minBytes < 0) return `${label}.minBytes must be a non-negative integer`;
    }
    if (check.onMissingUrl !== undefined && !ON_MISSING_URL.includes(check.onMissingUrl)) {
      return `${label}.onMissingUrl must be one of ${ON_MISSING_URL.join(', ')}`;
    }
  }
  return null;
}

function normalizePreDeliveryChecks(checks) {
  if (checks === undefined) return undefined;
  if (!Array.isArray(checks) || checks.length === 0) return null;
  return checks.map((check) => ({
    name: typeof check.name === 'string' && check.name.trim() ? check.name.trim() : check.urlPath.trim(),
    urlPath: check.urlPath.trim(),
    source: check.source || 'request',
    method: String(check.method || 'GET').toUpperCase(),
    timeoutMs: check.timeoutMs !== undefined ? Number(check.timeoutMs) : DEFAULT_TIMEOUT_MS,
    expectedContentTypes: Array.isArray(check.expectedContentTypes)
      ? check.expectedContentTypes.map((type) => type.trim().toLowerCase())
      : [],
    minBytes: check.minBytes !== undefined ? Number(check.minBytes) : 0,
    onMissingUrl: check.onMissingUrl || 'PASS',
  }));
}

function isRetryableStatus(status) {
  return status >= 500 || RETRYABLE_STATUSES.has(status);
}

async function runCheck(check, { requestPayload, eventPayload, urlOptions }) {
  const started = Date.now();
  const source = check.source === 'event' ? eventPayload : requestPayload;
  const url = getByPath(source, check.urlPath);
  const base = { name: check.name, url: typeof url === 'string' ? url : null };

  if (url === undefined || url === null || url === '') {
    if (check.onMissingUrl === 'FAIL') {
      return { ...base, outcome: 'PERMANENT', status: null, durationMs: 0, message: `no URL at ${check.urlPath}` };
    }
    return { ...base, outcome: 'PASS', status: null, durationMs: 0, message: `no URL at ${check.urlPath}; skipped` };
  }
  if (typeof url !== 'string') {
    return { ...base, outcome: 'PERMANENT', status: null, durationMs: 0, message: `${check.urlPath} is not a string` };
  }

  const urlCheck = validateTargetUrl(url, urlOptions);
  if (!urlCheck.valid) {
    return {
      ...base,
      outcome: 'PERMANENT',
      status: null,
      durationMs: 0,
      message: `URL not allowed: ${urlCheck.reason}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), check.timeoutMs);
  try {
    const resp = await fetch(url, { method: check.method, signal: controller.signal, redirect: 'follow' });
    // Read the whole body (GET) so the check covers the full transfer, as the
    // target's own download will, and the server can cache the finished file.
    const body = check.method === 'GET' ? Buffer.from(await resp.arrayBuffer()) : null;
    const durationMs = Date.now() - started;
    const status = resp.status;

    if (status < 200 || status >= 300) {
      return {
        ...base,
        outcome: isRetryableStatus(status) ? 'RETRYABLE' : 'PERMANENT',
        status,
        durationMs,
        message: `HTTP ${status}`,
      };
    }

    const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    if (
      check.expectedContentTypes.length > 0 &&
      !check.expectedContentTypes.some((expected) => contentType.startsWith(expected))
    ) {
      return {
        ...base,
        outcome: 'PERMANENT',
        status,
        durationMs,
        message: `content-type "${contentType || 'none'}" is not one of ${check.expectedContentTypes.join(', ')}`,
      };
    }

    if (body && body.length < check.minBytes) {
      return {
        ...base,
        outcome: 'PERMANENT',
        status,
        durationMs,
        message: `body is ${body.length} bytes, expected at least ${check.minBytes}`,
      };
    }

    return { ...base, outcome: 'PASS', status, durationMs, message: 'ok' };
  } catch (err) {
    const timedOut = err.name === 'AbortError' || controller.signal.aborted;
    return {
      ...base,
      outcome: 'RETRYABLE',
      status: null,
      durationMs: Date.now() - started,
      message: timedOut ? `timed out after ${check.timeoutMs}ms` : `request failed: ${err.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the checks in order and stops at the first one that does not pass.
 * Returns { outcome: 'PASS' | 'RETRYABLE' | 'PERMANENT', results, failed }.
 */
async function runPreDeliveryChecks(checks, context) {
  const results = [];
  for (const check of normalizePreDeliveryChecks(checks) || []) {
    const result = await runCheck(check, context);
    results.push(result);
    if (result.outcome !== 'PASS') {
      return { outcome: result.outcome, results, failed: result };
    }
  }
  return { outcome: 'PASS', results, failed: null };
}

/**
 * The one step every delivery path calls before sending: runs the checks,
 * records the execution step, and returns null when delivery may go ahead.
 * Otherwise returns { retryable, responseStatus, errorMessage }; each path
 * records the outcome with its own retry rules and log shape.
 */
async function checkBeforeDelivery(
  checks,
  { requestPayload, eventPayload, urlOptions, executionLogger, stepMetadata }
) {
  if (!Array.isArray(checks) || checks.length === 0) return null;

  const started = Date.now();
  const result = await runPreDeliveryChecks(checks, { requestPayload, eventPayload, urlOptions });
  if (executionLogger) {
    await executionLogger
      .addStep('pre_delivery_check', {
        status: result.outcome === 'PASS' ? 'success' : 'failed',
        durationMs: Date.now() - started,
        metadata: { ...stepMetadata, results: result.results },
        error: result.failed ? { message: result.failed.message } : null,
      })
      .catch(() => {});
  }
  if (result.outcome === 'PASS') return null;

  return {
    retryable: result.outcome === 'RETRYABLE',
    responseStatus: result.failed.status || 0,
    errorMessage: `Pre-delivery check "${result.failed.name}" failed: ${result.failed.message}`,
  };
}

module.exports = {
  validatePreDeliveryChecks,
  normalizePreDeliveryChecks,
  runPreDeliveryChecks,
  checkBeforeDelivery,
};
