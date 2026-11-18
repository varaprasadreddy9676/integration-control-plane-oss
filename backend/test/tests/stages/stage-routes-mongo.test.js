'use strict';

/**
 * The stage API against a real MongoDB (STAGE_MONGO_TEST_URI; see
 * stage-store.test.js): org scoping, the permission boundaries (edit, live test,
 * replay), tests that never touch production state, and results.
 */

const TEST_URI = process.env.STAGE_MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;
if (TEST_URI) {
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DATABASE = `stage_routes_test_${process.pid}`;
}

const express = require('express');
const request = require('supertest');
const mongodb = require('../../../src/mongodb');
const integrations = require('../../../src/data/integrations');
const store = require('../../../src/stages/store');
const jobs = require('../../../src/stages/store/jobs');
const { ensureAllStageIndexes } = require('../../../src/stages/indexes');
const { changesStages } = require('../../../src/stages/integration-config');
const { startStageRuntime, stopStageRuntime } = require('../../../src/stages/runtime');
const errorHandler = require('../../../src/middleware/error-handler');

jest.setTimeout(60000);

const ORG = 61;
let db;

function appAs(role, orgId = ORG) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = orgId;
    req.user = { id: `u-${role}`, role, orgId };
    next();
  });
  app.use('/stages', require('../../../src/routes/stages'));
  app.use(errorHandler);
  return app;
}

const script = (id, hook, code, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code } }, ...extra });

describeMongo('stage API (MongoDB)', () => {
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

  it('lists runners with their forms (not the internal one) and templates for an integration', async () => {
    const app = appAs('INTEGRATION_EDITOR');
    const { body } = await request(app).get('/stages/runners').expect(200);
    expect(body.runners.map((r) => r.type)).toEqual(['script', 'http', 'url-check']);
    expect(body.runners[1].configSchema.fields.map((f) => f.widget)).toEqual(expect.arrayContaining(['text', 'select', 'key-value', 'rows', 'tags']));

    const qikchat = await integrations.addIntegration(ORG, { name: 'Q', type: 'X', targetUrl: 'https://api.qikchat.in/v1/messages', httpMethod: 'POST', stages: [] });
    const templates = (await request(app).get(`/stages/templates?integrationId=${qikchat.id}`).expect(200)).body.templates;
    expect(templates[0]).toMatchObject({ id: 'qikchat-delivery-status', recommended: true });
    const made = (await request(app).post('/stages/templates/qikchat-delivery-status/stage').send({ name: 'Ask Qikchat' }).expect(200)).body.stage;
    expect(made).toMatchObject({ name: 'Ask Qikchat', hook: 'after_delivery', template: { id: 'qikchat-delivery-status' } });
  });

  it('validates without saving', async () => {
    const { body } = await request(appAs('INTEGRATION_EDITOR')).post('/stages/validate').send({ stages: [script('a', 'after_delivery', 'return 1')] }).expect(200);
    expect(body.ok).toBe(false);
    expect(body.errors[0].path).toBe('stages[0].schedule');
  });

  it('a test runs with stubbed HTTP by default, and leaves no trace in production state', async () => {
    const stage = {
      id: 'h',
      name: 'Check',
      hook: 'after_delivery',
      schedule: { checkAfterSeconds: [30] },
      runner: { type: 'http', config: { url: 'https://api.provider.test/x', extract: [{ name: 's', from: 'response.body.state' }], status: { from: 's' } } },
    };
    const { body } = await request(appAs('VIEWER'))
      .post('/stages/test')
      .send({ stage, stubResponses: [{ status: 200, body: { state: 'READ' } }] })
      .expect(200);
    expect(body).toMatchObject({ live: false, record: { outcome: 'ok', status: 'READ', calls: [expect.objectContaining({ url: 'https://api.provider.test/x', statusCode: 200 })] } });
    expect(await db.collection('stage_runs').countDocuments({})).toBe(0);
    expect(await db.collection('stage_jobs').countDocuments({})).toBe(0);
  });

  it('a live test needs its own permission', async () => {
    const stage = script('s', 'on_failure', 'return null;');
    await request(appAs('VIEWER')).post('/stages/test').send({ stage, live: true }).expect(403);
    const { body } = await request(appAs('INTEGRATION_EDITOR')).post('/stages/test').send({ stage, live: true }).expect(200);
    expect(body.live).toBe(true);
    expect(await db.collection('audit_logs').countDocuments({ action: 'stage_tested_live' })).toBe(1);
  });

  it('a delivery\'s runs and states are visible to its org only', async () => {
    const record = {
      runId: 'r-own',
      orgId: ORG,
      deliveryId: 'dl-1',
      stage: { id: 'x', name: 'x', hook: 'before_send' },
      seq: 1,
      at: new Date().toISOString(),
      outcome: 'ok',
      status: 'OK',
      calls: [],
      logs: [],
    };
    await store.projectRun(record);
    expect((await request(appAs('VIEWER')).get('/stages/deliveries/dl-1').expect(200)).body).toMatchObject({ states: [expect.objectContaining({ status: 'OK' })], runs: [expect.objectContaining({ runId: 'r-own' })] });
    expect((await request(appAs('VIEWER', ORG + 1)).get('/stages/deliveries/dl-1').expect(200)).body).toEqual({ states: [], runs: [] });
    await request(appAs('VIEWER', ORG + 1)).get('/stages/runs/r-own').expect(404);
  });

  it('replay and re-pin need stages:replay and are audited', async () => {
    const stage = script('check', 'after_delivery', 'return { status: "AGAIN" };', { schedule: { checkAfterSeconds: [30] } });
    const integration = await integrations.addIntegration(ORG, { name: 'R', type: 'X', targetUrl: 'https://p.test/x', httpMethod: 'POST', stages: [stage] });
    const hash = await store.definitions.saveDefinition(ORG, integration.stages[0]);
    const { insertedId } = await db.collection('execution_logs').insertOne({ orgId: ORG, status: 'SUCCESS', responseBody: '{}' });
    await store.projectRun({ runId: 'r-1', orgId: ORG, deliveryId: String(insertedId), integrationId: integration.id, stage: { id: 'check', name: 'c', hook: 'after_delivery', definitionHash: hash }, seq: 1, at: new Date().toISOString(), outcome: 'error', calls: [], logs: [] });

    await request(appAs('VIEWER')).post('/stages/runs/r-1/replay').send({ reason: 'x' }).expect(403);
    await request(appAs('INTEGRATION_EDITOR')).post('/stages/runs/r-1/replay').send({}).expect(400);
    const replay = (await request(appAs('INTEGRATION_EDITOR')).post('/stages/runs/r-1/replay').send({ reason: 'provider was down' }).expect(200)).body.run;
    expect(replay).toMatchObject({ replayOfRunId: 'r-1', status: 'AGAIN' });

    await jobs.createJob({ orgId: ORG, deliveryId: 'd9', stageId: 'check', trigger: 'accepted', failureSeq: 0, integrationId: integration.id, definitionHash: 'old', acceptedAt: new Date(), firstRunAt: new Date(Date.now() + 60000), input: {} });
    await request(appAs('VIEWER')).post(`/stages/integrations/${integration.id}/stages/check/repin`).send({}).expect(403);
    const repin = (await request(appAs('INTEGRATION_EDITOR')).post(`/stages/integrations/${integration.id}/stages/check/repin`).send({ reason: 'fixed the script' }).expect(200)).body;
    expect(repin).toEqual({ moved: 1, definitionHash: hash });
    expect(await db.collection('audit_logs').countDocuments({ action: { $in: ['stage_replayed', 'stage_jobs_repinned'] } })).toBe(2);
    expect((await request(appAs('VIEWER')).get(`/stages/integrations/${integration.id}/stages/check/jobs`).expect(200)).body).toEqual({ byState: { PENDING: 1 } });
  });

  it('results keep delivery outcomes and executions apart', async () => {
    const at = new Date().toISOString();
    for (const [runId, seq, status] of [['o1', 1, 'PENDING'], ['o2', 2, 'PENDING'], ['o3', 3, 'DELIVERED']]) {
      await store.projectRun({ runId, orgId: ORG, deliveryId: 'res-1', integrationId: 'i-res', stage: { id: 'st', name: 'st', hook: 'after_delivery' }, seq, at, acceptedAt: at, outcome: 'ok', status, durationMs: 10, executionAttempt: 1, calls: [], logs: [] });
    }
    const { body } = await request(appAs('VIEWER')).get('/stages/results?integrationId=i-res').expect(200);
    expect(body.outcomes).toEqual([{ stageId: 'st', status: 'DELIVERED', outcome: 'ok', deliveries: 1 }]);
    expect(body.executions).toEqual([expect.objectContaining({ stageId: 'st', runs: 3, errors: 0 })]);
  });

  it('runtime status is reported for the console', async () => {
    const { body } = await request(appAs('VIEWER')).get('/stages/runtime').expect(200);
    expect(body).toMatchObject({ ready: true, mode: 'none', isolated: false });
  });
});

describe('who may change stages', () => {
  const stored = { stages: [{ id: 'a', name: 'A' }], send: null, stagesPaused: false, stageBudgetMs: null };
  it('sending back unchanged stages is not a change; anything else is', () => {
    expect(changesStages({ name: 'x', ...JSON.parse(JSON.stringify(stored)) }, stored)).toBe(false);
    expect(changesStages({ name: 'x' }, stored)).toBe(false);
    expect(changesStages({ stages: [{ id: 'a', name: 'B' }] }, stored)).toBe(true);
    expect(changesStages({ send: { bindings: { headers: { A: 'b' } } } }, stored)).toBe(true);
    expect(changesStages({ stagesPaused: true }, stored)).toBe(true);
  });
  it('on create, empty stage fields are not a change', () => {
    expect(changesStages({ stages: [], send: null, stagesPaused: false })).toBe(false);
    expect(changesStages({ stages: [{ id: 'a' }] })).toBe(true);
  });
});
