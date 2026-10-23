'use strict';

/**
 * The stages of one delivery attempt, as both send paths use them (the delivery
 * engine for immediate deliveries, the scheduler worker for delayed and
 * recurring ones):
 *
 *   const stages = createAttemptStages({ integration, evt, orgId, attempt, isTest });
 *   const gate = await stages.beforeSend({ url, method, body });    // after the transform
 *   if (!gate.proceed) -> record gate.status (SKIPPED, FAILED or RETRYING) with gate.message
 *   ...add gate.headers and gate.query to the target request, send it...
 *   const verdict = await stages.afterResponse({ status, headers, body });
 *   if (verdict.failed) -> the send counts as failed (verdict.retry: resending is allowed)
 *   await data.recordLog(orgId, await stages.decorate(payload));   // at every exit
 *   (decorate(payload, { outcome }) when the logged status is not the outcome)
 *   await stages.drain(logId);
 *
 * decorate() adds to the attempt's own log write, so in the same single-document
 * update as its status:
 *   stageRecords  this attempt's inline run records (projected by the drain)
 *   stageIntents  the deferred work the status implies: an accepted send
 *                 (SUCCESS) -> after_delivery stages; a terminal failure (FAILED,
 *                 ABANDONED, including failures before any send) -> on_failure
 * A crash after that write loses nothing: the outbox worker finishes the drain.
 *
 * An integration without enabled stages (or with stages switched off) gets a
 * no-op object, so nothing about its deliveries changes.
 *
 * Shadow stages (stage.shadow, while a migration compares the old path with the
 * new one, see migration/) never act: the send path calls
 *   await stages.shadow(source, { request | response, legacy })
 * right after the old code ran, with what the old code decided; the shadow stage
 * runs, is recorded, and the two decisions are compared. Shadow follow-up jobs are
 * scheduled next to the old follow-up and compared when both have finished.
 */

const config = require('../config');
const { log } = require('../logger');
const { uuidv4 } = require('../utils/runtime');
const { normalizeStage } = require('./config');
const { resolveMap, BindingError } = require('./binding');
const { definitions } = require('./store');
const { runInlineHook } = require('./inline');

const DEFAULT_BUDGET_MS = 5000;
const TERMINAL_FAILURES = new Set(['FAILED', 'ABANDONED']);

const NOOP = Object.freeze({
  active: false,
  hasShadow: () => false,
  beforeSend: async () => ({ proceed: true, headers: {}, query: {} }),
  afterResponse: async () => ({ failed: false }),
  shadow: async () => {},
  decorate: async (payload) => payload,
  drain: async () => {},
});

// Definitions already stored by this process (content-addressed, so never stale).
const savedHashes = new Set();

function switchedOn(integration) {
  return !((config.stages || {}).disabled || integration.stagesPaused);
}

/** The stages that run for this integration now, normalized; [] when switched off. */
function activeStages(integration) {
  if (!switchedOn(integration)) return [];
  return (integration.stages || []).filter((stage) => stage && stage.enabled !== false && !stage.shadow).map(normalizeStage);
}

/** Migrated stages being compared with the old path (they never act). */
function shadowStages(integration) {
  if (!switchedOn(integration)) return [];
  return (integration.stages || []).filter((stage) => stage && stage.enabled !== false && stage.shadow).map(normalizeStage);
}

function parseBody(body) {
  if (typeof body !== 'string') return body === undefined ? null : body;
  try {
    return JSON.parse(body);
  } catch (_error) {
    return body;
  }
}

function defaultDeps() {
  const runners = require('./runners');
  const { getStageRuntime } = require('./runtime');
  const { resolveCredential } = require('./credentials');
  const { admit } = require('./limits');
  return {
    runners,
    pool: getStageRuntime().pool,
    resolveCredential,
    admit,
    policy: { allowPrivate: !(config.security && config.security.blockPrivateNetworks !== false) },
  };
}

function createAttemptStages({ integration, evt = {}, orgId, attempt = 1, isTest = false, deliveryId = null, deps }) {
  const stages = activeStages(integration || {});
  const shadows = shadowStages(integration || {});
  if (stages.length === 0 && shadows.length === 0) return NOOP;

  const runDeps = deps || defaultDeps();
  const hashes = Object.fromEntries([...stages, ...shadows].map((stage) => [stage.id, definitions.definitionHash(orgId, stage)]));
  const budgetMs = Number(integration.stageBudgetMs) || Number((config.stages || {}).inlineBudgetMs) || DEFAULT_BUDGET_MS;
  let budgetDeadline = null;
  let records = [];
  const scope = {
    event: evt.payload === undefined ? {} : evt.payload,
    delivery: { attempt, request: null, response: null },
    stages: {},
    vars: integration.variables || {},
  };
  const meta = {
    orgId,
    deliveryId,
    integrationId: String(integration.id || integration._id || ''),
    integrationRevision: integration.updatedAt ? new Date(integration.updatedAt).toISOString() : null,
    deliveryAttempt: attempt,
  };
  const at = (hook) => stages.filter((stage) => stage.hook === hook);

  async function runHook(hook) {
    if (budgetDeadline === null) budgetDeadline = Date.now() + budgetMs;
    const result = await runInlineHook({ hook, stages: at(hook), integration, scope, budgetDeadline, meta, hashes, deps: runDeps });
    records = records.concat(result.records);
    for (const [stageId, output] of Object.entries(result.outputs)) {
      const record = result.records.filter((r) => r.stage.id === stageId).pop();
      scope.stages[stageId] = { status: record ? record.status : null, output };
    }
    return result;
  }

  async function beforeSend({ url, method, body }) {
    scope.delivery.request = { url, method, body };
    if (at('before_send').length > 0) {
      const result = await runHook('before_send');
      if (result.decision === 'skip') return { proceed: false, status: 'SKIPPED', message: result.message };
      if (result.decision === 'fail') return { proceed: false, status: 'FAILED', message: result.message };
      if (result.decision === 'retry') return { proceed: false, status: 'RETRYING', message: result.message };
    }
    const bindings = (integration.send && integration.send.bindings) || {};
    try {
      return { proceed: true, headers: resolveMap(bindings.headers, scope), query: resolveMap(bindings.query, scope) };
    } catch (error) {
      if (!(error instanceof BindingError)) throw error;
      return { proceed: false, status: 'FAILED', message: `Send binding: ${error.message}` };
    }
  }

  async function afterResponse({ status, headers, body }) {
    scope.delivery.response = { status, headers: headers || {}, body: parseBody(body) };
    if (at('after_response').length === 0) return { failed: false };
    const result = await runHook('after_response');
    if (result.decision === 'fail' || result.decision === 'retry') {
      return { failed: true, retry: result.decision === 'retry', message: result.message };
    }
    return { failed: false };
  }

  /**
   * Run the shadow stage that took over `source` next to the old code, record it,
   * and compare its decision with `legacy` ({ decision, message }, or a promise of
   * it, so both can run at the same time). Never throws, never changes the delivery.
   */
  async function shadow(source, { request, response, legacy }) {
    const stage = shadows.find((candidate) => candidate.migratedFrom === source);
    if (!stage) return;
    try {
      const shadowScope = {
        ...scope,
        delivery: {
          ...scope.delivery,
          request: request || scope.delivery.request,
          response: response ? { status: response.status, headers: response.headers || {}, body: parseBody(response.body) } : scope.delivery.response,
        },
      };
      const result = await runInlineHook({
        hook: stage.hook,
        stages: [stage],
        integration,
        scope: shadowScope,
        budgetDeadline: Date.now() + stage.timeoutMs,
        meta: { ...meta, shadow: true },
        hashes,
        deps: runDeps,
      });
      records = records.concat(result.records);
      const decision = result.decision === 'skip' ? 'continue' : result.decision;
      const legacyDecision = await legacy;
      const { recordComparison } = require('./migration/shadow');
      recordComparison({
        orgId,
        integrationId: meta.integrationId,
        source,
        deliveryId: meta.deliveryId,
        legacy: legacyDecision,
        shadow: { decision, message: result.message || null },
      }).catch((error) => log('warn', 'Shadow comparison not stored', { source, error: error.message }));
    } catch (error) {
      log('warn', 'Shadow stage failed to run', { source, error: error.message });
    }
  }

  async function ensureDefinitionsSaved() {
    for (const stage of [...stages, ...shadows]) {
      const hash = hashes[stage.id];
      if (savedHashes.has(hash)) continue;
      await definitions.saveDefinition(orgId, stage);
      savedHashes.add(hash);
    }
  }

  function intentsFor(payload, outcome) {
    const status = String(outcome || payload.status || '').toUpperCase();
    let hook = null;
    if (status === 'SUCCESS') hook = 'after_delivery';
    else if (TERMINAL_FAILURES.has(status)) hook = 'on_failure';
    if (!hook || isTest) return [];
    // A shadow follow-up is scheduled only where the old follow-up is (to compare them).
    const followUp = integration.deliveryFollowUp;
    const shadowing = hook === 'after_delivery' && followUp && followUp.enabled !== false && Boolean(followUp.script);
    const due = [...at(hook), ...(shadowing ? shadows.filter((stage) => stage.hook === hook) : [])];
    if (due.length === 0) return [];
    const now = new Date().toISOString();
    const input = {
      event: scope.event,
      request: scope.delivery.request || { url: payload.targetUrl, method: payload.httpMethod, body: payload.requestPayload },
      response: scope.delivery.response || {
        status: payload.responseStatus === undefined ? null : payload.responseStatus,
        headers: {},
        body: parseBody(payload.responseBody),
      },
      attempt,
      status,
      errorMessage: payload.errorMessage || null,
      stages: scope.stages,
    };
    // One terminal failure gives all its on_failure intents one failureSeq (see outbox.js).
    const groupId = uuidv4();
    return due.map((stage) => ({
      intentId: uuidv4(),
      groupId,
      hook,
      ...(stage.shadow ? { shadow: true } : {}),
      stageId: stage.id,
      definitionHash: hashes[stage.id],
      integrationId: meta.integrationId,
      integrationRevision: meta.integrationRevision,
      at: now,
      input,
    }));
  }

  /**
   * `outcome` overrides payload.status for deciding deferred work, where a path
   * logs one status but means another (the scheduler logs FAILED for a failure
   * it will retry: not terminal, so no on_failure).
   */
  async function decorate(payload, { outcome } = {}) {
    const intents = intentsFor(payload, outcome);
    const pending = records;
    records = [];
    if (intents.length === 0 && pending.length === 0) return payload;
    await ensureDefinitionsSaved();
    return { ...payload, stageIntents: intents, stageRecords: pending };
  }

  async function drain(logId) {
    if (!logId) return;
    try {
      const { drainLog } = require('./outbox');
      await drainLog(orgId, logId);
    } catch (error) {
      // The outbox worker finishes what this could not.
      log('warn', 'Stage outbox drain deferred', { logId: String(logId), error: error.message });
    }
  }

  return { active: stages.length > 0, hasShadow: (source) => shadows.some((stage) => stage.migratedFrom === source), beforeSend, afterResponse, shadow, decorate, drain };
}

module.exports = { createAttemptStages, activeStages, NOOP };
