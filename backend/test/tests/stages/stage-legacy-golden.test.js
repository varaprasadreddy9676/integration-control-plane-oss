'use strict';

/**
 * Golden tests: each legacy configuration runs through the old code and, as the
 * migration plans it, through the stages engine, against the same local
 * provider. Their observable effects must match: the follow-up's status and
 * done after each check, the pre-delivery decision and message, the response
 * transform's failure and retry decision.
 *
 * Deliberate differences (by design, see docs/architecture/pipeline-stages.md):
 * credentials sent to an origin that is not allowed fail visibly instead of
 * leaking; a switched-off follow-up pauses instead of ending as NOT_TRACKED.
 */

const http = require('http');

const mockQueue = { saveCheck: jest.fn(), markLog: jest.fn(), enqueue: jest.fn() };
jest.mock('../../../src/data/delivery-follow-ups', () => mockQueue);
const mockGetIntegration = jest.fn();
jest.mock('../../../src/data', () => ({ getIntegration: (...args) => mockGetIntegration(...args) }));

const config = require('../../../src/config');
const { processFollowUp } = require('../../../src/services/delivery-follow-up');
const { checkBeforeDelivery } = require('../../../src/services/pre-delivery-checks');
const transformer = require('../../../src/services/transformer');
const { planMigration } = require('../../../src/stages/migration/plan');
const { normalizeStage } = require('../../../src/stages/config');
const { executeStage } = require('../../../src/stages/executor');
const { runInlineHook } = require('../../../src/stages/inline');
const { nextJobState } = require('../../../src/stages/schedule');
const { findPreset } = require('../../../src/services/delivery-follow-up-presets');
const runners = require('../../../src/stages/runners');
const { createRuntimePool } = require('../../../src/stages/runtime/pool');
const { resolveCredential } = require('../../../src/stages/credentials');

jest.setTimeout(60000);

const API_KEY = 'k-golden-secret';
let server;
let base;
let pool;
let dlrAnswer = null;

beforeAll(async () => {
  config.security = { ...(config.security || {}), blockPrivateNetworks: false };
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/dlr') {
      if (req.headers['x-api-key'] !== API_KEY) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end('{"error":"no key"}');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(dlrAnswer));
    }
    const docs = {
      '/doc/ok': [200, 'application/pdf', 2048],
      '/doc/err': [503, 'text/plain', 10],
      '/doc/gone': [404, 'text/plain', 10],
      '/doc/html': [200, 'text/html', 2048],
      '/doc/small': [200, 'application/pdf', 10],
    };
    const doc = docs[url.pathname];
    if (url.pathname === '/doc/slow') {
      return setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end(Buffer.alloc(2048));
      }, 1500);
    }
    if (!doc) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(doc[0], { 'content-type': doc[1] });
    return res.end(Buffer.alloc(doc[2], 1));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  pool = createRuntimePool({ size: 2, memoryMb: 64, isolation: { required: false } });
});
afterAll(async () => {
  pool.close();
  await new Promise((resolve) => server.close(resolve));
});

const deps = () => ({ runners, pool, resolveCredential, policy: { allowPrivate: true }, lookup: async (_o, value) => value });

describe('delivery follow-up', () => {
  const qikchatScript = () => findPreset({ targetUrl: 'https://api.qikchat.in/x' }).config.script.replace('https://api.qikchat.in/v1/messages', `${base}/dlr`);
  const integrationWith = (script, extra = {}) => ({
    id: 'int-g',
    orgId: 7,
    name: 'G',
    eventType: 'APPT',
    targetUrl: `${base}/send`,
    outgoingAuthType: 'API_KEY',
    outgoingAuthConfig: { headerName: 'X-Api-Key', apiKey: API_KEY },
    deliveryFollowUp: { enabled: true, script, checkAfterSeconds: [30, 300, 3600, 86400] },
    ...extra,
  });
  const sendResponse = { status: 200, data: [{ id: 'm-1' }] };
  const dlr = (status) => ({ status: true, message: { payload: { message: { status, deliveredAt: '2026-10-23T10:00:05Z' } } } });

  async function runOld(integration, answers, response = sendResponse) {
    mockGetIntegration.mockResolvedValue(integration);
    let job = { _id: 'j1', orgId: 7, logId: 'l1', integrationId: 'int-g', eventType: 'APPT', sentAt: new Date('2026-10-23T10:00:00Z'), delivery: { statusCode: 200, response }, checkIndex: 0, deliveryStatus: 'PENDING', history: [] };
    const seen = [];
    for (let check = 1; check <= 4; check += 1) {
      dlrAnswer = answers(check);
      mockQueue.saveCheck.mockClear();
      mockQueue.markLog.mockClear();
      await processFollowUp(job, new Date('2026-10-24T10:00:00Z'));
      job = { ...job, ...mockQueue.saveCheck.mock.calls[0][1] };
      const marked = mockQueue.markLog.mock.calls[0][2];
      seen.push({ status: marked.status, done: marked.done, errored: Boolean(marked.lastError) });
      if (marked.done) break;
    }
    return seen;
  }

  async function runNew(integration, answers, response = sendResponse, followUpOrigins = []) {
    const planned = planMigration(integration, { followUpOrigins }).stages.find((stage) => stage.id === 'deliveryStatus');
    const stage = normalizeStage(planned);
    let job = { seq: 1, executionAttempt: 1, checksDone: 0, acceptedAt: new Date(), lastStatus: null };
    let status = null;
    const seen = [];
    for (let guard = 0; guard < 4; guard += 1) {
      dlrAnswer = answers(job.seq);
      const result = await executeStage({
        stage,
        integration,
        scope: {
          event: {},
          delivery: { response: { status: 200, body: response }, acceptedAt: job.acceptedAt },
          stages: {},
          vars: {},
          run: { seq: job.seq, executionAttempt: 1, of: 4, lastStatus: job.lastStatus },
        },
        deadline: Date.now() + stage.timeoutMs,
        meta: { orgId: 7, deliveryId: 'l1', integrationId: 'int-g', seq: job.seq },
        deps: deps(),
      });
      if (result.status) status = result.status; // stage_state keeps the last status through failed runs
      // Make every slot due, so each check runs in turn (the old path did not skip slots here).
      const { set } = nextJobState({ job, stage, result, now: new Date(job.acceptedAt.getTime() + 1000) });
      seen.push({
        status: status || 'PENDING',
        done: set.state !== 'PENDING',
        errored: result.outcome === 'error',
        error: result.outcome === 'error' ? result.record.error : undefined,
      });
      if (set.state !== 'PENDING') break;
      job = { ...job, ...set, lastStatus: status };
    }
    return seen;
  }

  // Same status and done after every check, and an error exactly where the old path had one.
  const same = (oldRun, newRun) => expect(newRun.map(({ status, done, errored }) => ({ status, done, errored }))).toEqual(oldRun);

  it.each([
    ['processing, delivered, read', (n) => dlr(['processing', 'delivered', 'read'][n - 1])],
    ['processing at every check (exhausted)', () => dlr('processing')],
    ['failed at once', () => dlr('failed')],
  ])('the Qikchat script: %s', async (_label, answers) => {
    const integration = integrationWith(qikchatScript(), { targetUrl: 'https://api.qikchat.in/v1/messages' });
    // The preset's own origin is allowed; the test provider is on localhost, so allow it too.
    const oldRun = await runOld(integration, answers);
    const newRun = await runNew({ ...integration }, answers, sendResponse, []);
    expect(oldRun.length).toBeGreaterThan(0);
    // The preset is recognized by the target host: its allowed origin is api.qikchat.in, so
    // run the new path with the local provider's origin allowed as the preset's would be.
    const local = await runNew(integrationWith(qikchatScript()), answers, sendResponse, [base]);
    same(oldRun, local);
    expect(newRun[0].error).toMatch(/Not supported: this script sends the integration's credentials/);
  });

  it('a send response without a message id: not tracked, done', async () => {
    const integration = integrationWith(qikchatScript());
    const noId = { status: 200, data: [] };
    same(await runOld(integration, () => dlr('read'), noId), await runNew(integration, () => dlr('read'), noId, [base]));
  });

  it('a script that never knows: PENDING, then UNKNOWN when the checks run out', async () => {
    const integration = integrationWith('return null;');
    same(await runOld(integration, () => null), await runNew(integration, () => null, sendResponse, [base]));
  });

  it('status words are normalized; a known status is never replaced by PENDING', async () => {
    const script = `const n = delivery.check;
      if (n === 1) return 'in-progress';
      if (n === 2) return { status: 'delivered', done: false };
      return null;`;
    const integration = integrationWith(script);
    same(await runOld(integration, () => null), await runNew(integration, () => null, sendResponse, [base]));
  });

  it('an error uses up its check and the next one runs; the known status stays', async () => {
    const script = `const res = await http.get('${base}/dlr?msgid=m-1', { headers: context.headers });
      if (delivery.check === 2) throw new Error('provider hiccup');
      return { status: res.data.message.payload.message.status };`;
    const integration = integrationWith(script);
    const answers = (n) => dlr(['sent', 'sent', 'read'][n - 1]);
    same(await runOld(integration, answers), await runNew(integration, answers, sendResponse, [base]));
  });

  it('utility functions and mutable inputs behave as before', async () => {
    const script = `payload.extra = uppercase('x'); const e = epoch('2026-10-23T10:00:00Z');
      return { status: e === 1792749600 && delivery.extra === 'X' ? 'OK' : 'WRONG', done: true };`;
    const integration = integrationWith(script);
    same(await runOld(integration, () => null), await runNew(integration, () => null, sendResponse, [base]));
  });
});

describe('pre-delivery checks', () => {
  const checksFor = (path, extra = {}) => [{ name: 'Doc', urlPath: 'document.link', timeoutMs: 1000, ...extra }].map((check) => ({ ...check, path }));
  async function compare(checks, payload) {
    const old = await checkBeforeDelivery(checks, { requestPayload: payload, eventPayload: {}, urlOptions: config.security });
    const stage = normalizeStage(planMigration({ direction: 'OUTBOUND', preDeliveryChecks: checks }).stages[0]);
    const result = await runInlineHook({
      hook: 'before_send',
      stages: [stage],
      integration: {},
      scope: { event: {}, delivery: { request: { body: payload } }, stages: {}, vars: {} },
      budgetDeadline: Date.now() + 50,
      meta: { orgId: 7, deliveryAttempt: 1 },
      deps: deps(),
    });
    const oldDecision = old === null ? 'continue' : old.retryable ? 'retry' : 'fail';
    expect(result.decision).toBe(oldDecision);
    if (old) expect(result.message).toBe(old.errorMessage);
  }

  it.each([
    ['a ready document', '/doc/ok', {}],
    ['a server error (retried)', '/doc/err', {}],
    ['a missing document (permanent)', '/doc/gone', {}],
    ['the wrong content type', '/doc/html', { expectedContentTypes: ['application/pdf'] }],
    ['too small', '/doc/small', { minBytes: 100 }],
    ['too slow (retried), outside the shared budget', '/doc/slow', {}],
  ])('%s', async (_label, path, extra) => {
    await compare(checksFor(path, extra), { document: { link: `${base}${path}` } });
  });

  it('no URL: passes by default, fails when told to', async () => {
    await compare(checksFor('/x'), {});
    await compare(checksFor('/x', { onMissingUrl: 'FAIL' }), {});
  });
});

describe('response transform (script)', () => {
  async function compare(script, status, body) {
    const integration = { orgId: 7, direction: 'OUTBOUND', responseTransformation: { mode: 'SCRIPT', script } };
    let old = { decision: 'continue', message: null };
    if (status >= 200 && status < 300) {
      try {
        const out = await transformer.applyResponseTransform(integration, JSON.parse(body), { orgId: 7, eventType: 'APPT' });
        if (transformer.isTransformationSkipped(out)) {
          old = { decision: out.details && out.details.shouldRetry === true ? 'retry' : 'fail', message: transformer.getTransformationSkipReason(out) };
        }
      } catch (_error) {
        // the old path logged and went on
      }
    }
    const stage = normalizeStage(planMigration(integration).stages[0]);
    const result = await runInlineHook({
      hook: 'after_response',
      stages: [stage],
      integration,
      scope: { event: {}, delivery: { response: { status, body: JSON.parse(body) } }, stages: {}, vars: {} },
      budgetDeadline: Date.now() + 50,
      meta: { orgId: 7, deliveryAttempt: 1 },
      deps: deps(),
    });
    expect({ decision: result.decision, message: result.message }).toEqual(old);
  }

  it.each([
    ['skip with shouldRetry', 'return payload.ok ? payload : skip("rejected: " + payload.reason, { shouldRetry: true });', 200, '{"ok":false,"reason":"busy"}'],
    ['skip without retry', 'return skip("invalid number");', 200, '{}'],
    ['skip with no reason', 'return skip();', 200, '{}'],
    ['an ordinary result', 'payload.seen = true; return payload;', 200, '{"ok":true}'],
    ['a script that throws (no effect, as before)', 'throw new Error("bad script");', 200, '{}'],
    ['a non-2xx answer (the script did not run)', 'return skip("never");', 500, '{}'],
    ['the utilities', 'return trim(" a ") === "a" && formatPhone("98765") === "+9198765" ? payload : skip("utils differ");', 200, '{}'],
  ])('%s', async (_label, script, status, body) => {
    await compare(script, status, body);
  });
});
