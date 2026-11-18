'use strict';

/**
 * A migration rehearsed end to end against a real MongoDB (STAGE_MONGO_TEST_URI;
 * see stage-store.test.js) and a local provider that counts every call: real
 * deliveries (delivery-engine), the old follow-up worker, the stage job worker.
 *
 *   shadow    the old path owns; the stages run beside it and every outcome is compared
 *   switch    refused until conclusive; pending follow-up checks are handed over
 *             where they were; from then on only the stages act, with no doubled call
 *   rollback  pending stage checks go back to the old queue; the old path owns again
 */

const TEST_URI = process.env.STAGE_MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;
if (TEST_URI) {
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DATABASE = `stage_migration_e2e_${process.pid}`;
}

const http = require('http');
const mongodb = require('../../../src/mongodb');
const config = require('../../../src/config');
const integrations = require('../../../src/data/integrations');
const { ensureAllStageIndexes } = require('../../../src/stages/indexes');
const { startStageRuntime, stopStageRuntime } = require('../../../src/stages/runtime');
const migration = require('../../../src/stages/migration');
const { shadowReport } = require('../../../src/stages/migration/shadow');
const jobs = require('../../../src/stages/store/jobs');
const { processJob, compareShadowFollowUps } = require('../../../src/stages/job-worker');
const { processFollowUp } = require('../../../src/services/delivery-follow-up');
const { deliverToIntegration } = require('../../../src/processor/delivery-engine');
const runners = require('../../../src/stages/runners');
const { getStageRuntime } = require('../../../src/stages/runtime');
const { resolveCredential } = require('../../../src/stages/credentials');

jest.setTimeout(120000);

const ORG = 55;
const API_KEY = 'k-e2e-secret';
let db;
let server;
let base;
let sent = 0;
const hits = { send: 0, doc: 0, dlr: {} };
const dlrStatus = {};

const followUpScript = () => `const id = delivery.response && delivery.response.data && delivery.response.data[0] && delivery.response.data[0].id;
if (!id) return skip('No message id');
const res = await http.get('${base}/dlr?msgid=' + id, { headers: context.headers });
if (res.status !== 200) throw new Error('report returned ' + res.status);
return { status: res.data.status };`;

const stageDeps = () => ({ runners, pool: getStageRuntime().pool, resolveCredential, policy: { allowPrivate: true } });
const loadIntegration = async (orgId, id) => integrations.getIntegration(id);

async function deliver(integrationId, n) {
  const integration = await integrations.getIntegration(integrationId);
  const evt = { id: `evt-${n}-${Date.now()}`, event_type: 'APPT', orgId: ORG, attempt_count: 0, payload: { doc: `${base}/doc/ok`, n } };
  return deliverToIntegration(integration, evt, false, 0, null, null, true);
}

/** Run every due stage job once (making them due first). */
async function runStageJobs() {
  await db.collection('stage_jobs').updateMany({ state: 'PENDING' }, { $set: { nextRunAt: new Date(0) } });
  const states = [];
  for (let job = await jobs.claimDue(); job; job = await jobs.claimDue()) {
    states.push(await processJob(job, { deps: stageDeps(), loadIntegration }));
  }
  return states;
}

/** Run every pending old follow-up job once. */
async function runOldFollowUps(integrationId) {
  const pending = await db.collection('delivery_follow_ups').find({ integrationId: String(integrationId), status: 'PENDING' }).toArray();
  for (const job of pending) await processFollowUp(job, new Date(Date.now() + 10 * 24 * 3600 * 1000));
  return pending.length;
}

describeMongo('migrating an integration to stages (MongoDB, end to end)', () => {
  let integrationId;

  beforeAll(async () => {
    config.security = { ...(config.security || {}), blockPrivateNetworks: false };
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/send') {
        hits.send += 1;
        sent += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ status: true, ok: true, data: [{ id: `m-${sent}` }] }));
      }
      if (url.pathname === '/doc/ok') {
        hits.doc += 1;
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return res.end(Buffer.alloc(2048));
      }
      if (url.pathname === '/dlr') {
        const id = url.searchParams.get('msgid');
        hits.dlr[id] = (hits.dlr[id] || 0) + 1;
        if (req.headers['x-api-key'] !== API_KEY) {
          res.writeHead(401);
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ status: dlrStatus[id] || 'sent' }));
      }
      res.writeHead(404);
      return res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    db = await mongodb.connect();
    await ensureAllStageIndexes(db);
    await startStageRuntime({ isolation: 'none', allowUnisolated: true, poolSize: 2, memoryMb: 64 });

    const created = await integrations.addIntegration(ORG, {
      name: 'Partner',
      type: 'APPT',
      direction: 'OUTBOUND',
      targetUrl: `${base}/send`,
      httpMethod: 'POST',
      outgoingAuthType: 'API_KEY',
      outgoingAuthConfig: { headerName: 'X-Api-Key', apiKey: API_KEY },
      preDeliveryChecks: [{ name: 'Doc', urlPath: 'doc', timeoutMs: 5000 }],
      responseTransformation: { mode: 'SCRIPT', script: "return payload.ok === false ? skip('rejected by partner') : payload;" },
      deliveryFollowUp: { enabled: true, script: followUpScript(), checkAfterSeconds: [30, 300, 3600, 86400] },
    });
    integrationId = created.id;
  });

  afterAll(async () => {
    stopStageRuntime();
    await new Promise((resolve) => server.close(resolve));
    await db.dropDatabase();
    await mongodb.close();
  });

  it('plans the three sources as stages, and lists nothing as unsupported', async () => {
    const plan = await migration.planFor(ORG, integrationId, { followUpOrigins: [base] });
    expect(plan.stages.map((stage) => [stage.id, stage.contract])).toEqual([
      ['preDeliveryChecks', 'legacy:pre-delivery-checks'],
      ['responseCheck', 'legacy:response-transform'],
      ['deliveryStatus', 'legacy:follow-up'],
    ]);
    expect(plan.unsupported).toEqual([]);
  });

  it('shadow: the old path owns, the stages run beside it, and every outcome is compared', async () => {
    const started = await migration.startShadow(ORG, integrationId, { followUpOrigins: [base] });
    expect(started.started).toBe(true);
    for (let n = 1; n <= 3; n += 1) expect((await deliver(integrationId, n)).status).toBe('SUCCESS');

    // Each check ran twice (old and shadow), each send once.
    expect(hits).toMatchObject({ send: 3, doc: 6 });
    expect(await db.collection('delivery_follow_ups').countDocuments({ status: 'PENDING' })).toBe(3);
    expect(await db.collection('stage_jobs').countDocuments({ trigger: 'shadow', state: 'PENDING' })).toBe(3);
    const logs = await db.collection('execution_logs').find({ orgId: ORG }).toArray();
    expect(logs.every((log) => log.stageSummary === undefined)).toBe(true); // shadow runs stay off the log summary

    // Both follow-ups run to the end; then their final statuses are compared.
    for (const id of ['m-1', 'm-2', 'm-3']) dlrStatus[id] = 'READ';
    expect(await runOldFollowUps(integrationId)).toBe(3);
    expect(await runStageJobs()).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED']);
    await compareShadowFollowUps();

    const report = await shadowReport(ORG, integrationId);
    expect(report).toMatchObject({
      preDeliveryChecks: { total: 3, matches: 3, mismatches: 0 },
      responseTransformation: { total: 3, matches: 3, mismatches: 0 },
      deliveryFollowUp: { total: 3, matches: 3, mismatches: 0 },
    });
  });

  it('switch: refused until conclusive; then pending checks are handed over where they were', async () => {
    await expect(migration.switchToStages(ORG, integrationId, { minComparisons: 20 })).rejects.toMatchObject({ status: 409 });

    // Two more deliveries, and one of their old follow-ups has done its first check.
    await deliver(integrationId, 4);
    await deliver(integrationId, 5);
    const progressed = await db.collection('delivery_follow_ups').findOne({ status: 'PENDING' }, { sort: { _id: 1 } });
    dlrStatus['m-4'] = 'SENT';
    await processFollowUp(progressed, new Date(Date.now() + 60000));

    const result = await migration.switchToStages(ORG, integrationId, { minComparisons: 3 });
    expect(result).toMatchObject({ switched: true, moved: 2, inFlight: 0 });

    const integration = await integrations.getIntegration(integrationId);
    expect(integration).toMatchObject({ preDeliveryChecks: null, responseTransformation: null, deliveryFollowUp: null, stageMigration: { state: 'SWITCHED' } });
    expect(integration.stages.every((stage) => stage.shadow === false)).toBe(true);
    expect(await db.collection('delivery_follow_ups').countDocuments({ status: 'MIGRATED' })).toBe(2);
    const handed = await db.collection('stage_jobs').find({ trigger: 'accepted' }).sort({ deliveryId: 1 }).toArray();
    expect(handed.map((job) => [job.state, job.seq, job.lastStatus])).toEqual([
      ['PENDING', 2, 'SENT'],
      ['PENDING', 1, null],
    ]);
    expect(await db.collection('stage_jobs').countDocuments({ trigger: 'shadow', state: 'PENDING' })).toBe(0);
  });

  it('after the switch only the stages act: one call each, and handed-over checks carry on', async () => {
    const before = { ...hits };
    expect((await deliver(integrationId, 6)).status).toBe('SUCCESS');
    expect(hits.send - before.send).toBe(1);
    expect(hits.doc - before.doc).toBe(1); // the check ran once, as a stage
    expect(await db.collection('delivery_follow_ups').countDocuments({ status: 'PENDING' })).toBe(0);
    expect(await db.collection('stage_jobs').countDocuments({ trigger: 'accepted' })).toBe(3);
    const log = await db.collection('execution_logs').findOne({ orgId: ORG }, { sort: { _id: -1 } });
    expect(log.stageSummary.preDeliveryChecks).toMatchObject({ status: 'PASS' });

    for (const id of ['m-4', 'm-5', 'm-6']) dlrStatus[id] = 'READ';
    const dlrBefore = { ...hits.dlr };
    await runStageJobs();
    for (const id of ['m-4', 'm-5', 'm-6']) expect(hits.dlr[id] - (dlrBefore[id] || 0)).toBe(1);
    expect(await db.collection('stage_jobs').countDocuments({ trigger: 'accepted', state: 'COMPLETED' })).toBe(3);
  });

  it('an old job of a switched integration is parked by the old worker and handed over by the repair sweep', async () => {
    const logId = String((await db.collection('execution_logs').findOne({ orgId: ORG }))._id);
    await db.collection('delivery_follow_ups').insertOne({
      orgId: ORG, logId, integrationId: String(integrationId), sentAt: new Date(), delivery: { statusCode: 200, response: { data: [{ id: 'm-late' }] } },
      checkIndex: 0, nextCheckAt: new Date(0), status: 'PENDING', deliveryStatus: 'PENDING', lockedUntil: null, history: [],
    });
    const late = await db.collection('delivery_follow_ups').findOne({ logId, status: 'PENDING' });
    await processFollowUp(late, new Date());
    expect((await db.collection('delivery_follow_ups').findOne({ _id: late._id })).status).toBe('MIGRATING');
    expect(hits.dlr['m-late']).toBeUndefined(); // the old worker did not call the provider

    await migration.sweepHandovers();
    expect((await db.collection('delivery_follow_ups').findOne({ _id: late._id })).status).toBe('MIGRATED');
    await db.collection('stage_jobs').deleteMany({ deliveryId: logId, trigger: 'accepted', state: 'PENDING' });
  });

  it('rollback: pending stage checks go back to the old queue and the old path owns again', async () => {
    await deliver(integrationId, 7); // its stage follow-up is pending
    await expect(migration.rollback(ORG, integrationId, {})).rejects.toMatchObject({ status: 400 });
    const result = await migration.rollback(ORG, integrationId, { reason: 'rehearsal' });
    expect(result).toMatchObject({ rolledBack: true, handedBack: 1, inFlight: 0 });

    const integration = await integrations.getIntegration(integrationId);
    expect(integration.stageMigration.state).toBe('ROLLED_BACK');
    expect(integration.stages).toEqual([]);
    expect(integration.deliveryFollowUp).toMatchObject({ enabled: true });
    expect(integration.preDeliveryChecks).toHaveLength(1);
    expect(await db.collection('delivery_follow_ups').countDocuments({ status: 'PENDING' })).toBe(1);
    expect(await db.collection('stage_jobs').countDocuments({ state: { $in: ['PENDING', 'HANDOVER'] } })).toBe(0);

    const before = { ...hits };
    expect((await deliver(integrationId, 8)).status).toBe('SUCCESS');
    expect(hits.doc - before.doc).toBe(1); // the old check only
    expect(await db.collection('delivery_follow_ups').countDocuments({ status: 'PENDING' })).toBe(2);
  });
});
