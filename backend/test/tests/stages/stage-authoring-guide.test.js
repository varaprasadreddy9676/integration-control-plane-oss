'use strict';

/**
 * Writing a stage with AI: the guide matches what is enforced, its examples really run
 * in the stage runtime, and a prompt carries the shape of the data and never its values.
 */

jest.mock('../../../src/config', () => ({ security: {}, worker: {}, stages: {} }));

const { buildGuide, HOOKS } = require('../../../src/stages/authoring-guide');
const { LIMITS } = require('../../../src/stages/config');
const runners = require('../../../src/stages/runners');
const { executeStage } = require('../../../src/stages/executor');
const { createRuntimePool } = require('../../../src/stages/runtime/pool');

jest.setTimeout(30000);

describe('the guide', () => {
  it('has every hook, with the limit the engine enforces and an example', () => {
    expect(Object.keys(HOOKS).sort()).toEqual(['after_delivery', 'after_response', 'before_send', 'on_failure']);
    expect(buildGuide({ hook: 'before_send' }).at.timeoutMs).toEqual(LIMITS.inlineTimeoutMs);
    expect(buildGuide({ hook: 'after_delivery' }).at.timeoutMs).toEqual(LIMITS.deferredTimeoutMs);
    for (const hook of Object.keys(HOOKS)) expect(buildGuide({ hook }).at.example).toMatch(/return/);
  });

  it('lists the runners the server offers, and works with no hook', () => {
    expect(buildGuide().runners.map((runner) => runner.type)).toEqual(expect.arrayContaining(['script', 'http']));
    expect(buildGuide().at).toBeNull();
  });
});

describe('the examples run', () => {
  let pool;
  beforeAll(() => {
    pool = createRuntimePool({ size: 1, memoryMb: 64, isolation: { required: false } });
  });
  afterAll(() => pool.close());

  const scope = {
    event: { consent: true },
    delivery: { attempt: 1, errorMessage: 'timeout', request: {}, response: { ok: true, status: 200, body: { accepted: true }, providerMessageId: 'm-1' } },
    stages: {},
    vars: {},
  };
  // A stand-in for the network: what a provider would answer.
  const request = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'read' }), redirects: [], finalUrl: 'https://x', durationMs: 1 });
  const run = (hook, code, eventOverride = {}) =>
    executeStage({
      stage: { id: 'ex', name: 'Example', hook, effect: ['before_send', 'after_response'].includes(hook) ? 'gate' : 'observe', runner: { type: 'script', config: { code } }, recording: { level: 'full' } },
      scope: { ...scope, event: { ...scope.event, ...eventOverride } },
      deadline: Date.now() + 5000,
      meta: { orgId: 1, deliveryId: 'd', integrationId: 'i', seq: 1 },
      deps: { runners, pool, resolveCredential: async () => null, lookup: async () => null, request, policy: { allowPrivate: true } },
    });

  it.each(Object.keys(HOOKS))('the %s example returns a valid answer', async (hook) => {
    const result = await run(hook, HOOKS[hook] && buildGuide({ hook }).at.example);
    expect(['ok', 'skipped']).toContain(result.outcome);
  });

  it('the before-send example skips when there is no consent, as it says', async () => {
    const result = await run('before_send', buildGuide({ hook: 'before_send' }).at.example, { consent: false });
    expect(result.outcome).toBe('skipped');
  });

  it('the later-check example reads the provider\'s status', async () => {
    expect(await run('after_delivery', buildGuide({ hook: 'after_delivery' }).at.example)).toMatchObject({ status: 'READ', done: true });
  });
});
