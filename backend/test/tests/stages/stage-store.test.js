'use strict';

/**
 * Stage storage against a real MongoDB (STAGE_MONGO_TEST_URI, e.g.
 * mongodb://localhost:27044; skipped without it): content-addressed revisions,
 * idempotent projection, and latest-state rules that late or repeated runs
 * cannot break.
 *
 * Under jest, MongoDB driver 7 fails its handshake ("Missing required
 * sub-document 'driver'"), outside jest it works. Run this with driver 4.x
 * (what production uses) mapped in: moduleNameMapper { "^mongodb$": "<path to
 * a mongodb@4 package>" } on top of test/package.json's jest config.
 */

const TEST_URI = process.env.STAGE_MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;

const DB_NAME = `stage_store_test_${process.pid}`;
if (TEST_URI) {
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DATABASE = DB_NAME;
}

const mongodb = require('../../../src/mongodb');
const store = require('../../../src/stages/store');

jest.setTimeout(30000);

const ORG = 41;
let db;
let seqRunId = 0;

function makeRun(overrides = {}) {
  seqRunId += 1;
  return {
    orgId: ORG,
    deliveryId: overrides.deliveryId || 'd1',
    integrationId: 'int-1',
    stage: { id: 'statusCheck', name: 'Ask the provider', hook: 'after_delivery', runner: 'script', definitionHash: 'h1' },
    runId: `run-${seqRunId}`,
    seq: 1,
    executionAttempt: 1,
    at: new Date(Date.UTC(2026, 9, 23, 10, 0, seqRunId)).toISOString(),
    outcome: 'ok',
    status: 'PENDING',
    done: false,
    calls: [],
    logs: [],
    ...overrides,
  };
}

describeMongo('stage storage (MongoDB)', () => {
  beforeAll(async () => {
    db = await mongodb.connect();
    await store.ensureStageIndexes(db);
  });
  afterAll(async () => {
    await db.dropDatabase();
    await mongodb.close();
  });

  describe('definitions', () => {
    const stage = {
      id: 'statusCheck',
      name: 'Ask the provider',
      enabled: true,
      hook: 'after_delivery',
      effect: 'observe',
      runner: { type: 'script', config: { code: 'return { status: "X" };' } },
      schedule: { checkAfterSeconds: [30, 300] },
      contract: 1,
    };

    it('stores a revision once, and renaming or pausing is not a new revision', async () => {
      const first = await store.definitions.saveDefinition(ORG, stage);
      const again = await store.definitions.saveDefinition(ORG, { ...stage, name: 'Renamed', enabled: false });
      expect(again).toBe(first);
      expect(await db.collection('stage_definitions').countDocuments({ _id: first })).toBe(1);
      expect(await store.definitions.getDefinition(ORG, first)).toMatchObject({ hook: 'after_delivery', contract: 1 });
    });

    it('a change in what the stage does is a new revision; key order is not', async () => {
      const base = store.definitions.definitionHash(ORG, stage);
      const reordered = { contract: 1, schedule: { checkAfterSeconds: [30, 300] }, runner: { config: stage.runner.config, type: 'script' }, effect: 'observe', hook: 'after_delivery' };
      expect(store.definitions.definitionHash(ORG, reordered)).toBe(base);
      expect(store.definitions.definitionHash(ORG, { ...stage, schedule: { checkAfterSeconds: [30] } })).not.toBe(base);
    });

    it('is scoped to the org', async () => {
      const hash = await store.definitions.saveDefinition(ORG, stage);
      expect(store.definitions.definitionHash(ORG + 1, stage)).not.toBe(hash);
      expect(await store.definitions.getDefinition(ORG + 1, hash)).toBeNull();
    });

    it('concurrent saves of the same revision both succeed', async () => {
      const variant = { ...stage, timeoutMs: 1234 };
      const hashes = await Promise.all([1, 2, 3, 4].map(() => store.definitions.saveDefinition(ORG, variant)));
      expect(new Set(hashes).size).toBe(1);
    });
  });

  describe('projection', () => {
    it('stores a run once, however often it is projected, and counts it once', async () => {
      const run = makeRun({ deliveryId: 'once' });
      await store.projectRun(run);
      await store.projectRun(run);
      await store.projectRun(run);
      expect(await db.collection('stage_runs').countDocuments({ deliveryId: 'once' })).toBe(1);
      const [state] = await store.state.getStates(ORG, 'once');
      expect(state).toMatchObject({ runs: 1, status: 'PENDING', seq: 1, lastRunId: run.runId });
    });

    it('state follows the newest check, and a late older run does not move it back', async () => {
      const deliveryId = 'late';
      const first = makeRun({ deliveryId, seq: 1, status: 'PENDING' });
      const second = makeRun({ deliveryId, seq: 2, status: 'DELIVERED', done: true });
      await store.projectRun(second);
      await store.projectRun(first); // arrives late
      const [state] = await store.state.getStates(ORG, deliveryId);
      expect(state).toMatchObject({ seq: 2, status: 'DELIVERED', done: true, runs: 2, lastRunId: second.runId });
    });

    it('a replay of the same check, run later, becomes the latest state', async () => {
      const deliveryId = 'replay';
      await store.projectRun(makeRun({ deliveryId, seq: 3, status: 'FAILED' }));
      const replay = makeRun({ deliveryId, seq: 3, status: 'DELIVERED', replayOfRunId: 'x' });
      await store.projectRun(replay);
      const [state] = await store.state.getStates(ORG, deliveryId);
      expect(state).toMatchObject({ status: 'DELIVERED', lastRunId: replay.runId });
    });

    it('concurrent projections in any order end on the newest run', async () => {
      const deliveryId = 'race';
      const all = [1, 2, 3, 4, 5, 6].map((seq) => makeRun({ deliveryId, seq, status: `S${seq}` }));
      await Promise.all([all[3], all[0], all[5], all[2], all[4], all[1]].map((run) => store.projectRun(run)));
      const [state] = await store.state.getStates(ORG, deliveryId);
      expect(state).toMatchObject({ seq: 6, status: 'S6', runs: 6 });
    });

    it('keeps a tiny summary on the delivery log of the same org only, with no bodies', async () => {
      const { insertedId } = await db.collection('execution_logs').insertOne({ orgId: ORG, status: 'SUCCESS' });
      const { insertedId: otherOrgLog } = await db.collection('execution_logs').insertOne({ orgId: ORG + 1, status: 'SUCCESS' });
      const deliveryId = String(insertedId);
      await store.projectRun(makeRun({ deliveryId, seq: 2, status: 'READ', calls: [{ responseBody: { big: 'x' } }] }));
      await store.projectRun(makeRun({ deliveryId, seq: 1, status: 'SENT' }));
      await store.projectRun(makeRun({ deliveryId: String(otherOrgLog), seq: 1 }));

      const logDoc = await db.collection('execution_logs').findOne({ _id: insertedId });
      expect(logDoc.stageSummary.statusCheck).toMatchObject({ status: 'READ', seq: 2, done: false, outcome: 'ok', name: 'Ask the provider' });
      expect(JSON.stringify(logDoc)).not.toMatch(/big/);
      const other = await db.collection('execution_logs').findOne({ _id: otherOrgLog });
      expect(other.stageSummary).toBeUndefined();
    });

    it('lists a delivery\'s runs oldest first and reads one run within its org only', async () => {
      const deliveryId = 'list';
      const a = makeRun({ deliveryId, seq: 1 });
      const b = makeRun({ deliveryId, seq: 2 });
      await store.projectRun(b);
      await store.projectRun(a);
      const listed = await store.runs.listRuns(ORG, deliveryId);
      expect(listed.map((run) => run.runId)).toEqual([a.runId, b.runId]);
      expect(await store.runs.getRun(ORG, a.runId)).toMatchObject({ runId: a.runId });
      expect(await store.runs.getRun(ORG + 1, a.runId)).toBeNull();
    });

    it('refuses runs it cannot store safely, such as a stage ID that is not a plain name', async () => {
      await expect(store.projectRun(makeRun({ stage: { id: 'a.b' } }))).rejects.toThrow(/stage\.id/);
      await expect(store.projectRun(makeRun({ stage: { id: '$where' } }))).rejects.toThrow(/stage\.id/);
      await expect(store.projectRun(makeRun({ seq: -1 }))).rejects.toThrow(/seq/);
    });
  });

  it('run records expire after 30 days; state does not expire', async () => {
    const runIndexes = await db.collection('stage_runs').indexes();
    expect(runIndexes.find((index) => index.name === 'at_ttl_idx')).toMatchObject({ expireAfterSeconds: 30 * 24 * 3600 });
    const stateIndexes = await db.collection('stage_state').indexes();
    expect(stateIndexes.some((index) => index.expireAfterSeconds !== undefined)).toBe(false);
    expect(stateIndexes.find((index) => index.name === 'org_delivery_stage_unique')).toMatchObject({ unique: true });
  });
});
