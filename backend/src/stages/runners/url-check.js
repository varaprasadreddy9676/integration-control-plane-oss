'use strict';

/**
 * The `url-check` runner: today's pre-delivery URL checks (services/pre-delivery-checks.js),
 * unchanged, as a before_send gate. It fetches URLs the target will download on
 * its own (a document link inside the message...) and stops the delivery when one
 * is not ready:
 *   pass                                   -> ok, status PASS
 *   timeout, network error, 408/425/429/5xx -> fail(..., { retryDelivery: true })
 *   any other status, or an unmet check    -> fail(...) (permanent)
 * A delivery retry needs the stage's allowDeliveryRetry, which migrated stages
 * set, as the old checks retried. The checks' own HTTP (redirects followed, the
 * target URL validator) is kept as it was.
 */

const config = require('../../config');
const { validatePreDeliveryChecks, runPreDeliveryChecks } = require('../../services/pre-delivery-checks');

function validate(runnerConfig) {
  const problem = validatePreDeliveryChecks(runnerConfig.checks);
  if (problem) return [{ path: 'checks', message: problem }];
  if (!Array.isArray(runnerConfig.checks) || runnerConfig.checks.length === 0) return [{ path: 'checks', message: 'Add at least one URL to check' }];
  return [];
}

async function run(ctx) {
  const request = ctx.scope.delivery.request || {};
  const result = await runPreDeliveryChecks(ctx.stage.runner.config.checks, {
    requestPayload: request.body,
    eventPayload: ctx.scope.event,
    urlOptions: config.security,
  });
  const logs = result.results.map((check) => ({
    level: check.outcome === 'PASS' ? 'info' : 'warn',
    message: `${check.name}: ${check.outcome} ${check.status === null ? '' : `HTTP ${check.status} `}(${check.durationMs} ms) ${check.message}`.trim(),
    at: new Date().toISOString(),
  }));
  if (result.outcome === 'PASS') return { outcome: 'ok', value: { status: 'PASS', data: { results: result.results } }, logs };
  return {
    outcome: 'failed',
    error: `Pre-delivery check "${result.failed.name}" failed: ${result.failed.message}`,
    retryStage: false,
    retryDelivery: result.outcome === 'RETRYABLE',
    logs,
  };
}

module.exports = {
  type: 'url-check',
  label: 'Check linked URLs',
  hooks: ['before_send'],
  configSchema: {
    fields: [
      {
        name: 'checks',
        label: 'URLs to check',
        widget: 'rows',
        columns: [
          { name: 'name', label: 'Name', widget: 'text' },
          { name: 'urlPath', label: 'URL at (path)', widget: 'text', placeholder: 'document.link' },
          { name: 'source', label: 'In', widget: 'select', options: ['request', 'event'], default: 'request' },
          { name: 'method', label: 'Method', widget: 'select', options: ['GET', 'HEAD'], default: 'GET' },
          { name: 'expectedContentTypes', label: 'Content types', widget: 'tags' },
          { name: 'minBytes', label: 'Min bytes', widget: 'text', valueType: 'number' },
          { name: 'onMissingUrl', label: 'When there is no URL', widget: 'select', options: ['PASS', 'FAIL'], default: 'PASS' },
        ],
      },
    ],
  },
  validate,
  outputs: () => [{ name: 'results', type: 'object' }],
  outcomes: () => ({
    statuses: [{ status: 'PASS', done: false }],
    fails: [
      { reason: 'A linked URL is not ready', retryDelivery: true, retryStage: false },
      { reason: 'A linked URL failed its check', retryDelivery: false, retryStage: false },
    ],
  }),
  run,
};
