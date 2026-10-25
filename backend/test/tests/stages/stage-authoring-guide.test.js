'use strict';

/**
 * Writing a stage with AI: the guide matches what is enforced, its examples really run
 * in the stage runtime, and a prompt carries the shape of the data and never its values.
 */

jest.mock('../../../src/config', () => ({ security: {}, worker: {}, stages: {} }));

const { buildGuide, buildPrompt, shapeOf, HOOKS } = require('../../../src/stages/authoring-guide');
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

describe('a prompt', () => {
  it('turns data into its shape: keys and types, no values', () => {
    expect(shapeOf({ patient: { name: 'Ada Lovelace', phone: '+9198', age: 36 }, tags: ['a', 'b'], note: null, ok: true })).toEqual({
      patient: { name: 'string', phone: 'string', age: 'number' },
      tags: ['string'],
      note: 'null',
      ok: 'boolean',
    });
    expect(shapeOf({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: '{...}' } } } });
  });

  it('says what is wanted, where it runs, the rules, the shapes and the current script, and shares no values', () => {
    const event = { patient: { name: 'Ada Lovelace', phone: '+919800000000' } };
    const prompt = buildPrompt({ hook: 'before_send', goal: 'Skip patients without a phone number', current: 'return null;', samples: { event: shapeOf(event) } });
    expect(prompt).toMatch(/Skip patients without a phone number/);
    expect(prompt).toMatch(/Where it runs: Before send/);
    expect(prompt).toMatch(/skip\(/);
    expect(prompt).toMatch(/Time limit: 3000 ms/);
    expect(prompt).toMatch(/"phone": "string"/);
    expect(prompt).toMatch(/The script now/);
    expect(prompt).not.toMatch(/Lovelace|919800000000/);
  });

  it('works with only a goal', () => {
    expect(buildPrompt({ goal: 'Do something' })).toMatch(/Do something/);
  });
});
