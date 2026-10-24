'use strict';

/**
 * The stages of one delivery attempt, as every send path uses them (the delivery
 * engine for immediate deliveries and for each action, the scheduler worker for
 * delayed and recurring ones), whatever the delivery sends (HTTP, email, SMS,
 * HL7...):
 *
 *   const stages = createAttemptStages({ integration, actionIndex, evt, orgId, attempt, isTest });
 *   const gate = await stages.beforeSend({ target, method, body });  // after the transform
 *   if (!gate.proceed) -> record gate.status (SKIPPED, FAILED or RETRYING) with gate.message
 *   ...send gate.body (with the Send step's message fields set), adding gate.headers
 *      and gate.query where the request has them (HTTP)...
 *   const verdict = await stages.afterResponse(deliveryResponse({ ... }));  // delivery-shape.js
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
const { targetOf } = require('./targets');
const { deliveryRequest, fromLog } = require('./delivery-shape');

const DEFAULT_BUDGET_MS = 5000;
const TERMINAL_FAILURES = new Set(['FAILED', 'ABANDONED']);

const NOOP = Object.freeze({
  active: false,
  hasShadow: () => false,
  beforeSend: async ({ body } = {}) => ({ proceed: true, headers: {}, query: {}, body }),
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

/**
 * The stages of one delivery (the integration's own, or one action's) that run
 * now, normalized: the acting ones, or with `shadow` the migrated ones being
 * compared with the old path (they never act). [] when switched off.
 */
function deliveryStages(integration, target, shadow = false) {
  if (!target || !switchedOn(integration)) return [];
  return target.stages.filter((stage) => stage && stage.enabled !== false && Boolean(stage.shadow) === shadow).map(normalizeStage);
}

/** A copy of `body` with each { 'path.to.field': value } set (objects are copied, never changed). */
function withFields(body, fields) {
  const entries = Object.entries(fields || {});
  if (entries.length === 0) return body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BindingError('Message fields can only be set on a message that is an object', null);
  }
  const set = (value, [head, ...rest], next) => {
    const base = Array.isArray(value) ? [...value] : { ...(value && typeof value === 'object' ? value : {}) };
    base[head] = rest.length === 0 ? next : set(base[head], rest, next);
    return base;
  };
  return entries.reduce((current, [path, value]) => set(current, path.split('.'), value), body);
}

function createAttemptStages({ integration, actionIndex = null, evt = {}, orgId, attempt = 1, isTest = false, deliveryId = null, deps }) {
  const target = targetOf(integration || {}, actionIndex);
  const stages = deliveryStages(integration || {}, target);
  const shadows = deliveryStages(integration || {}, target, true);
  if (stages.length === 0 && shadows.length === 0) return NOOP;

  const runDeps = deps || require('./executor').executeDeps();
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

  /** `request`: { target, method, body } as the delivery is about to send it. */
  async function beforeSend({ target: to, method, body }) {
    scope.delivery.request = deliveryRequest({ protocol: target.protocol, target: to, method, body });
    if (at('before_send').length > 0) {
      const result = await runHook('before_send');
      if (result.decision === 'skip') return { proceed: false, status: 'SKIPPED', message: result.message };
      if (result.decision === 'fail') return { proceed: false, status: 'FAILED', message: result.message };
      if (result.decision === 'retry') return { proceed: false, status: 'RETRYING', message: result.message };
    }
    const bindings = (target.send && target.send.bindings) || {};
    try {
      return {
        proceed: true,
        headers: resolveMap(bindings.headers, scope),
        query: resolveMap(bindings.query, scope),
        body: withFields(body, resolveMap(bindings.fields, scope)),
      };
    } catch (error) {
      if (!(error instanceof BindingError)) throw error;
      return { proceed: false, status: 'FAILED', message: `Send binding: ${error.message}` };
    }
  }

  /** `response`: what came back, as deliveryResponse() shapes it (the protocol is this delivery's). */
  async function afterResponse(response) {
    scope.delivery.response = { ...response, protocol: target.protocol };
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
          request: request ? deliveryRequest({ protocol: target.protocol, ...request }) : scope.delivery.request,
          response: response ? { ...response, protocol: target.protocol } : scope.delivery.response,
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
    // What this attempt saw; for a send that ended before stages saw it, what the log records.
    const logged = fromLog(payload);
    const input = {
      event: scope.event,
      request: scope.delivery.request || logged.request,
      response: scope.delivery.response || logged.response,
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

module.exports = { createAttemptStages, deliveryStages, withFields, NOOP };
