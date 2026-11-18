'use strict';

/**
 * Data binding, stage configuration rules and the executor (one stage, one run),
 * with the real runtime pool and a fake HTTP transport.
 */

const { resolveTemplate, resolveMap, BindingError } = require('../../../src/stages/binding');
const { validateStages, validateIntegrationStages } = require('../../../src/stages/config');
const runners = require('../../../src/stages/runners');
const { executeStage } = require('../../../src/stages/executor');
const { createRuntimePool } = require('../../../src/stages/runtime/pool');
const { REDACTED } = require('../../../src/stages/mask');

jest.setTimeout(30000);

describe('binding', () => {
  const scopes = {
    event: { patient: { name: 'A' }, ids: [7, 8] },
    delivery: { attempt: 2, response: { body: { id: 'm-1' } } },
    stages: { getToken: { output: { accessToken: 'tok' } } },
    vars: {},
  };

  it('keeps the type of a whole expression and interpolates text', () => {
    expect(resolveTemplate('{{ delivery.attempt }}', scopes)).toBe(2);
    expect(resolveTemplate('{{ event.ids[1] }}', scopes)).toBe(8);
    expect(resolveTemplate('Bearer {{ stages.getToken.output.accessToken }}', scopes)).toBe('Bearer tok');
    expect(resolveTemplate('/m/{{ delivery.response.body.id }}?p={{ event.patient }}', scopes)).toBe('/m/m-1?p={"name":"A"}');
  });

  it('uses the fallback for a missing value, and fails without one', () => {
    expect(resolveTemplate('{{ vars.region ?? "eu" }}', scopes)).toBe('eu');
    expect(resolveTemplate('{{ vars.limit ?? 10 }}', scopes)).toBe(10);
    expect(() => resolveTemplate('{{ vars.region }}', scopes)).toThrow(BindingError);
    expect(() => resolveMap({ a: 'x', b: '{{ event.nope.deeper }}' }, scopes)).toThrow(/event\.nope\.deeper/);
  });

  it('rejects unknown roots, bad paths and object fallbacks', () => {
    expect(() => resolveTemplate('{{ process.env }}', scopes)).toThrow(/must start with/);
    expect(() => resolveTemplate('{{ event.a + 1 }}', scopes)).toThrow(/not a valid path/);
    expect(() => resolveTemplate('{{ event.a ?? {"x":1} }}', scopes)).toThrow(/not valid/);
    expect(() => resolveTemplate('{{ event.a ?? [1] }}', scopes)).toThrow(/fallback/);
  });
});

describe('validateStages', () => {
  const script = (code = 'return { status: "OK" };') => ({ type: 'script', config: { code } });
  const valid = [
    { id: 'getToken', name: 'Get a token', hook: 'before_send', effect: 'gate', runner: script(), outputs: [{ name: 'accessToken', type: 'string', sensitive: true }] },
    { id: 'classify', name: 'Read the reply', hook: 'after_response', runner: script(), inputs: { token: '{{ stages.getToken.output.accessToken }}' } },
    { id: 'statusCheck', name: 'Ask the provider', hook: 'after_delivery', runner: script(), schedule: { checkAfterSeconds: [30, 300, 3600] } },
    { id: 'notify', name: 'Tell the partner', hook: 'on_failure', runner: script() },
  ];

  it('accepts a full pipeline and fills in defaults', () => {
    const result = validateStages(valid, {
      integration: { direction: 'OUTBOUND' },
      send: { bindings: { headers: { Authorization: 'Bearer {{ stages.getToken.output.accessToken }}' } } },
      runners,
    });
    expect(result.errors).toEqual([]);
    expect(result.stages[0]).toMatchObject({ enabled: true, contract: 1, timeoutMs: 3000, onError: { action: 'fail_stage' } });
    expect(result.stages[1]).toMatchObject({ effect: 'observe', onError: { action: 'ignore' } });
    expect(result.stages[2]).toMatchObject({ effect: 'observe', timeoutMs: 15000, onError: { action: 'retry_stage', maxAttempts: 3 } });
  });

  const errorsFor = (stages, extra = {}) =>
    validateStages(stages, { runners, ...extra }).errors.map((e) => `${e.path}: ${e.message}`);

  it.each([
    ['a duplicate ID', [valid[0], { ...valid[3], id: 'getToken' }], /used twice/],
    ['a gate after delivery', [{ ...valid[2], effect: 'gate' }], /can be: observe/],
    ['a scheduled stage without a schedule', [{ ...valid[2], schedule: undefined }], /schedule is required/i],
    ['check times that do not increase', [{ ...valid[2], schedule: { checkAfterSeconds: [300, 30] } }], /must increase/],
    ['a schedule on an inline stage', [{ ...valid[0], schedule: { checkAfterSeconds: [30] } }], /Only stages after delivery/],
    ['an inline observer that retries', [{ ...valid[1], onError: { action: 'retry_stage', maxAttempts: 2 } }], /cannot retry/],
    ['an observer asking to retry the delivery', [{ ...valid[1], allowDeliveryRetry: true }], /Only a gate/],
    ['a reference to a stage that runs later', [{ ...valid[0], inputs: { x: '{{ stages.classify.output.y }}' } }, valid[1]], /does not run before/],
    ['a reference to an undeclared output', [valid[0], { ...valid[1], inputs: { t: '{{ stages.getToken.output.nope }}' } }], /has no output nope/],
    ['an unknown runner', [{ ...valid[3], runner: { type: 'shell', config: {} } }], /Unknown runner/],
    ['an empty script', [{ ...valid[3], runner: script('  ') }], /script is empty/],
    ['an auth header without a credential field', [{ ...valid[3], auth: { credentialRef: 'cred_1', allowedOrigins: ['https://a.test'], headers: { Authorization: 'x' } } }], /credential\.<field>/],
    ['an auth origin that is not an origin', [{ ...valid[3], auth: { source: 'integration', allowedOrigins: ['https://a.test/path'] } }], /allowedOrigins/],
  ])('rejects %s', (_label, stages, pattern) => {
    expect(errorsFor(stages).join('\n')).toMatch(pattern);
  });

  it('validates every delivery of an integration: its own stages, or each action\'s', () => {
    const check = (integration) => validateIntegrationStages(integration, { runners });
    const email = { name: 'Mail', kind: 'COMMUNICATION', communicationConfig: { channel: 'EMAIL' } };
    expect(check({ direction: 'OUTBOUND', actions: [{ name: 'A' }], stages: [valid[3]] }).errors.map((e) => e.message).join()).toMatch(/put stages on each action/);
    expect(check({ direction: 'INBOUND', stages: [valid[3]] }).errors.map((e) => e.message).join()).toMatch(/inbound proxy/);
    const ok = check({ direction: 'INBOUND', actions: [{ ...email, stages: [valid[3]] }] });
    expect(ok.errors).toEqual([]);
    expect(ok.integration.actions[0].stages[0]).toMatchObject({ id: valid[3].id, enabled: true });
    // Error paths say where the stages live; IDs are unique across actions.
    const dup = check({ actions: [{ name: 'A', stages: [valid[3]] }, { ...email, stages: [{ ...valid[3], name: '' }] }] });
    expect(dup.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['actions[1].stages[0].name', 'actions[1].stages[0].id']));
  });

  it('lets the Send step set what the delivery\'s request has: message fields always, headers and query only over HTTP', () => {
    const send = { bindings: { fields: { 'recipient.email': '{{ event.email }}' }, headers: { 'X-A': 'b' } } };
    const email = { kind: 'COMMUNICATION', communicationConfig: { channel: 'EMAIL' } };
    const errors = validateIntegrationStages({ actions: [{ ...email, name: 'Mail', stages: [], send }] }, { runners }).errors;
    expect(errors).toEqual([{ path: 'actions[0].send.bindings.headers', message: expect.stringMatching(/no headers.*fields/) }]);
    expect(validateIntegrationStages({ stages: [], send }, { runners }).errors).toEqual([]);
    expect(errorsFor([], { send: { bindings: { fields: { 'bad path!': 'x' } } } }).join()).toMatch(/not a valid message field name/);
  });

  it('lets the Send step bind only outputs of stages that run before sending', () => {
    const errors = errorsFor(valid, { send: { bindings: { headers: { 'X-Y': '{{ stages.classify.output.z }}' } } } });
    expect(errors.join()).toMatch(/does not run before/);
  });
});

describe('executeStage', () => {
  let pool;
  beforeAll(() => {
    pool = createRuntimePool({ size: 2, memoryMb: 64, isolation: { required: false } });
  });
  afterAll(() => pool.close());

  const meta = { orgId: 5, deliveryId: 'd1', integrationId: 'i1', seq: 1 };
  const scope = { event: { id: 'e1' }, delivery: { attempt: 1, response: { status: 200, body: { id: 'm-1' } } }, stages: {}, vars: {} };
  const deps = (extra = {}) => ({ runners, pool, resolveCredential: async () => null, lookup: async (_o, v) => v, ...extra });
  const scriptStage = (code, extra = {}) => ({
    id: 's1',
    name: 'Stage',
    hook: 'after_delivery',
    effect: 'observe',
    runner: { type: 'script', config: { code } },
    recording: { level: 'full', sensitivePaths: [] },
    outputs: [{ name: 'n', type: 'number' }],
    ...extra,
  });
  const run = (stage, { deps: extraDeps } = {}) =>
    executeStage({ stage, scope, deadline: Date.now() + 5000, meta, deps: deps(extraDeps) });

  it('runs a script with ctx and keeps only declared outputs of the right type', async () => {
    const out = await run(scriptStage('return { status: "delivered", done: true, data: { n: ctx.delivery.attempt + 1, extra: 1 } };'));
    expect(out).toMatchObject({ outcome: 'ok', status: 'DELIVERED', done: true, data: { n: 2 } });
    expect(out.record).toMatchObject({
      orgId: 5,
      deliveryId: 'd1',
      seq: 1,
      outcome: 'ok',
      status: 'DELIVERED',
      stage: { id: 's1', hook: 'after_delivery', runner: 'script' },
      result: { status: 'DELIVERED', done: true, data: { n: 2 } },
    });
    expect(out.record.runId).toEqual(expect.any(String));
  });

  it('a wrong output type or result shape is an error, not silently stored', async () => {
    expect(await run(scriptStage('return { data: { n: "two" } };'))).toMatchObject({ outcome: 'error', decision: { errorCode: 'BAD_RESULT' } });
    expect(await run(scriptStage('return 42;'))).toMatchObject({ outcome: 'error', decision: { errorCode: 'BAD_RESULT' } });
    expect(await run(scriptStage('return { status: "not a word!" };'))).toMatchObject({ outcome: 'error' });
  });

  it('done only counts for scheduled stages', async () => {
    const inline = scriptStage('return { status: "OK", done: true };', { hook: 'after_response' });
    expect(await run(inline)).toMatchObject({ outcome: 'ok', done: false });
  });

  it('fail() is a deliberate failure with its retry wishes; skip() is a skip', async () => {
    const failed = await run(scriptStage('return fail("rejected by partner", { retryStage: true });'));
    expect(failed).toMatchObject({ outcome: 'error', decision: { failed: true, retryStage: true, retryDelivery: false } });
    expect(failed.record.error).toBe('rejected by partner');
    const skipped = await run(scriptStage('return skip("no message id");'));
    expect(skipped).toMatchObject({ outcome: 'skipped', record: { reason: 'no message id' } });
  });

  it('a missing input fails before the runner runs', async () => {
    let called = false;
    const stage = scriptStage('return null;', { inputs: { id: '{{ delivery.response.body.missing }}' } });
    const out = await run(stage, { deps: { request: async () => { called = true; } } });
    expect(out).toMatchObject({ outcome: 'error', decision: { errorCode: 'BINDING_ERROR' } });
    expect(called).toBe(false);
  });

  it('stops at the deadline', async () => {
    const out = await executeStage({
      stage: scriptStage('while (true) {}'),
      scope,
      deadline: Date.now() + 300,
      meta,
      deps: deps(),
    });
    expect(out.outcome).toBe('timeout');
  });

  it('adds the credential only for its origins and never stores it; sensitive outputs are masked in the record only', async () => {
    const seen = [];
    const request = async (args) => {
      seen.push(args);
      return { status: 200, headers: {}, body: '{"token":"abc-123-xyz"}', redirects: [], durationMs: 3 };
    };
    const stage = scriptStage(
      'const r = await http.get("https://api.p.test/token"); log("got", r.data.token); return { data: { token: r.data.token } };',
      {
        outputs: [{ name: 'token', type: 'string', sensitive: true }],
        auth: { credentialRef: 'cred_1', allowedOrigins: ['https://api.p.test'], headers: { 'X-Key': 'K {{ credential.key }}' } },
      }
    );
    const out = await run(stage, { deps: { request, resolveCredential: async () => ({ key: 'secret-key-1' }) } });
    expect(seen[0].credential).toEqual({ origins: ['https://api.p.test'], headers: { 'X-Key': 'K secret-key-1' } });
    expect(out.data.token).toBe('abc-123-xyz'); // bindings get the real value
    const stored = JSON.stringify(out.record);
    expect(stored).not.toMatch(/secret-key-1|abc-123-xyz/);
    expect(out.record.calls[0].requestHeaders['X-Key']).toBe(REDACTED);
  });

  it('a credential that cannot be loaded blocks the stage visibly', async () => {
    const stage = scriptStage('return null;', { auth: { credentialRef: 'cred_gone', allowedOrigins: ['https://a.test'], headers: { A: '{{ credential.k }}' } } });
    expect(await run(stage)).toMatchObject({ outcome: 'error', decision: { errorCode: 'CREDENTIAL_UNAVAILABLE' } });
  });

  it('an http stage extracts, maps a status and says when it is done', async () => {
    const request = async (args) => {
      expect(args.url).toBe('https://api.p.test/messages/m-1?verbose=1');
      return { status: 200, headers: {}, body: JSON.stringify({ message: { state: 'read', phone: '919876543210' } }), redirects: [], durationMs: 5 };
    };
    const stage = {
      id: 'h1',
      name: 'Check',
      hook: 'after_delivery',
      effect: 'observe',
      recording: { level: 'full', sensitivePaths: ['message.phone'] },
      runner: {
        type: 'http',
        config: {
          url: 'https://api.p.test/messages/{{ delivery.response.body.id }}',
          query: { verbose: '1' },
          extract: [{ name: 'state', from: 'response.body.message.state' }],
          status: { from: 'state', map: { read: 'READ', delivered: 'DELIVERED' }, otherwise: 'PENDING' },
          doneWhen: ['READ', 'FAILED'],
        },
      },
    };
    const out = await run(stage, { deps: { request } });
    expect(out).toMatchObject({ outcome: 'ok', status: 'READ', done: true, data: { state: 'read' } });
    expect(JSON.stringify(out.record)).not.toMatch(/919876543210/);
  });

  it('marks a run uncertain when a call that changes something got no answer', async () => {
    const request = async () => {
      throw Object.assign(new Error('No complete response'), { code: 'TIMEOUT' });
    };
    const post = await run(scriptStage('await http.post("https://a.test/x", { a: 1 }); return null;'), { deps: { request } });
    expect(post.decision.uncertain).toBe(true);
    const get = await run(scriptStage('await http.get("https://a.test/x"); return null;'), { deps: { request } });
    expect(get.decision.uncertain).toBe(false);
  });

  it('without a runtime, a script stage fails as not isolated', async () => {
    expect(await run(scriptStage('return null;'), { deps: { pool: null } })).toMatchObject({ outcome: 'error', decision: { errorCode: 'NOT_ISOLATED' } });
  });
});
