'use strict';

/**
 * Run one stage once: resolve its inputs, resolve its credential, run its runner
 * with every HTTP call going through the recorder, check what it returned, and
 * build the masked run record. No database writes: the caller commits the record
 * (inline: with the delivery log's update for the attempt; deferred: with the
 * job's fenced commit).
 *
 * Resolves (never rejects) to
 *   { record, outcome, status, done, data, decision }
 * where `data` is the validated output, unmasked (bindings need the real values)
 * and `record` is what may be stored and shown. decision:
 *   { failed, retryStage, retryDelivery, uncertain, errorCode }
 */

const { AbortController, uuidv4 } = require('../utils/runtime');
const { createRecorder } = require('./recorder');
const { resolveMap, BindingError } = require('./binding');
const { INLINE_HOOKS } = require('./config');

const STATUS_WORD = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const RESULT_KEYS = new Set(['status', 'done', 'data']);
const LOOKUP_TIMEOUT_MS = 2000;

// Inline records ride on the delivery log until projected; keep them small.
const INLINE_LIMITS = { maxRecordedCalls: 5, maxBodyChars: 8000, maxLogs: 50 };

const typeOf = (value) => (Array.isArray(value) ? 'object' : value === null ? 'null' : typeof value);

function defaultLookup(orgId, value, type) {
  const { resolveLookup } = require('../services/lookup-service');
  let timer;
  return Promise.race([
    resolveLookup(value, type, orgId),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(value), LOOKUP_TIMEOUT_MS);
    }),
  ])
    .catch(() => value)
    .finally(() => clearTimeout(timer));
}

/** Fill {{ credential.<field> }} in the stage's auth headers. */
function credentialHeaders(templates, values) {
  const headers = {};
  for (const [name, template] of Object.entries(templates || {})) {
    let missing = null;
    headers[name] = String(template).replace(/\{\{\s*credential\.([A-Za-z0-9_-]+)\s*\}\}/g, (_m, field) => {
      if (values[field] === undefined || values[field] === null) missing = field;
      return values[field] === undefined || values[field] === null ? '' : String(values[field]);
    });
    if (missing) throw Object.assign(new Error(`The credential has no value for ${missing}`), { code: 'CREDENTIAL_UNAVAILABLE' });
  }
  return headers;
}

/**
 * The stage's credential as { origins, headers }, or null when it has none.
 * `resolveCredential(orgId, auth, integration)` returns the header values:
 * the decrypted credential fields, or the integration's own auth headers.
 */
async function loadCredential(stage, orgId, integration, resolveCredential) {
  if (!stage.auth) return null;
  const resolved = await resolveCredential(orgId, stage.auth, integration);
  if (!resolved) {
    throw Object.assign(new Error('The stage\'s credential is missing, revoked or not filled in'), { code: 'CREDENTIAL_UNAVAILABLE' });
  }
  const headers = stage.auth.source === 'integration' ? resolved : credentialHeaders(stage.auth.headers, resolved);
  return { origins: stage.auth.allowedOrigins, headers };
}

/** The script's { status, done, data }, checked against the stage's declared outputs. */
function readResult(value, stage, declaredOutputs) {
  if (value === undefined || value === null) return { ok: true, status: undefined, done: false, data: {} };
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !RESULT_KEYS.has(key))) {
    return { ok: false, error: 'A stage returns { status, done, data } (or nothing)' };
  }
  let status;
  if (value.status !== undefined && value.status !== null) {
    if (!STATUS_WORD.test(String(value.status))) return { ok: false, error: `"${value.status}" is not a status word (letters, digits and _, up to 32)` };
    status = String(value.status).toUpperCase();
  }
  if (value.done !== undefined && typeof value.done !== 'boolean') return { ok: false, error: 'done is true or false' };
  const data = {};
  const given = value.data === undefined || value.data === null ? {} : value.data;
  if (typeof given !== 'object' || Array.isArray(given)) return { ok: false, error: 'data is an object' };
  for (const output of declaredOutputs) {
    if (!Object.prototype.hasOwnProperty.call(given, output.name) || given[output.name] === null) continue;
    const actual = typeOf(given[output.name]);
    if (actual !== output.type) return { ok: false, error: `Output ${output.name} should be ${output.type}, not ${actual}` };
    data[output.name] = given[output.name];
  }
  // done means "nothing more to wait for": it only matters to scheduled checks.
  return { ok: true, status, done: stage.hook === 'after_delivery' ? value.done === true : false, data };
}

/**
 * meta: { orgId, deliveryId, integrationId, integrationRevision, definitionHash,
 *         seq, executionAttempt, deliveryAttempt, jobId, replayOfRunId, acceptedAt }
 * deps: { runners, pool, resolveCredential, lookup, policy, request, contract }
 */
async function executeStage({ stage, integration = {}, scope, deadline, signal, meta, deps }) {
  const startedAt = Date.now();
  const at = new Date(startedAt).toISOString();
  const runner = deps.runners.get(stage.runner && stage.runner.type);
  const declaredOutputs = (runner && runner.outputs && runner.outputs(stage.runner.config || {})) || stage.outputs || [];
  const inline = INLINE_HOOKS.has(stage.hook);

  let recorder = createRecorder({ level: stage.recording && stage.recording.level, request: deps.request });
  let outcome;
  let errorCode;
  let error;
  let reason;
  let normalized = { status: undefined, done: false, data: {} };
  let decision = { failed: false, retryStage: false, retryDelivery: false };
  let logs = [];

  const controller = new AbortController();
  const timeoutMs = Math.max(1, deadline - Date.now());
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort);

  try {
    const inputs = resolveMap(stage.inputs, scope);
    const credential = await loadCredential(stage, meta.orgId, integration, deps.resolveCredential);
    recorder = createRecorder({
      level: stage.recording && stage.recording.level,
      sensitivePaths: (stage.recording && stage.recording.sensitivePaths) || [],
      credential,
      policy: deps.policy || {},
      request: deps.request,
      limits: inline ? INLINE_LIMITS : {},
      deadline,
    });
    if (!runner) throw Object.assign(new Error(`Unknown runner ${stage.runner && stage.runner.type}`), { code: 'UNKNOWN_RUNNER' });

    const runPromise = runner.run({
      stage,
      scope,
      inputs,
      http: (args, options = {}) => recorder.http(args, { signal: options.signal || controller.signal }),
      lookup: (value, type) => (deps.lookup || defaultLookup)(meta.orgId, value, type),
      pool: deps.pool,
      timeoutMs,
      signal: controller.signal,
      contract: deps.contract || null,
    });
    // The script runtime enforces its own deadline; this bounds every other runner.
    const deadlinePromise = new Promise((resolve) => {
      controller.signal.addEventListener('abort', () =>
        resolve({ outcome: 'timeout', errorCode: 'TIMEOUT', error: `The stage did not finish within ${timeoutMs} ms`, logs: [] })
      );
    });
    const result = await Promise.race([runPromise, deadlinePromise]);
    logs = result.logs || [];

    if (result.outcome === 'ok') {
      const read = readResult(result.value, stage, declaredOutputs);
      if (read.ok) {
        outcome = 'ok';
        normalized = read;
      } else {
        outcome = 'error';
        errorCode = 'BAD_RESULT';
        error = read.error;
      }
    } else if (result.outcome === 'skipped') {
      outcome = 'skipped';
      reason = result.reason || '';
    } else if (result.outcome === 'failed') {
      outcome = 'error';
      errorCode = 'STAGE_FAILED';
      error = result.error || 'The stage failed';
      decision = { failed: true, retryStage: Boolean(result.retryStage), retryDelivery: Boolean(result.retryDelivery) };
    } else {
      outcome = result.outcome === 'timeout' ? 'timeout' : 'error';
      errorCode = result.errorCode || (outcome === 'timeout' ? 'TIMEOUT' : 'ERROR');
      error = result.error || 'The stage failed';
    }
  } catch (caught) {
    outcome = 'error';
    errorCode = caught instanceof BindingError ? 'BINDING_ERROR' : caught.code || 'ERROR';
    error = caught.message;
  } finally {
    clearTimeout(timer);
    controller.abort(); // cancel anything still in flight
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  for (const output of declaredOutputs) {
    if (output.sensitive && normalized.data[output.name] !== undefined) recorder.addSecret(String(normalized.data[output.name]));
  }
  const stored = recorder.finish({
    outcome,
    result: outcome === 'ok' ? { status: normalized.status, done: normalized.done, data: normalized.data } : undefined,
    error,
    logs,
  });

  const record = {
    runId: uuidv4(),
    orgId: meta.orgId,
    deliveryId: meta.deliveryId === undefined || meta.deliveryId === null ? null : String(meta.deliveryId),
    integrationId: meta.integrationId === undefined ? null : String(meta.integrationId),
    integrationRevision: meta.integrationRevision === undefined ? null : meta.integrationRevision,
    stage: {
      id: stage.id,
      definitionHash: meta.definitionHash || null,
      name: stage.name,
      hook: stage.hook,
      runner: stage.runner && stage.runner.type,
    },
    jobId: meta.jobId || null,
    deliveryAttempt: meta.deliveryAttempt || null,
    seq: meta.seq,
    executionAttempt: meta.executionAttempt || 1,
    replayOfRunId: meta.replayOfRunId || null,
    acceptedAt: meta.acceptedAt || null,
    at,
    durationMs: Date.now() - startedAt,
    outcome,
    status: outcome === 'ok' ? normalized.status || null : null,
    done: outcome === 'ok' ? normalized.done : false,
    errorCode: errorCode || null,
    reason: reason === undefined ? null : reason,
    ...stored,
  };

  return {
    record,
    outcome,
    status: record.status,
    done: record.done,
    data: outcome === 'ok' ? normalized.data : {},
    decision: { ...decision, uncertain: recorder.uncertain(), errorCode: errorCode || null },
  };
}

module.exports = { executeStage, readResult, credentialHeaders };
