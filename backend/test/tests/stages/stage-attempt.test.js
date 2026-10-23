'use strict';

/**
 * Inline hooks and the attempt seam the send paths use: gate and observer
 * semantics, the shared budget, Send bindings, and what an attempt writes to its
 * delivery log (inline records and outbox intents).
 */

const store = require('../../../src/stages/store');
const runners = require('../../../src/stages/runners');
const { createAttemptStages, NOOP } = require('../../../src/stages/attempt');
const { createRuntimePool } = require('../../../src/stages/runtime/pool');

jest.setTimeout(30000);

let pool;
beforeAll(() => {
  pool = createRuntimePool({ size: 2, memoryMb: 64, isolation: { required: false } });
  jest.spyOn(store.definitions, 'saveDefinition').mockResolvedValue('hash');
});
afterAll(() => {
  pool.close();
  jest.restoreAllMocks();
});

const deps = (extra = {}) => ({ runners, pool, resolveCredential: async () => null, lookup: async (_o, v) => v, ...extra });
const script = (id, hook, code, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code } }, ...extra });
const integrationWith = (stages, extra = {}) => ({ id: 'int1', name: 'X', stages, ...extra });
const attemptFor = (integration, extra = {}) =>
  createAttemptStages({ integration, evt: { payload: { patientId: 'p1' } }, orgId: 9, attempt: 1, deps: deps(extra.deps), ...extra.options });

describe('an integration without stages', () => {
  it('gets the no-op seam, so nothing about its deliveries changes', async () => {
    expect(attemptFor(integrationWith([]))).toBe(NOOP);
    expect(attemptFor(integrationWith([script('a', 'before_send', 'return null;', { enabled: false })]))).toBe(NOOP);
    expect(attemptFor(integrationWith([script('a', 'before_send', 'return null;')], { stagesPaused: true }))).toBe(NOOP);
    const payload = { status: 'SUCCESS' };
    expect(await NOOP.decorate(payload)).toBe(payload);
  });
});

describe('before_send', () => {
  it('a gate that passes lets the send go on, and its outputs fill the Send bindings', async () => {
    const integration = integrationWith(
      [script('getToken', 'before_send', 'return { data: { token: "t-" + ctx.event.patientId } };', { effect: 'gate', outputs: [{ name: 'token', type: 'string' }] })],
      { send: { bindings: { headers: { Authorization: 'Bearer {{ stages.getToken.output.token }}' }, query: { p: '{{ event.patientId }}' } } } }
    );
    const gate = await attemptFor(integration).beforeSend({ url: 'https://t.test', method: 'POST', body: { a: 1 } });
    expect(gate).toEqual({ proceed: true, headers: { Authorization: 'Bearer t-p1' }, query: { p: 'p1' } });
  });

  it('a gate sees the transformed request; skip() skips the delivery; fail() fails it', async () => {
    const skipping = integrationWith([script('g', 'before_send', 'return ctx.delivery.request.body.ok ? null : skip("not ready");', { effect: 'gate' })]);
    expect(await attemptFor(skipping).beforeSend({ url: 'u', method: 'POST', body: { ok: true } })).toMatchObject({ proceed: true });
    expect(await attemptFor(skipping).beforeSend({ url: 'u', method: 'POST', body: { ok: false } })).toMatchObject({
      proceed: false,
      status: 'SKIPPED',
      message: 'g: not ready',
    });
    const failing = integrationWith([script('g', 'before_send', 'return fail("consent missing");', { effect: 'gate' })]);
    expect(await attemptFor(failing).beforeSend({ url: 'u', method: 'POST', body: {} })).toMatchObject({ proceed: false, status: 'FAILED' });
  });

  it('gate errors fail closed; the delivery retries only when the stage allows it', async () => {
    const broken = (extra) => integrationWith([script('g', 'before_send', 'throw new Error("check API down");', { effect: 'gate', ...extra })]);
    expect(await attemptFor(broken()).beforeSend({ url: 'u', method: 'POST', body: {} })).toMatchObject({ proceed: false, status: 'FAILED' });
    expect(await attemptFor(broken({ allowDeliveryRetry: true })).beforeSend({ url: 'u', method: 'POST', body: {} })).toMatchObject({
      proceed: false,
      status: 'RETRYING',
    });
    expect(await attemptFor(broken({ onError: { action: 'ignore' } })).beforeSend({ url: 'u', method: 'POST', body: {} })).toMatchObject({ proceed: true });
  });

  it('an observer that fails never stops the delivery, and later stages still run', async () => {
    const integration = integrationWith([
      script('watch', 'before_send', 'throw new Error("oops");'),
      script('g', 'before_send', 'return { status: "CHECKED" };', { effect: 'gate' }),
    ]);
    const attempt = attemptFor(integration);
    expect(await attempt.beforeSend({ url: 'u', method: 'POST', body: {} })).toMatchObject({ proceed: true });
    const decorated = await attempt.decorate({ status: 'SUCCESS' });
    expect(decorated.stageRecords.map((r) => [r.stage.id, r.outcome])).toEqual([
      ['watch', 'error'],
      ['g', 'ok'],
    ]);
  });

  it('a gate with retry_stage repeats at once within the budget', async () => {
    const integration = integrationWith([
      script('g', 'before_send', 'return ctx.run ? null : fail("flaky", { retryStage: true });', {
        effect: 'gate',
        onError: { action: 'retry_stage', maxAttempts: 3 },
      }),
    ]);
    const attempt = attemptFor(integration);
    expect(await attempt.beforeSend({ url: 'u', method: 'POST', body: {} })).toMatchObject({ proceed: false, status: 'FAILED' });
    const { stageRecords } = await attempt.decorate({ status: 'FAILED' });
    expect(stageRecords.map((r) => r.executionAttempt)).toEqual([1, 2, 3]);
  });

  it('all inline stages share one budget: a slow first stage leaves the next out of time', async () => {
    const integration = integrationWith(
      [
        script('slow', 'before_send', 'await new Promise((r) => setTimeout(r, 400)); return null;', { timeoutMs: 2000 }),
        script('g', 'before_send', 'return null;', { effect: 'gate', timeoutMs: 2000 }),
      ],
      { stageBudgetMs: 300 }
    );
    const result = await attemptFor(integration).beforeSend({ url: 'u', method: 'POST', body: {} });
    expect(result).toMatchObject({ proceed: false, status: 'FAILED' });
    expect(result.message).toMatch(/g:/);
  });

  it('a Send binding to a missing value fails the delivery before sending', async () => {
    const integration = integrationWith([script('w', 'before_send', 'return null;')], {
      send: { bindings: { headers: { 'X-Id': '{{ event.notThere }}' } } },
    });
    expect(await attemptFor(integration).beforeSend({ url: 'u', method: 'POST', body: {} })).toMatchObject({
      proceed: false,
      status: 'FAILED',
      message: expect.stringMatching(/Send binding/),
    });
  });
});

describe('after_response', () => {
  const classifier = (code, extra) => integrationWith([script('c', 'after_response', code, { effect: 'gate', ...extra })]);

  it('a classifier can turn an accepted send into a failure, without resending', async () => {
    const attempt = attemptFor(classifier('return ctx.delivery.response.body.ok ? null : fail("rejected: " + ctx.delivery.response.body.reason);'));
    expect(await attempt.afterResponse({ status: 200, headers: {}, body: '{"ok":false,"reason":"bad number"}' })).toEqual({
      failed: true,
      retry: false,
      message: 'c: rejected: bad number',
    });
  });

  it('resends only with an explicit policy and an explicit request', async () => {
    const code = 'return fail("try later", { retryDelivery: true });';
    expect(await attemptFor(classifier(code)).afterResponse({ status: 200, body: '{}' })).toMatchObject({ failed: true, retry: false });
    expect(await attemptFor(classifier(code, { allowDeliveryRetry: true })).afterResponse({ status: 200, body: '{}' })).toMatchObject({ failed: true, retry: true });
  });

  it('an error of the classifier itself never resends, even when allowed', async () => {
    const attempt = attemptFor(classifier('throw new Error("parser broke");', { allowDeliveryRetry: true }));
    expect(await attempt.afterResponse({ status: 200, body: '{}' })).toMatchObject({ failed: true, retry: false });
  });

  it('skip() means no opinion: the answer stands', async () => {
    expect(await attemptFor(classifier('return skip("not mine");')).afterResponse({ status: 200, body: '{}' })).toEqual({ failed: false });
  });
});

describe('what an attempt writes to its delivery log', () => {
  const pipeline = integrationWith([
    script('pre', 'before_send', 'return { status: "OK", data: { n: 1 } };', { outputs: [{ name: 'n', type: 'number' }] }),
    script('check', 'after_delivery', 'return null;', { schedule: { checkAfterSeconds: [30] } }),
    script('notifyA', 'on_failure', 'return null;'),
    script('notifyB', 'on_failure', 'return null;'),
  ]);

  it('an accepted send carries its inline records and after_delivery intents with the context they need', async () => {
    const attempt = attemptFor(pipeline);
    await attempt.beforeSend({ url: 'https://t.test', method: 'POST', body: { a: 1 } });
    await attempt.afterResponse({ status: 202, headers: {}, body: '{"id":"m-1"}' });
    const payload = await attempt.decorate({ status: 'SUCCESS', responseStatus: 202 });
    expect(payload.stageRecords).toHaveLength(1);
    expect(payload.stageIntents).toEqual([
      expect.objectContaining({
        hook: 'after_delivery',
        stageId: 'check',
        definitionHash: expect.any(String),
        input: expect.objectContaining({
          event: { patientId: 'p1' },
          request: { url: 'https://t.test', method: 'POST', body: { a: 1 } },
          response: { status: 202, headers: {}, body: { id: 'm-1' } },
          stages: { pre: { status: 'OK', output: { n: 1 } } },
        }),
      }),
    ]);
    expect(store.definitions.saveDefinition).toHaveBeenCalled();
  });

  it('a terminal failure carries one intent per on_failure stage, all in one group', async () => {
    const payload = await attemptFor(pipeline).decorate({ status: 'ABANDONED', responseStatus: 503, responseBody: 'down', errorMessage: 'Server error' });
    expect(payload.stageIntents.map((i) => i.stageId)).toEqual(['notifyA', 'notifyB']);
    expect(new Set(payload.stageIntents.map((i) => i.groupId)).size).toBe(1);
    expect(payload.stageIntents[0].input).toMatchObject({ status: 'ABANDONED', errorMessage: 'Server error', response: { status: 503, body: 'down' } });
  });

  it('a retrying attempt or a test event schedules nothing; records are written once', async () => {
    const attempt = attemptFor(pipeline);
    await attempt.beforeSend({ url: 'u', method: 'POST', body: {} });
    const retrying = await attempt.decorate({ status: 'RETRYING' });
    expect(retrying.stageIntents).toEqual([]);
    expect(retrying.stageRecords).toHaveLength(1);
    expect(await attempt.decorate({ status: 'RETRYING' })).toEqual({ status: 'RETRYING' });
    const test = attemptFor(pipeline, { options: { isTest: true } });
    expect(await test.decorate({ status: 'SUCCESS' })).toEqual({ status: 'SUCCESS' });
  });
});
