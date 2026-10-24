'use strict';

/**
 * What one integration's legacy configuration becomes as stages, under legacy
 * contracts that reproduce the old behavior (see contracts.js). Pure, apart from
 * the origins a follow-up has called (passed in).
 *
 *   preDeliveryChecks        url-check gate before sending; delivery retries as
 *                            before (allowDeliveryRetry); both send paths ran it
 *   responseTransformation   SCRIPT: a classifier after the response (skip() fails
 *                            the send, shouldRetry resends); SIMPLE: an observer
 *                            mapping (it never affected the delivery)
 *   deliveryFollowUp         a scheduled check with the old schedule and reading;
 *                            errors use up their check, as before
 *
 * What did not run before stays off: the scheduler path (delayed and recurring
 * deliveries) never ran the response transform or the follow-up, so those stages
 * are created switched off and listed. A configuration a legacy contract cannot
 * reproduce is listed as unsupported and left on the old path.
 */

const { normalizePreDeliveryChecks } = require('../../services/pre-delivery-checks');
const { normalizeDeliveryFollowUp, isActive } = require('../../services/delivery-follow-up-config');
const { findPreset } = require('../../services/delivery-follow-up-presets');

const SOURCES = ['preDeliveryChecks', 'responseTransformation', 'deliveryFollowUp'];
const SCHEDULER_MODES = new Set(['DELAYED', 'RECURRING']);
// Recipient fields a provider's delivery report may carry.
const PERSONAL_KEYS = ['to', 'from', 'recipient', 'recipient_id', 'phone', 'mobile', 'msisdn', 'wa_id', 'email'];

const originOf = (url) => {
  try {
    return new URL(String(url)).origin;
  } catch (_error) {
    return null;
  }
};

function hasResponseScript(transformation) {
  if (!transformation || typeof transformation !== 'object') return false;
  if ((transformation.mode || 'SIMPLE') === 'SCRIPT') return typeof transformation.script === 'string' && transformation.script.trim() !== '';
  return Array.isArray(transformation.mappings) && transformation.mappings.length > 0;
}

function preDeliveryStage(checks) {
  const normalized = normalizePreDeliveryChecks(checks);
  return {
    id: 'preDeliveryChecks',
    name: 'Check linked URLs',
    hook: 'before_send',
    effect: 'gate',
    contract: 'legacy:pre-delivery-checks',
    runner: { type: 'url-check', config: { checks: normalized } },
    allowDeliveryRetry: true,
    onError: { action: 'fail_stage' },
    timeoutMs: normalized.reduce((sum, check) => sum + check.timeoutMs, 0) + 5000,
    migratedFrom: 'preDeliveryChecks',
  };
}

function responseStage(transformation) {
  if ((transformation.mode || 'SIMPLE') === 'SCRIPT') {
    return {
      id: 'responseCheck',
      name: 'Response check',
      hook: 'after_response',
      effect: 'gate',
      contract: 'legacy:response-transform',
      runner: { type: 'script', config: { code: transformation.script } },
      allowDeliveryRetry: true,
      // A failing transform script never affected the delivery.
      onError: { action: 'ignore' },
      timeoutMs: 30000,
      migratedFrom: 'responseTransformation',
    };
  }
  return {
    id: 'responseMapping',
    name: 'Response mapping',
    hook: 'after_response',
    effect: 'observe',
    contract: 'legacy:response-transform',
    runner: { type: 'mapping', config: { transformation } },
    onError: { action: 'ignore' },
    timeoutMs: 10000,
    migratedFrom: 'responseTransformation',
  };
}

function followUpStage(config, allowedOrigins) {
  const normalized = normalizeDeliveryFollowUp(config);
  return {
    id: 'deliveryStatus',
    name: 'Delivery status check',
    hook: 'after_delivery',
    effect: 'observe',
    contract: 'legacy:follow-up',
    runner: { type: 'script', config: { code: normalized.script, allowedOrigins } },
    schedule: { checkAfterSeconds: normalized.checkAfterSeconds },
    // An error used up its check and the next one ran, as before.
    onError: { action: 'ignore' },
    timeoutMs: 30000,
    recording: { level: 'full', sensitivePaths: [], sensitiveKeys: PERSONAL_KEYS },
    outputs: [
      { name: 'deliveredAt', type: 'string' },
      { name: 'readAt', type: 'string' },
      { name: 'errorCode', type: 'string' },
      { name: 'errorMessage', type: 'string' },
    ],
    migratedFrom: 'deliveryFollowUp',
  };
}

/**
 * Why an integration's old configuration does not move to stages, or null. The
 * old features ran for single outbound deliveries; an integration with actions
 * keeps its per-action pre-delivery checks and response script where they are
 * (they keep working), and its actions can have stages of their own.
 */
function notMigratable(integration) {
  if (String(integration.direction || 'OUTBOUND').toUpperCase() !== 'OUTBOUND') return 'Only outbound integrations have configuration to migrate';
  if (Array.isArray(integration.actions) && integration.actions.length > 0) {
    return 'An integration with actions keeps its checks and response script on the old path; give its actions stages of their own';
  }
  return null;
}

/**
 * planMigration(integration, { followUpOrigins }) ->
 *   { stages, unsupported: [{ source, reason }], notes: [{ source, note }], sources }
 * `sources` lists the legacy fields the stages take over. Sources that already
 * have a migrated stage are skipped.
 */
function planMigration(integration, { followUpOrigins = [] } = {}) {
  const unsupported = [];
  const notes = [];
  const stages = [];
  const sources = [];
  const notSupported = notMigratable(integration);
  if (notSupported) return { stages, unsupported: [{ source: 'integration', reason: notSupported }], notes, sources };

  const existing = new Set((integration.stages || []).map((stage) => stage && stage.migratedFrom).filter(Boolean));
  const viaScheduler = SCHEDULER_MODES.has(String(integration.deliveryMode || '').toUpperCase());
  const ranNever = (stage, source) => {
    stage.enabled = false;
    notes.push({ source, note: 'Delayed and recurring deliveries never ran this; the stage is created switched off' });
  };

  if (!existing.has('preDeliveryChecks') && Array.isArray(integration.preDeliveryChecks) && integration.preDeliveryChecks.length) {
    stages.push(preDeliveryStage(integration.preDeliveryChecks));
    sources.push('preDeliveryChecks');
  }

  if (!existing.has('responseTransformation') && hasResponseScript(integration.responseTransformation)) {
    const stage = responseStage(integration.responseTransformation);
    if (viaScheduler) ranNever(stage, 'responseTransformation');
    stages.push(stage);
    sources.push('responseTransformation');
  }

  if (!existing.has('deliveryFollowUp') && integration.deliveryFollowUp) {
    const config = integration.deliveryFollowUp;
    const preset = findPreset(integration);
    const origins = preset ? [originOf(integration.targetUrl)] : [...new Set(followUpOrigins.filter(Boolean))];
    const script = typeof config.script === 'string' ? config.script : '';
    const usesHeaders = /context\s*\.\s*headers/.test(script);
    if (script.trim() === '') {
      unsupported.push({ source: 'deliveryFollowUp', reason: 'The follow-up has no script' });
    } else if (usesHeaders && origins.length === 0) {
      unsupported.push({
        source: 'deliveryFollowUp',
        reason: 'The script sends the integration\'s headers, and no provider template or earlier check says where; set the allowed origins by hand',
      });
    } else {
      const stage = followUpStage(config, origins);
      if (!isActive(config)) stage.enabled = false;
      if (viaScheduler) ranNever(stage, 'deliveryFollowUp');
      stages.push(stage);
      sources.push('deliveryFollowUp');
    }
  }

  return { stages, unsupported, notes, sources };
}

/** The origins an integration's follow-up checks have called (from their recorded calls). */
async function followUpOriginsFromHistory(orgId, integrationId, { limit = 200 } = {}) {
  const mongodb = require('../../mongodb');
  const id = mongodb.toObjectId(integrationId);
  if (!id) return [];
  const db = await mongodb.getDbSafe();
  const logs = await db
    .collection('execution_logs')
    .find(
      { orgId, $or: [{ integrationConfigId: id }, { integrationConfigId: String(integrationId) }], 'followUp.history.0': { $exists: true } },
      { projection: { 'followUp.history.httpCalls.url': 1 } }
    )
    .sort({ _id: -1 })
    .limit(limit)
    .toArray();
  const origins = new Set();
  for (const logDoc of logs) {
    for (const check of (logDoc.followUp && logDoc.followUp.history) || []) {
      for (const call of check.httpCalls || []) {
        const origin = originOf(call.url);
        if (origin) origins.add(origin);
      }
    }
  }
  return [...origins];
}

module.exports = { planMigration, followUpOriginsFromHistory, hasResponseScript, SOURCES };
