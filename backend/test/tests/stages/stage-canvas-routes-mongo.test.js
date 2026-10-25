'use strict';

/**
 * The backend pieces of the workflow canvas against a real MongoDB
 * (STAGE_MONGO_TEST_URI; see stage-store.test.js): branch counts, the effect of a
 * save on waiting checks, outcomes read from a stage, "check status, then replay",
 * and "other deliveries that failed the same way".
 */

const TEST_URI = process.env.STAGE_MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;
if (TEST_URI) {
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DATABASE = `stage_canvas_test_${process.pid}`;
}

const mockReplayEvent = jest.fn(async () => ({}));
jest.mock('../../../src/processor/retry-handler', () => ({ replayEvent: (...args) => mockReplayEvent(...args) }));

const express = require('express');
const request = require('supertest');
const mongodb = require('../../../src/mongodb');
const integrations = require('../../../src/data/integrations');
const store = require('../../../src/stages/store');
const jobs = require('../../../src/stages/store/jobs');
const { ensureAllStageIndexes } = require('../../../src/stages/indexes');
const { startStageRuntime, stopStageRuntime } = require('../../../src/stages/runtime');
const errorHandler = require('../../../src/middleware/error-handler');

jest.setTimeout(60000);

const ORG = 71;
let db;

/** A supertest agent for a caller with this role in this org. */
function appAs(role, orgId = ORG) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = orgId;
    req.user = { id: `u-${role}`, role, orgId };
    next();
  });
  app.use('/stages', require('../../../src/routes/stages'));
  app.use('/logs', require('../../../src/routes/logs'));
  app.use(errorHandler);
  return request(app);
}

const script = (id, hook, code, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code } }, ...extra });
const checkStage = (code, verification = { resendWhen: ['NOT_FOUND'] }, id = 'ask') =>
  script(id, 'after_delivery', code, { schedule: { checkAfterSeconds: [30] }, ...(verification ? { verification } : {}) });
const editor = () => appAs('INTEGRATION_EDITOR');

describeMongo('workflow canvas backend (MongoDB)', () => {
  beforeAll(async () => {
    db = await mongodb.connect();
    await ensureAllStageIndexes(db);
    await startStageRuntime({ isolation: 'none', allowUnisolated: true, poolSize: 1, memoryMb: 64 });
  });
  afterAll(async () => {
    stopStageRuntime();
    await db.dropDatabase();
    await mongodb.close();
  });
  beforeEach(() => mockReplayEvent.mockClear());

  const addIntegration = (name, extra = {}) =>
    integrations.addIntegration(ORG, { name, type: 'X', targetUrl: 'https://p.test/x', httpMethod: 'POST', stages: [], ...extra });
  const addLog = async (integration, fields = {}) =>
    (await db.collection('execution_logs').insertOne({ orgId: ORG, integrationConfigId: mongodb.toObjectId(integration.id), status: 'FAILED', attemptCount: 1, createdAt: new Date(), ...fields })).insertedId;

  describe('branch counts', () => {
    it('counts the last 24 hours of an integration\'s deliveries and stage runs, per action, for its own org only', async () => {
      const integration = await addIntegration('Counts', {
        actions: [
          { name: 'Message', kind: 'HTTP', targetUrl: 'https://p.test/m', httpMethod: 'POST', stages: [script('gate', 'before_send', 'return null;', { effect: 'gate' })] },
          { name: 'Mail', kind: 'HTTP', targetUrl: 'https://p.test/n', httpMethod: 'POST', stages: [] },
        ],
      });
      const hoursAgo = (hours) => new Date(Date.now() - hours * 3600 * 1000);
      await addLog(integration, { actionIndex: 0, status: 'SUCCESS', attemptCount: 1 });
      await addLog(integration, { actionIndex: 0, status: 'ABANDONED', attemptCount: 3 });
      await addLog(integration, { actionIndex: 1, status: 'SUCCESS', attemptCount: 2 });
      await addLog(integration, { actionIndex: 0, status: 'SUCCESS', createdAt: hoursAgo(30) });
      for (const [runId, outcome, errorCode] of [['c1', 'ok'], ['c2', 'ok'], ['c3', 'skipped'], ['c4', 'error', 'STAGE_FAILED']]) {
        await store.projectRun({ runId, orgId: ORG, deliveryId: `d-${runId}`, integrationId: integration.id, stage: { id: 'gate', name: 'gate', hook: 'before_send' }, seq: 1, at: new Date().toISOString(), outcome, errorCode: errorCode || null, status: null, durationMs: 5, calls: [], logs: [] });
      }
      await store.projectRun({ runId: 'c-old', orgId: ORG, deliveryId: 'd-old', integrationId: integration.id, stage: { id: 'gate', name: 'gate', hook: 'before_send' }, seq: 1, at: hoursAgo(30).toISOString(), outcome: 'ok', calls: [], logs: [] });

      const { body } = await (appAs('VIEWER')).get(`/stages/flow-stats?integrationId=${integration.id}`).expect(200);
      expect(body.hours).toBe(24);
      const [message, mail] = body.targets;
      expect(message.deliveries).toEqual({ total: 2, byStatus: { SUCCESS: 1, ABANDONED: 1 }, attempts: 4, retries: 2 });
      expect(message.stages[0]).toMatchObject({ stageId: 'gate', runs: 4, ok: 2, skipped: 1, rejected: 1 });
      expect(mail.deliveries).toEqual({ total: 1, byStatus: { SUCCESS: 1 }, attempts: 2, retries: 1 });

      const wide = (await (appAs('VIEWER')).get(`/stages/flow-stats?integrationId=${integration.id}&hours=48`).expect(200)).body;
      expect(wide.targets[0].deliveries.total).toBe(3);
      expect(wide.targets[0].stages[0].runs).toBe(5);

      await (appAs('VIEWER', ORG + 1)).get(`/stages/flow-stats?integrationId=${integration.id}`).expect(404);
      await (appAs('VIEWER')).get('/stages/flow-stats').expect(400);
    });
  });

  describe('saving over waiting checks', () => {
    it('reports what an edit, a switch-off and a removal would do, without changing anything', async () => {
      const integration = await addIntegration('Impact', { stages: [checkStage('return { status: "A" };'), script('other', 'before_send', 'return null;', { effect: 'gate' })] });
      const stored = integration.stages.find((candidate) => candidate.id === 'ask');
      const oldHash = await store.definitions.saveDefinition(ORG, stored);
      const waiting = (deliveryId, state) =>
        jobs.createJob({ orgId: ORG, deliveryId, stageId: 'ask', trigger: 'accepted', failureSeq: 0, integrationId: integration.id, definitionHash: oldHash, state, acceptedAt: new Date(), firstRunAt: new Date(Date.now() + 60000), input: {} });
      await waiting('i1', 'PENDING');
      await waiting('i2', 'PENDING');
      await waiting('i3', 'PAUSED');

      const edited = checkStage('return { status: "B" };');
      const post = (draft) => editor().post('/stages/save-impact').send({ integrationId: integration.id, integration: draft });
      expect((await post({ stages: [edited, integration.stages[1]] }).expect(200)).body).toMatchObject({
        stages: [expect.objectContaining({ stageId: 'ask', change: 'edited', keepOldVersion: 3 })],
        totals: { keepOldVersion: 3, paused: 0, resumed: 0, cancelled: 0 },
      });
      expect((await post({ stages: [{ ...stored, enabled: false }, integration.stages[1]] }).expect(200)).body.totals).toMatchObject({ paused: 2 });
      expect((await post({ stages: [integration.stages[1]] }).expect(200)).body.totals).toMatchObject({ cancelled: 3 });
      expect((await post({ stages: [integration.stages[1], stored] }).expect(200)).body.stages).toEqual([]);

      await post({ stages: [{ id: 'bad' }] }).expect(400);
      await editor().post('/stages/save-impact').send({}).expect(400);
      await (appAs('VIEWER', ORG + 1)).post('/stages/save-impact').send({ integrationId: integration.id, integration: {} }).expect(404);
      expect(await db.collection('stage_jobs').countDocuments({ integrationId: integration.id, state: { $in: ['PENDING', 'PAUSED'] } })).toBe(3);
    });
  });

  describe('outcomes read from a stage', () => {
    it('lists what a script can end with', async () => {
      const stage = script('s', 'after_response', 'if (!ctx.event.ok) return fail("nope"); return { status: ctx.delivery.response.ok ? "SENT" : "HELD", done: false };');
      const { body } = await editor().post('/stages/outcomes').send({ stage }).expect(200);
      expect(body.outcomes).toMatchObject({ known: true, statuses: [{ status: 'SENT', done: false }, { status: 'HELD', done: false }], fails: [{ reason: 'nope' }], dynamicStatus: false });
      await editor().post('/stages/outcomes').send({}).expect(400);
    });
  });

  describe('check status, then replay', () => {
    const failedDelivery = async (integration, state, extra = {}) => addLog(integration, { status: 'ABANDONED', originalPayload: { state }, ...extra });
    const send = (logId, body, app = editor()) => app.post(`/stages/deliveries/${logId}/check-and-replay`).send(body);

    it('sends again when the provider says it does not have the message, and records the check and the decision', async () => {
      const integration = await addIntegration('Safe', { stages: [checkStage('return { status: ctx.event.state };')] });
      const logId = await failedDelivery(integration, 'NOT_FOUND');
      const { body } = await send(logId, { reason: 'provider timed out' }).expect(200);
      expect(body).toMatchObject({ verdict: 'safe_to_resend', status: 'NOT_FOUND', replayed: true, stage: { id: 'ask' } });
      expect(mockReplayEvent).toHaveBeenCalledWith(String(logId), ORG, { reason: 'provider timed out' });
      expect((await store.runs.listRuns(ORG, String(logId)))[0]).toMatchObject({ outcome: 'ok', status: 'NOT_FOUND' });
      expect(await db.collection('audit_logs').countDocuments({ action: 'delivery_replay_after_check', resourceId: String(logId) })).toBe(1);
    });

    it('refuses when the provider has the message, even if the caller accepts the risk', async () => {
      const integration = await addIntegration('Has', { stages: [checkStage('return { status: ctx.event.state };')] });
      const logId = await failedDelivery(integration, 'DELIVERED');
      for (const acceptUnverified of [false, true]) {
        const res = await send(logId, { reason: 'try', acceptUnverified }).expect(409);
        expect(res.body).toMatchObject({ code: 'PROVIDER_HAS_MESSAGE', check: { verdict: 'provider_has_it', status: 'DELIVERED' } });
      }
      expect(mockReplayEvent).not.toHaveBeenCalled();
      expect(await db.collection('audit_logs').countDocuments({ action: 'delivery_replay_refused', resourceId: String(logId) })).toBe(2);
    });

    it('when the check cannot say, refuses unless the caller accepts the risk, and audits that', async () => {
      const integration = await addIntegration('Unsure', { stages: [checkStage('throw new Error("provider unreachable");')] });
      const logId = await failedDelivery(integration, 'x');
      const refused = await send(logId, { reason: 'try' }).expect(409);
      expect(refused.body).toMatchObject({ code: 'UNVERIFIED', check: { verdict: 'unverifiable' } });
      expect(mockReplayEvent).not.toHaveBeenCalled();

      const accepted = (await send(logId, { reason: 'try anyway', acceptUnverified: true }).expect(200)).body;
      expect(accepted).toMatchObject({ verdict: 'unverifiable', replayed: true });
      expect(mockReplayEvent).toHaveBeenCalledTimes(1);
      expect(await db.collection('audit_logs').findOne({ action: 'delivery_replay_after_check', resourceId: String(logId) })).toMatchObject({ metadata: expect.objectContaining({ acceptedUnverified: true }) });
    });

    it('a delivery with no verifying check is unverifiable', async () => {
      const integration = await addIntegration('None', { stages: [checkStage('return { status: "NOT_FOUND" };', null)] });
      const logId = await failedDelivery(integration, 'NOT_FOUND');
      expect((await send(logId, { reason: 'try' }).expect(409)).body).toMatchObject({ code: 'UNVERIFIED', check: { stage: null } });
    });

    it('asks the check of the action the delivery went through', async () => {
      const integration = await addIntegration('Actions', {
        actions: [
          { name: 'A', kind: 'HTTP', targetUrl: 'https://p.test/a', httpMethod: 'POST', stages: [checkStage('return { status: "DELIVERED" };', undefined, 'askA')] },
          { name: 'B', kind: 'HTTP', targetUrl: 'https://p.test/b', httpMethod: 'POST', stages: [checkStage('return { status: "NOT_FOUND" };', undefined, 'askB')] },
        ],
      });
      expect((await send(await failedDelivery(integration, 'x', { actionIndex: 0 }), { reason: 'r' }).expect(409)).body.code).toBe('PROVIDER_HAS_MESSAGE');
      expect((await send(await failedDelivery(integration, 'x', { actionIndex: 1 }), { reason: 'r' }).expect(200)).body.verdict).toBe('safe_to_resend');
    });

    it('needs the permission and a reason, only replays failed deliveries, and stays inside the org', async () => {
      const integration = await addIntegration('Guards', { stages: [checkStage('return { status: "NOT_FOUND" };')] });
      const logId = await failedDelivery(integration, 'x');
      await send(logId, { reason: 'r' }, appAs('VIEWER')).expect(403);
      await send(logId, {}).expect(400);
      await send(logId, { reason: 'r' }, appAs('INTEGRATION_EDITOR', ORG + 1)).expect(404);
      await send('not-an-id', { reason: 'r' }).expect(404);
      const ok = await addLog(integration, { status: 'SUCCESS' });
      expect((await send(ok, { reason: 'r' }).expect(409)).body.code).toBe('NOT_REPLAYABLE');
      expect(mockReplayEvent).not.toHaveBeenCalled();
    });

    it('a verifying check must be after delivery, with status words', async () => {
      const body = (stage) => ({ stages: [stage] });
      const bad = await editor().post('/stages/validate').send(body(script('v', 'before_send', 'return null;', { effect: 'gate', verification: { resendWhen: ['X'] } }))).expect(200);
      expect(bad.body.errors).toEqual([expect.objectContaining({ path: 'stages[0].verification' })]);
      const empty = await editor().post('/stages/validate').send(body(checkStage('return null;', { resendWhen: [] }))).expect(200);
      expect(empty.body.errors).toEqual([expect.objectContaining({ path: 'stages[0].verification.resendWhen' })]);
      expect((await editor().post('/stages/validate').send(body(checkStage('return null;'))).expect(200)).body.ok).toBe(true);
    });
  });

  describe('writing a stage with AI', () => {
    it('serves the guide for a hook', async () => {
      const { body } = await appAs('VIEWER').get('/stages/authoring-guide?hook=after_delivery').expect(200);
      expect(body.at).toMatchObject({ title: 'Later (scheduled)', timeoutMs: { default: 15000 } });
    });

    it('builds a prompt from a goal, with the shape of a delivery\'s data and none of its values', async () => {
      const integration = await addIntegration('Prompted');
      const logId = await addLog(integration, { originalPayload: { patient: { name: 'Ada Lovelace', phone: '+919800000000' } }, responseBody: '{"id":"m-1"}' });
      const { body } = await editor().post('/stages/authoring-prompt').send({ hook: 'before_send', goal: 'Skip when there is no phone', deliveryId: String(logId), current: 'return null;' }).expect(200);
      expect(body.prompt).toMatch(/Skip when there is no phone/);
      expect(body.prompt).toMatch(/"phone": "string"/);
      expect(body.prompt).not.toMatch(/Lovelace|919800000000/);
      expect(body.guide.at.title).toBe('Before send');
    });

    it('needs a goal, and a delivery of the caller\'s own org', async () => {
      await editor().post('/stages/authoring-prompt').send({ hook: 'before_send' }).expect(400);
      const integration = await addIntegration('Prompted2');
      const logId = await addLog(integration);
      await appAs('INTEGRATION_EDITOR', ORG + 1).post('/stages/authoring-prompt').send({ hook: 'before_send', goal: 'x', deliveryId: String(logId) }).expect(404);
    });
  });

  describe('other deliveries that failed the same way', () => {
    it('counts failures of the same integration and error within the window, not the delivery itself', async () => {
      const integration = await addIntegration('Similar');
      const other = await addIntegration('Elsewhere');
      const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000);
      const failed = (fields) => addLog(integration, { status: 'ABANDONED', errorCode: 'ETIMEDOUT', ...fields });
      const subject = await failed({ createdAt: minutesAgo(4) });
      const near = [await failed({ createdAt: minutesAgo(5) }), await failed({ createdAt: minutesAgo(40) })];
      await failed({ createdAt: minutesAgo(300) }); // outside the window
      await failed({ errorCode: 'ECONNRESET', createdAt: minutesAgo(5) }); // another error
      await failed({ status: 'SUCCESS', createdAt: minutesAgo(5) }); // not a failure
      await addLog(other, { status: 'ABANDONED', errorCode: 'ETIMEDOUT', createdAt: minutesAgo(5) }); // another integration

      const { body } = await appAs('VIEWER').get(`/logs/${subject}/similar-failures`).expect(200);
      expect(body).toMatchObject({ matchedOn: 'errorCode', windowMinutes: 60, count: 2, capped: false });
      expect(body.sample.sort()).toEqual(near.map(String).sort());
      expect((await appAs('VIEWER').get(`/logs/${subject}/similar-failures?minutes=600`).expect(200)).body.count).toBe(3);

      await appAs('VIEWER', ORG + 1).get(`/logs/${subject}/similar-failures`).expect(404);
      await appAs('VIEWER').get('/logs/not-an-id/similar-failures').expect(404);
    });

    it('falls back to the error category, and says so when the log has nothing to match on', async () => {
      const integration = await addIntegration('Category');
      const a = await addLog(integration, { errorCategory: 'NETWORK' });
      await addLog(integration, { errorCategory: 'NETWORK' });
      expect((await appAs('VIEWER').get(`/logs/${a}/similar-failures`).expect(200)).body).toMatchObject({ matchedOn: 'errorCategory', count: 1 });
      const bare = await addLog(integration, {});
      expect((await appAs('VIEWER').get(`/logs/${bare}/similar-failures`).expect(200)).body).toMatchObject({ matchedOn: null, count: 0 });
    });
  });
});
