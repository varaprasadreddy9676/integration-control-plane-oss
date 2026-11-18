'use strict';

/**
 * Stages through every configuration path against a real MongoDB
 * (STAGE_MONGO_TEST_URI; see stage-store.test.js): create (with provider
 * templates), update, duplicate, history/restore, export/import, delete, and what
 * each does to scheduled work.
 */

const TEST_URI = process.env.STAGE_MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;
if (TEST_URI) {
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DATABASE = `stage_plumbing_test_${process.pid}`;
}

const mongodb = require('../../../src/mongodb');
const integrations = require('../../../src/data/integrations');
const revisions = require('../../../src/data/integration-revisions');
const jobs = require('../../../src/stages/store/jobs');
const { ensureAllStageIndexes } = require('../../../src/stages/indexes');
const { stagesForExport, prepareStagesForImport } = require('../../../src/stages/integration-config');
const { repair } = require('../../../src/stages/job-worker');

jest.setTimeout(60000);

const ORG = 91;
let db;

const script = (id, hook, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code: `return { status: "${id.toUpperCase()}" };` } }, ...extra });
const base = (extra = {}) => ({
  name: 'Partner',
  type: 'APPOINTMENT_CREATED',
  direction: 'OUTBOUND',
  targetUrl: 'https://partner.example.com/hook',
  httpMethod: 'POST',
  ...extra,
});

async function pendingJob(integrationId, stageId, deliveryId = 'd1') {
  await jobs.createJob({
    orgId: ORG,
    deliveryId,
    stageId,
    trigger: 'accepted',
    failureSeq: 0,
    integrationId: String(integrationId),
    definitionHash: 'h',
    acceptedAt: new Date(),
    firstRunAt: new Date(Date.now() + 60000),
    input: {},
  });
}
const stateOf = async (stageId) => (await db.collection('stage_jobs').findOne({ stageId })).state;

describeMongo('stages in the configuration paths (MongoDB)', () => {
  beforeAll(async () => {
    db = await mongodb.connect();
    await ensureAllStageIndexes(db);
  });
  afterAll(async () => {
    await db.dropDatabase();
    await mongodb.close();
  });
  beforeEach(async () => {
    await Promise.all(['integration_configs', 'stage_jobs', 'integration_revisions', 'credential_placeholders'].map((c) => db.collection(c).deleteMany({})));
  });

  describe('create', () => {
    it('stores validated stages with their defaults, and the Send bindings', async () => {
      const created = await integrations.addIntegration(ORG, base({
        stages: [script('tok', 'before_send', { effect: 'gate', outputs: [{ name: 't', type: 'string' }] })],
        send: { bindings: { headers: { Authorization: 'Bearer {{ stages.tok.output.t }}' } } },
      }));
      expect(created.stages).toEqual([expect.objectContaining({ id: 'tok', enabled: true, contract: 1, timeoutMs: 3000, onError: { action: 'fail_stage' } })]);
      expect(created.send).toEqual({ bindings: { headers: { Authorization: 'Bearer {{ stages.tok.output.t }}' } } });
    });

    it('with templates by default, a Qikchat integration starts with the status check instead of the old follow-up', async () => {
      const config = require('../../../src/config');
      config.stages.templatesByDefault = true;
      const qikchat = await integrations.addIntegration(ORG, base({ targetUrl: 'https://api.qikchat.in/v1/messages' }));
      expect(qikchat.deliveryFollowUp).toBeNull();
      expect(qikchat.stages).toEqual([
        expect.objectContaining({
          id: 'qikchatDeliveryStatus',
          name: 'Delivery status check',
          hook: 'after_delivery',
          template: { id: 'qikchat-delivery-status', version: 1 },
          auth: { source: 'integration', allowedOrigins: ['https://api.qikchat.in'] },
        }),
      ]);
      expect((await integrations.addIntegration(ORG, base())).stages).toEqual([]);
      // Saved without the default on purpose: stays without it.
      expect((await integrations.addIntegration(ORG, base({ targetUrl: 'https://api.qikchat.in/v1/messages', stages: [] }))).stages).toEqual([]);

      // Without the switch (an environment where stages do not run yet): the old follow-up, no stage.
      config.stages.templatesByDefault = false;
      const legacy = await integrations.addIntegration(ORG, base({ targetUrl: 'https://api.qikchat.in/v1/messages' }));
      expect(legacy.stages).toEqual([]);
      expect(legacy.deliveryFollowUp).toMatchObject({ enabled: true });
    });

    it('rejects invalid stages with per-field details, and stages on a multi-action integration', async () => {
      const error = await integrations.addIntegration(ORG, base({ stages: [script('a', 'after_delivery')] })).catch((e) => e);
      expect(error).toMatchObject({ name: 'ValidationError', statusCode: 400, details: [expect.objectContaining({ path: 'stages[0].schedule' })] });
      const multi = await integrations.addIntegration(ORG, base({ actions: [{ name: 'x' }], stages: [script('b', 'on_failure')] })).catch((e) => e);
      expect(multi.details[0].message).toMatch(/put stages on each action/);
    });

    it('an integration with actions stores each action\'s stages, and its work follows them', async () => {
      const mail = { name: 'Mail', kind: 'COMMUNICATION', communicationConfig: { channel: 'EMAIL', provider: 'SMTP' } };
      const created = await integrations.addIntegration(ORG, base({ actions: [{ ...mail, stages: [script('bounce', 'on_failure')] }] }));
      expect(created.actions[0].stages[0]).toMatchObject({ id: 'bounce', enabled: true, effect: 'observe' });
      await pendingJob(created.id, 'bounce', 'd-mail');
      await integrations.updateIntegration(ORG, created.id, { actions: [{ ...mail, stages: [{ ...created.actions[0].stages[0], enabled: false }] }] });
      expect(await stateOf('bounce')).toBe('PAUSED');
      await integrations.updateIntegration(ORG, created.id, { actions: [{ ...mail, stages: [] }] });
      expect(await stateOf('bounce')).toBe('CANCELLED');
    });

    it('an enabled stage needs a credential of this org; a disabled one may wait for it', async () => {
      const withCredential = (enabled) =>
        base({ stages: [script('c', 'on_failure', { enabled, auth: { credentialRef: 'cred_missing', allowedOrigins: ['https://a.test'], headers: { K: '{{ credential.key }}' } } })] });
      expect((await integrations.addIntegration(ORG, withCredential(true)).catch((e) => e)).details[0].message).toMatch(/does not exist/);
      expect((await integrations.addIntegration(ORG, withCredential(false))).stages[0].enabled).toBe(false);
    });
  });

  describe('update, delete and restore manage scheduled work', () => {
    it('disabling a stage pauses its work, enabling resumes it, removing it cancels it', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure'), script('tell', 'on_failure')] }));
      await pendingJob(created.id, 'watch');
      await pendingJob(created.id, 'tell', 'd2');

      await integrations.updateIntegration(ORG, created.id, { stages: [{ ...created.stages[0], enabled: false }, created.stages[1]] });
      expect(await stateOf('watch')).toBe('PAUSED');
      expect(await stateOf('tell')).toBe('PENDING');

      await integrations.updateIntegration(ORG, created.id, { stages: created.stages });
      expect(await stateOf('watch')).toBe('PENDING');

      await integrations.updateIntegration(ORG, created.id, { stages: [created.stages[0]] });
      expect(await stateOf('tell')).toBe('CANCELLED');
    });

    it('switching the integration off pauses everything; an update that does not touch stages leaves them as they are', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure')] }));
      await pendingJob(created.id, 'watch');
      await integrations.updateIntegration(ORG, created.id, { name: 'Renamed' });
      expect(await stateOf('watch')).toBe('PENDING');
      await integrations.updateIntegration(ORG, created.id, { isActive: false });
      expect(await stateOf('watch')).toBe('PAUSED');
      await integrations.updateIntegration(ORG, created.id, { isActive: true });
      expect(await stateOf('watch')).toBe('PENDING');
    });

    it('an update that makes the integration multi-action is refused while it has stages', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure')] }));
      await expect(integrations.updateIntegration(ORG, created.id, { actions: [{ name: 'a' }] })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('deleting the integration cancels its work', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure')] }));
      await pendingJob(created.id, 'watch');
      await integrations.deleteIntegration(ORG, created.id);
      expect(await stateOf('watch')).toBe('CANCELLED');
    });

    it('history keeps stages, and a restore brings them back and cancels work of stages it removes', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure')] }));
      await integrations.updateIntegration(ORG, created.id, { stages: [...created.stages, script('tell', 'on_failure')] });
      await pendingJob(created.id, 'tell');
      const [latest, first] = await revisions.listRevisions(ORG, created.id);
      expect((await revisions.getRevision(ORG, created.id, latest.revision)).snapshot.stages.map((s) => s.id)).toEqual(['watch', 'tell']);

      await revisions.restoreRevision(ORG, created.id, first.revision);
      expect((await integrations.getIntegration(created.id)).stages.map((s) => s.id)).toEqual(['watch']);
      expect(await stateOf('tell')).toBe('CANCELLED');
    });

    it('work paused by a bulk switch-off resumes on its own once switched back on', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure')] }));
      await pendingJob(created.id, 'watch');
      await jobs.pauseJobs(ORG, created.id, 'watch'); // what the worker does when it finds the integration off
      await integrations.bulkUpdateIntegrations(ORG, [created.id], { isActive: true });
      await repair();
      expect(await stateOf('watch')).toBe('PENDING');
    });
  });

  describe('duplicate, export and import', () => {
    it('a duplicate carries the stages and Send bindings', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure')], stageBudgetMs: 2000 }));
      const { id, entityName, createdAt, updatedAt, ...copy } = await integrations.getIntegration(created.id);
      const duplicate = await integrations.addIntegration(ORG, { ...copy, name: `${copy.name} (Copy)` });
      expect(duplicate.stages).toEqual(created.stages);
      expect(duplicate.stageBudgetMs).toBe(2000);
    });

    it('a sensitive export round-trips stages exactly', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure'), script('tok', 'before_send')] }));
      const exported = JSON.parse(JSON.stringify(stagesForExport(created.stages, true)));
      const { stages, attention } = await prepareStagesForImport(exported, { orgId: ORG });
      expect(attention).toEqual([]);
      const imported = await integrations.addIntegration(ORG, base({ stages }));
      expect(imported.stages).toEqual(created.stages);
    });

    it('without sensitive data, scripts are left out; importing restores them from the same integration or switches the stage off', async () => {
      const created = await integrations.addIntegration(ORG, base({ stages: [script('watch', 'on_failure')] }));
      const exported = stagesForExport(created.stages, false);
      expect(exported[0].runner.config).toEqual({ codeOmitted: true, codeLength: created.stages[0].runner.config.code.length });

      const onUpdate = await prepareStagesForImport(exported, { orgId: ORG, existingStages: created.stages });
      expect(onUpdate).toEqual({ stages: [created.stages[0]], attention: [] });

      const intoNew = await prepareStagesForImport(exported, { orgId: ORG });
      expect(intoNew.stages[0]).toMatchObject({ enabled: false, runner: { config: { code: expect.stringMatching(/not included/) } } });
      expect(intoNew.attention).toEqual([{ stageId: 'watch', reason: expect.stringMatching(/script was not in the export/) }]);
      expect((await integrations.addIntegration(ORG, base({ stages: intoNew.stages }))).stages[0].enabled).toBe(false);
    });

    it('a credential from another org is not reused: the stage comes in switched off until rebound', async () => {
      const stage = script('c', 'on_failure', { auth: { credentialRef: 'cred_elsewhere', allowedOrigins: ['https://a.test'], headers: { K: '{{ credential.key }}' } } });
      const { stages, attention } = await prepareStagesForImport([stage], { orgId: ORG });
      expect(stages[0].enabled).toBe(false);
      expect(attention[0].reason).toMatch(/cred_elsewhere does not exist/);
    });
  });
});
