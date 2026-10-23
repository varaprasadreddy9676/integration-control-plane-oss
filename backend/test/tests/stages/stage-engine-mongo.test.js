'use strict';

/**
 * The deferred engine against a real MongoDB (STAGE_MONGO_TEST_URI; skipped
 * without it; see stage-store.test.js for running it with driver 4.x): the
 * outbox written with the attempt's status, failureSeq, jobs with leases and
 * fenced commits, re-pin, pause/cancel/resume, repair after a crash, dead
 * letters, our own limits, and a job run end to end with the real runtime.
 */

const TEST_URI = process.env.STAGE_MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;
if (TEST_URI) {
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DATABASE = `stage_engine_test_${process.pid}`;
}

const mongodb = require('../../../src/mongodb');
const config = require('../../../src/config');
const { ensureAllStageIndexes } = require('../../../src/stages/indexes');
const store = require('../../../src/stages/store');
const jobs = require('../../../src/stages/store/jobs');
const { drainLog, findPendingLogs } = require('../../../src/stages/outbox');
const { processJob, repair } = require('../../../src/stages/job-worker');
const { admit } = require('../../../src/stages/limits');
const { normalizeStage } = require('../../../src/stages/config');
const runners = require('../../../src/stages/runners');
const { createRuntimePool } = require('../../../src/stages/runtime/pool');

jest.setTimeout(60000);

const ORG = 77;
let db;
let pool;
let intentSeq = 0;

const checkStage = (overrides = {}) =>
  normalizeStage({
    id: 'check',
    name: 'Ask the provider',
    hook: 'after_delivery',
    runner: { type: 'script', config: { code: 'const r = await http.get("https://p.test/s/" + ctx.delivery.response.body.id); return { status: r.data.state, done: r.data.state === "READ" };' } },
    schedule: { checkAfterSeconds: [30, 300] },
    ...overrides,
  });

async function insertIntegration(stages, extra = {}) {
  const { insertedId } = await db.collection('integration_configs').insertOne({ orgId: ORG, name: 'I', direction: 'OUTBOUND', isActive: true, stages, ...extra });
  return { id: String(insertedId), orgId: ORG, isActive: true, stages, ...extra };
}

function intent(stage, hook, extra = {}) {
  intentSeq += 1;
  return {
    intentId: `i-${intentSeq}`,
    groupId: extra.groupId || `g-${intentSeq}`,
    hook,
    stageId: stage.id,
    definitionHash: store.definitions.definitionHash(ORG, stage),
    integrationId: extra.integrationId || 'int-x',
    integrationRevision: null,
    at: (extra.at || new Date()).toISOString(),
    input: { event: { a: 1 }, request: { url: 'u', method: 'POST', body: {} }, response: { status: 200, headers: {}, body: { id: 'm-1' } }, status: 'SUCCESS', stages: {} },
  };
}

async function logWithOutbox(intents = [], records = []) {
  const { insertedId } = await db.collection('execution_logs').insertOne({
    orgId: ORG,
    status: 'SUCCESS',
    stageOutbox: intents,
    stageProjection: records,
    stagePendingAt: new Date(Date.now() - 60000),
  });
  return insertedId;
}

function fakeRecord(stageId, deliveryId = null, seq = 1) {
  intentSeq += 1;
  return { runId: `r-${intentSeq}`, orgId: ORG, deliveryId, stage: { id: stageId, name: stageId, hook: 'before_send' }, seq, at: new Date().toISOString(), outcome: 'ok', status: 'OK', done: false, calls: [], logs: [] };
}

describeMongo('stage engine (MongoDB)', () => {
  beforeAll(async () => {
    db = await mongodb.connect();
    await ensureAllStageIndexes(db);
    pool = createRuntimePool({ size: 2, memoryMb: 64, isolation: { required: false } });
  });
  afterAll(async () => {
    pool.close();
    await db.dropDatabase();
    await mongodb.close();
  });
  beforeEach(async () => {
    await Promise.all(['stage_jobs', 'execution_logs', 'stage_runs', 'stage_state', 'integration_configs', 'stage_limits'].map((c) => db.collection(c).deleteMany({})));
  });

  describe('the outbox written with the attempt', () => {
    it('recordLog stores the status, the intents and the inline records in one write', async () => {
      const { recordLog } = require('../../../src/data/logs');
      const stage = checkStage();
      const logId = await recordLog(ORG, {
        status: 'SUCCESS',
        eventType: 'E',
        integrationName: 'I',
        stageIntents: [intent(stage, 'after_delivery')],
        stageRecords: [fakeRecord('pre')],
      });
      const doc = await db.collection('execution_logs').findOne({ _id: mongodb.toObjectId(logId) });
      expect(doc).toMatchObject({ status: 'SUCCESS', stageOutbox: [expect.objectContaining({ stageId: 'check' })], stageProjection: [expect.objectContaining({ runId: expect.any(String) })] });
      expect(doc.stagePendingAt).toBeInstanceOf(Date);

      // A retry of the same log appends; it never drops what is still pending.
      await recordLog(ORG, { id: logId, status: 'FAILED', eventType: 'E', integrationName: 'I', stageRecords: [fakeRecord('pre', null, 2)] });
      const again = await db.collection('execution_logs').findOne({ _id: mongodb.toObjectId(logId) });
      expect(again.status).toBe('FAILED');
      expect(again.stageProjection).toHaveLength(2);
      expect(again.stageOutbox).toHaveLength(1);
    });

    it('draining creates the jobs, projects the records and clears the outbox; draining again changes nothing', async () => {
      const stage = checkStage();
      await store.definitions.saveDefinition(ORG, stage);
      const logId = await logWithOutbox([intent(stage, 'after_delivery')], [fakeRecord('pre')]);

      expect(await drainLog(ORG, logId)).toEqual({ jobs: 1, runs: 1 });
      expect(await drainLog(ORG, logId)).toEqual({ jobs: 0, runs: 0 });
      const doc = await db.collection('execution_logs').findOne({ _id: logId });
      expect(doc.stageOutbox).toBeUndefined();
      expect(doc.stagePendingAt).toBeUndefined();
      expect(doc.stageSummary.pre).toMatchObject({ status: 'OK' });
      expect(await db.collection('stage_runs').countDocuments({ deliveryId: String(logId) })).toBe(1);
      const [job] = await db.collection('stage_jobs').find({}).toArray();
      expect(job).toMatchObject({ state: 'PENDING', stageId: 'check', trigger: 'accepted', seq: 1, deliveryId: String(logId) });
    });

    it('concurrent drains and a crash between creating a job and clearing its intent still give one job', async () => {
      const stage = checkStage();
      await store.definitions.saveDefinition(ORG, stage);
      const theIntent = intent(stage, 'after_delivery');
      const logId = await logWithOutbox([theIntent]);
      // The crash: the job was created, the intent was not cleared.
      await jobs.createJob({ orgId: ORG, deliveryId: String(logId), stageId: 'check', trigger: 'accepted', failureSeq: 0, definitionHash: theIntent.definitionHash, acceptedAt: new Date(), firstRunAt: new Date(), input: {} });
      await Promise.all([drainLog(ORG, logId), drainLog(ORG, logId), drainLog(ORG, logId)]);
      expect(await db.collection('stage_jobs').countDocuments({})).toBe(1);
    });

    it('each terminal failure gets the next failureSeq, shared by its intents, exactly once', async () => {
      const a = normalizeStage({ id: 'notifyA', name: 'A', hook: 'on_failure', runner: { type: 'script', config: { code: 'return null;' } } });
      const b = normalizeStage({ id: 'notifyB', name: 'B', hook: 'on_failure', runner: { type: 'script', config: { code: 'return null;' } } });
      await store.definitions.saveDefinition(ORG, a);
      await store.definitions.saveDefinition(ORG, b);
      const logId = await logWithOutbox([intent(a, 'on_failure', { groupId: 'f1' }), intent(b, 'on_failure', { groupId: 'f1' })]);
      await Promise.all([drainLog(ORG, logId), drainLog(ORG, logId)]);
      // A DLQ retry of the same delivery fails again later.
      await db.collection('execution_logs').updateOne({ _id: logId }, { $push: { stageOutbox: intent(a, 'on_failure', { groupId: 'f2' }) }, $set: { stagePendingAt: new Date() } });
      await drainLog(ORG, logId);

      const all = await db.collection('stage_jobs').find({}).sort({ stageId: 1, failureSeq: 1 }).toArray();
      expect(all.map((j) => [j.stageId, j.failureSeq])).toEqual([
        ['notifyA', 1],
        ['notifyA', 2],
        ['notifyB', 1],
      ]);
      expect((await db.collection('execution_logs').findOne({ _id: logId })).stageFailureSeq).toBe(2);
    });

    it('the outbox worker finds logs a crash left with pending work', async () => {
      const logId = await logWithOutbox([], [fakeRecord('pre')]);
      expect((await findPendingLogs()).map((l) => String(l._id))).toContain(String(logId));
      await repair();
      expect(await findPendingLogs()).toEqual([]);
    });
  });

  describe('jobs: claim, lease and fenced commit', () => {
    async function pendingJob(extra = {}) {
      const stage = checkStage();
      const hash = await store.definitions.saveDefinition(ORG, stage);
      await jobs.createJob({ orgId: ORG, deliveryId: extra.deliveryId || 'd1', stageId: 'check', trigger: 'accepted', failureSeq: 0, integrationId: extra.integrationId || 'int-x', definitionHash: hash, acceptedAt: new Date(Date.now() - 31000), firstRunAt: new Date(Date.now() - 1000), input: { response: { body: { id: 'm-1' } } } });
      return { stage, hash };
    }

    it('one worker gets a due job; nobody else does until its lease runs out', async () => {
      await pendingJob();
      const claimed = await jobs.claimDue();
      expect(claimed).toMatchObject({ state: 'RUNNING', executionAttempt: 1, claimedDefinitionHash: expect.any(String), lease: { token: expect.any(String) } });
      expect(await jobs.claimDue()).toBeNull();

      await db.collection('stage_jobs').updateOne({ _id: claimed._id }, { $set: { 'lease.until': new Date(Date.now() - 1) } });
      const reclaimed = await jobs.claimDue();
      expect(reclaimed.executionAttempt).toBe(2); // another execution of the same check
      expect(reclaimed.lease.token).not.toBe(claimed.lease.token);

      // The presumed-dead worker comes back: its commit matches nothing.
      expect(await jobs.commit(claimed, { state: 'COMPLETED' })).toEqual({ committed: false });
      expect(await jobs.commit(reclaimed, { state: 'COMPLETED', lease: null })).toEqual({ committed: true });
    });

    it('a re-pin moves unclaimed pending jobs only; a claimed job keeps what it runs', async () => {
      await pendingJob({ deliveryId: 'd1' });
      await pendingJob({ deliveryId: 'd2' });
      const claimed = await jobs.claimDue();
      expect(await jobs.repinJobs(ORG, 'int-x', 'check', 'new-hash')).toBe(1);
      const rows = await db.collection('stage_jobs').find({}).toArray();
      const other = rows.find((j) => String(j._id) !== String(claimed._id));
      expect(other.definitionHash).toBe('new-hash');
      expect(rows.find((j) => String(j._id) === String(claimed._id)).claimedDefinitionHash).toBe(claimed.claimedDefinitionHash);
      // The old execution can still commit what it ran; the re-pinned one runs the new definition.
      expect((await jobs.commit(claimed, { state: 'COMPLETED', lease: null })).committed).toBe(true);
    });

    it('pausing, resuming and cancelling a stage\'s pending work', async () => {
      await pendingJob();
      expect(await jobs.pauseJobs(ORG, 'int-x', 'check')).toBe(1);
      expect(await jobs.claimDue()).toBeNull(); // paused work does not run
      expect(await jobs.resumeJobs(ORG, 'int-x', 'check')).toBe(1);
      expect(await jobs.countByState(ORG, 'int-x', 'check')).toEqual({ PENDING: 1 });
      expect(await jobs.cancelJobs(ORG, 'int-x', 'check')).toBe(1);
      const [job] = await db.collection('stage_jobs').find({}).toArray();
      expect(job).toMatchObject({ state: 'CANCELLED', input: null });
    });
  });

  describe('running a job', () => {
    const deps = (request) => ({ runners, pool, resolveCredential: async () => null, request, admit: undefined });
    const answering = (state) => async () => ({ status: 200, headers: {}, body: JSON.stringify({ state }), redirects: [], durationMs: 2 });

    async function setup(stage, extraIntegration) {
      const integration = await insertIntegration([stage], extraIntegration);
      const hash = await store.definitions.saveDefinition(ORG, stage);
      const deliveryId = String((await db.collection('execution_logs').insertOne({ orgId: ORG, status: 'SUCCESS' })).insertedId);
      await jobs.createJob({ orgId: ORG, deliveryId, stageId: stage.id, trigger: 'accepted', failureSeq: 0, integrationId: integration.id, definitionHash: hash, acceptedAt: new Date(Date.now() - 31000), firstRunAt: new Date(Date.now() - 1000), input: { response: { status: 200, body: { id: 'm-1' } } } });
      const loadIntegration = async () => (await db.collection('integration_configs').findOne({}).then((doc) => doc && { ...doc, id: String(doc._id) }));
      return { integration, deliveryId, loadIntegration };
    }

    it('runs the pinned definition, commits the next check, projects the run and clears it from the job', async () => {
      const { deliveryId, loadIntegration } = await setup(checkStage());
      const job = await jobs.claimDue();
      expect(await processJob(job, { deps: deps(answering('SENT')), loadIntegration })).toBe('PENDING');

      const after = await db.collection('stage_jobs').findOne({ _id: job._id });
      expect(after).toMatchObject({ state: 'PENDING', seq: 2, checksDone: 1, lastStatus: 'SENT', lease: null });
      expect(after.projection).toBeUndefined();
      expect(await store.state.getStates(ORG, deliveryId)).toEqual([expect.objectContaining({ stageId: 'check', status: 'SENT', seq: 1 })]);
      const log = await db.collection('execution_logs').findOne({ _id: mongodb.toObjectId(deliveryId) });
      expect(log.stageSummary.check).toMatchObject({ status: 'SENT' });
    });

    it('a done answer completes the job and removes its raw input', async () => {
      await setup(checkStage());
      const job = await jobs.claimDue();
      expect(await processJob(job, { deps: deps(answering('READ')), loadIntegration: async () => (await db.collection('integration_configs').findOne({}).then((d) => ({ ...d, id: String(d._id) }))) })).toBe('COMPLETED');
      expect(await db.collection('stage_jobs').findOne({ _id: job._id })).toMatchObject({ state: 'COMPLETED', input: null });
    });

    it('a disabled stage pauses the job; a deleted one cancels it; neither runs', async () => {
      let called = false;
      const request = async () => {
        called = true;
      };
      const { loadIntegration } = await setup({ ...checkStage(), enabled: false });
      const job = await jobs.claimDue();
      expect(await processJob(job, { deps: deps(request), loadIntegration })).toBe('PAUSED');
      await db.collection('integration_configs').updateMany({}, { $set: { stages: [] } });
      await db.collection('stage_jobs').updateOne({ _id: job._id }, { $set: { state: 'PENDING', nextRunAt: new Date(0) } });
      expect(await processJob(await jobs.claimDue(), { deps: deps(request), loadIntegration })).toBe('CANCELLED');
      expect(called).toBe(false);
    });

    it('retries a failing check, then dead-letters it and says so', async () => {
      const stage = checkStage({ onError: { action: 'retry_stage', maxAttempts: 2, backoffSeconds: [1] } });
      const { loadIntegration } = await setup(stage);
      const failing = async () => {
        throw Object.assign(new Error('down'), { code: 'CONNECTION_REFUSED' });
      };
      const dead = [];
      expect(await processJob(await jobs.claimDue(), { deps: deps(failing), loadIntegration, onDeadLetter: (x) => dead.push(x) })).toBe('PENDING');
      await db.collection('stage_jobs').updateMany({}, { $set: { nextRunAt: new Date(0) } });
      expect(await processJob(await jobs.claimDue(), { deps: deps(failing), loadIntegration, onDeadLetter: (x) => dead.push(x) })).toBe('DEAD');
      expect(dead).toHaveLength(1);
      expect(await db.collection('stage_runs').countDocuments({})).toBe(2);
    });

    it('a crash after the commit, before projecting, is repaired without running again', async () => {
      const { loadIntegration } = await setup(checkStage());
      const job = await jobs.claimDue();
      // Commit with a projection, then "crash" before projecting.
      const record = { ...fakeRecord('check', job.deliveryId, 1), stage: { id: 'check', name: 'x', hook: 'after_delivery' } };
      await jobs.commit(job, { state: 'PENDING', seq: 2, nextRunAt: new Date(Date.now() + 999999), lease: null, projection: record });
      await db.collection('stage_jobs').updateOne({ _id: job._id }, { $set: { updatedAt: new Date(Date.now() - 60000) } });
      await repair();
      expect(await db.collection('stage_runs').countDocuments({ _id: record.runId })).toBe(1);
      expect((await db.collection('stage_jobs').findOne({ _id: job._id })).projection).toBeUndefined();
      expect(loadIntegration).toBeDefined();
    });
  });

  describe('our own limits', () => {
    afterEach(() => {
      delete config.stages.hostLimits;
      delete config.stages.orgDailyQuota;
    });

    it('a host limit and an org share stop calls in the same second', async () => {
      config.stages.hostLimits = { 'p.test': { perSecond: 4 } };
      const now = Date.now();
      await admit({ orgId: 1, url: 'https://p.test/a', now });
      await admit({ orgId: 1, url: 'https://p.test/a', now });
      await expect(admit({ orgId: 1, url: 'https://p.test/a', now })).rejects.toMatchObject({ code: 'RATE_LIMITED' }); // org share is 2
      await admit({ orgId: 2, url: 'https://p.test/a', now });
      await admit({ orgId: 2, url: 'https://p.test/a', now }); // the host has had 4 calls this second
      await expect(admit({ orgId: 3, url: 'https://p.test/a', now })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      await admit({ orgId: 3, url: 'https://p.test/a', now: now + 1000 }); // the next second is free again
    });

    it('an org stops at its daily quota until the next day', async () => {
      config.stages.orgDailyQuota = 2;
      await admit({ orgId: 5, url: 'https://q.test/a' });
      await admit({ orgId: 5, url: 'https://q.test/b' });
      const error = await admit({ orgId: 5, url: 'https://q.test/c' }).catch((e) => e);
      expect(error).toMatchObject({ code: 'QUOTA_EXCEEDED' });
      expect(error.retryAfterMs).toBeGreaterThan(0);
    });
  });
});
