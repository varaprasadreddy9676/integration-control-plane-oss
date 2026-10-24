'use strict';

/**
 * Where stages live. Stages belong to a delivery: one send that gets its own
 * delivery log. An integration that sends once keeps its stages on itself
 * (integration.stages, integration.send); an integration with actions sends once
 * per action, so each action keeps its own (actions[i].stages, actions[i].send).
 * Email, SMS, WhatsApp, push, HL7 and HTTP deliveries are all the same to stages.
 *
 * Everything that reads or writes stages of an integration goes through here:
 *   stageTargets(integration)          every delivery that can have stages
 *   targetOf(integration, actionIndex) one of them (null: the integration itself)
 *   allStages(integration)             every stage, across deliveries
 *   findStage(integration, stageId)    { stage, target } (IDs are unique per integration)
 *   stageRunsNow(integration, stage)   may its scheduled work run now (switches, kill switch)
 *   mapTargets(integration, fn)        a copy with fn({ stages, send }, target, index) applied to each
 *   targetsNotSupported(integration)   why stages cannot be configured where they are
 */

// Only an HTTP request has headers and a query string; every delivery has a
// message, whose fields the Send step can set.
const REQUEST_PARTS = { http: ['headers', 'query', 'fields'] };
const DEFAULT_REQUEST_PARTS = ['fields'];

const hasActions = (integration) => Array.isArray(integration && integration.actions) && integration.actions.length > 0;
const isInbound = (integration) => String((integration && integration.direction) || 'OUTBOUND').toUpperCase() === 'INBOUND';

/** The kind of delivery an action (or a single-send integration) makes: http, hl7, email, sms... */
function protocolOf(owner = {}) {
  const kind = String(owner.kind || 'HTTP').toUpperCase();
  if (kind === 'COMMUNICATION') return String((owner.communicationConfig && owner.communicationConfig.channel) || 'message').toLowerCase();
  if (kind === 'HL7_MLLP') return 'hl7';
  return 'http';
}

const requestParts = (protocol) => REQUEST_PARTS[protocol] || DEFAULT_REQUEST_PARTS;

function makeTarget(owner, actionIndex) {
  const protocol = protocolOf(owner);
  return {
    actionIndex,
    path: actionIndex === null ? '' : `actions[${actionIndex}].`,
    name: actionIndex === null ? null : owner.name || `Action ${actionIndex + 1}`,
    protocol,
    requestParts: requestParts(protocol),
    stages: Array.isArray(owner.stages) ? owner.stages : [],
    send: owner.send || null,
  };
}

function stageTargets(integration = {}) {
  if (!hasActions(integration)) return [makeTarget(integration, null)];
  return integration.actions.map((action, index) => makeTarget(action || {}, index));
}

function targetOf(integration = {}, actionIndex = null) {
  if (actionIndex === null || actionIndex === undefined) return makeTarget(integration, null);
  const action = hasActions(integration) ? integration.actions[actionIndex] : null;
  return action ? makeTarget(action, actionIndex) : null;
}

/** Every stage of the integration, wherever it lives (stray integration-level ones included). */
function allStages(integration = {}) {
  const own = hasActions(integration) && Array.isArray(integration.stages) ? integration.stages : [];
  return [...own, ...stageTargets(integration).flatMap((target) => target.stages)].filter(Boolean);
}

function findStage(integration, stageId) {
  if (!integration) return null;
  for (const target of stageTargets(integration)) {
    const stage = target.stages.find((candidate) => candidate && candidate.id === stageId);
    if (stage) return { stage, target };
  }
  return null;
}

/** May a stage's scheduled work run now: the stage, its integration and the kill switch all on. */
function stageRunsNow(integration, stage) {
  const killed = (require('../config').stages || {}).disabled;
  return Boolean(integration && stage) && !killed && integration.isActive !== false && !integration.stagesPaused && stage.enabled !== false;
}

/**
 * A copy of the integration with each delivery's { stages, send } replaced by
 * what `fn({ stages, send }, target, index)` returns (fields it leaves out are kept).
 * `fn` may be async; then so is the result.
 */
function mapTargets(integration, fn) {
  const targets = stageTargets(integration);
  const results = targets.map((target, index) => fn({ stages: target.stages, send: target.send }, target, index));
  const apply = (values) => {
    if (!hasActions(integration)) return { ...integration, ...values[0] };
    return { ...integration, actions: integration.actions.map((action, index) => ({ ...action, ...values[index] })) };
  };
  return results.some((result) => result && typeof result.then === 'function') ? Promise.all(results).then(apply) : apply(results);
}

/** [{ path, message }] for stages configured where no delivery can run them. */
function targetsNotSupported(integration = {}) {
  const problems = [];
  if (hasActions(integration) && Array.isArray(integration.stages) && integration.stages.length > 0) {
    problems.push({ path: 'stages', message: 'This integration sends once per action; put stages on each action' });
  }
  if (isInbound(integration) && !hasActions(integration) && Array.isArray(integration.stages) && integration.stages.length > 0) {
    // An inbound proxy answers its caller while it waits; nothing is delivered later.
    problems.push({ path: 'stages', message: 'Stages run on deliveries; an inbound proxy request is answered while the caller waits' });
  }
  return problems;
}

module.exports = {
  protocolOf,
  requestParts,
  stageTargets,
  targetOf,
  allStages,
  findStage,
  stageRunsNow,
  mapTargets,
  targetsNotSupported,
};
