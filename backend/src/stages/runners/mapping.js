'use strict';

/**
 * The built-in `mapping` runner, used only by migrated configurations: a SIMPLE
 * response transformation (field mappings, then lookups) run in the parent with
 * the existing transformer code. On an outbound delivery the old transform's
 * result was never used for anything but a skip, which SIMPLE mode cannot
 * produce, so this runs as an observer: it shows the mapped answer, nothing more.
 */

function validate(runnerConfig) {
  const transformation = runnerConfig.transformation;
  if (!transformation || typeof transformation !== 'object') return [{ path: 'transformation', message: 'The mapping is missing' }];
  return [];
}

async function run(ctx) {
  // Loaded when used: the transformer reaches into data/, which loads the stages.
  const { applySimpleTransform } = require('../../services/transformer');
  const { applyLookups } = require('../../services/lookup-service');
  const transformation = ctx.stage.runner.config.transformation;
  const response = ctx.scope.delivery.response || {};
  const event = { orgId: ctx.orgId, orgUnitRid: ctx.orgUnitRid };
  try {
    let mapped = await applySimpleTransform(response.body, transformation, event);
    if (Array.isArray(transformation.lookups) && transformation.lookups.length > 0) {
      mapped = await applyLookups(mapped, transformation.lookups, event);
    }
    return { outcome: 'ok', value: { status: 'MAPPED', data: { mapped } }, logs: [] };
  } catch (error) {
    return { outcome: 'error', errorCode: 'MAPPING_FAILED', error: error.message, logs: [] };
  }
}

module.exports = {
  type: 'mapping',
  label: 'Field mapping (migrated)',
  internal: true,
  hooks: ['after_response'],
  configSchema: { fields: [{ name: 'transformation', label: 'Mapping', widget: 'code', language: 'json', readOnly: true }] },
  presentation: { icon: 'script', summary: [], mayDecide: false, outputs: {} },
  validate,
  outputs: () => [{ name: 'mapped', type: 'object' }],
  outcomes: () => ({ statuses: [{ status: 'MAPPED', done: false }] }),
  run,
};
