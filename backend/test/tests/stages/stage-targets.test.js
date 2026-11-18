'use strict';

/**
 * Where stages live (the integration, or each action) and the one shape a stage
 * sees of any delivery; and how saving, permissions and scheduled work follow
 * stages wherever they live.
 */

const targets = require('../../../src/stages/targets');
const { deliveryResponse, fromLog, parseBody } = require('../../../src/stages/delivery-shape');
const { changesStages, stageFieldsForCreate, stageFieldsForUpdate, applyStageLifecycle } = require('../../../src/stages/integration-config');

const stage = (id, extra = {}) => ({ id, name: id, hook: 'on_failure', runner: { type: 'script', config: { code: 'return null;' } }, ...extra });
const email = (extra = {}) => ({ name: 'Mail', kind: 'COMMUNICATION', communicationConfig: { channel: 'EMAIL', provider: 'SMTP' }, ...extra });
const hl7 = (extra = {}) => ({ name: 'Order', kind: 'HL7_MLLP', ...extra });
const deps = { credentialExists: async () => true };

describe('targets', () => {
  it('a single delivery keeps its stages on the integration; with actions, each action has its own', () => {
    expect(targets.stageTargets({ stages: [stage('a')] })).toEqual([
      expect.objectContaining({ actionIndex: null, path: '', protocol: 'http', requestParts: ['headers', 'query', 'fields'], stages: [stage('a')] }),
    ]);
    const multi = { actions: [email({ stages: [stage('m')] }), hl7(), { name: 'Hook' }] };
    expect(targets.stageTargets(multi).map((t) => [t.path, t.protocol, t.requestParts])).toEqual([
      ['actions[0].', 'email', ['fields']],
      ['actions[1].', 'hl7', ['fields']],
      ['actions[2].', 'http', ['headers', 'query', 'fields']],
    ]);
    expect(targets.findStage(multi, 'm')).toMatchObject({ stage: { id: 'm' }, target: { actionIndex: 0 } });
    expect(targets.findStage(multi, 'nope')).toBeNull();
    expect(targets.targetOf(multi, 5)).toBeNull();
  });

  it('allStages and mapTargets cover every delivery, and never change the integration', () => {
    const multi = { stages: [stage('stray')], actions: [email({ stages: [stage('m')] }), hl7({ stages: [stage('h')] })] };
    expect(targets.allStages(multi).map((s) => s.id)).toEqual(['stray', 'm', 'h']);
    const renamed = targets.mapTargets(multi, ({ stages }) => ({ stages: stages.map((s) => ({ ...s, name: 'x' })) }));
    expect(renamed.actions.map((a) => a.stages[0].name)).toEqual(['x', 'x']);
    expect(multi.actions[0].stages[0].name).toBe('m');
  });

  it('a stage runs its scheduled work only while it, its integration and the kill switch are on', () => {
    expect(targets.stageRunsNow({ isActive: true }, stage('a'))).toBe(true);
    expect(targets.stageRunsNow({ isActive: false }, stage('a'))).toBe(false);
    expect(targets.stageRunsNow({ stagesPaused: true }, stage('a'))).toBe(false);
    expect(targets.stageRunsNow({}, stage('a', { enabled: false }))).toBe(false);
  });
});

describe('the delivery shape', () => {
  it('one answer shape for every send', () => {
    expect(deliveryResponse({ status: 503, body: 'down' })).toMatchObject({ ok: false, status: 503, code: '503', body: 'down' });
    expect(deliveryResponse({ ok: true, code: 'SENT', providerMessageId: 'x', body: '{"a":1}' })).toMatchObject({ ok: true, status: null, code: 'SENT', body: { a: 1 } });
    expect(parseBody('42')).toBe('42');
    expect(parseBody(undefined)).toBeNull();
  });

  it('reads any delivery log, whatever was sent', () => {
    expect(fromLog({ targetUrl: 'https://t.test', httpMethod: 'POST', requestPayload: { a: 1 }, responseStatus: 200, responseBody: '{"id":1}', status: 'SUCCESS' })).toEqual({
      request: { protocol: 'http', target: 'https://t.test', method: 'POST', body: { a: 1 } },
      response: expect.objectContaining({ protocol: 'http', ok: true, status: 200, code: '200', body: { id: 1 } }),
    });
    expect(fromLog({ targetUrl: 'SMS:MSG91', httpMethod: 'COMMUNICATION', messageId: 'r-1', status: 'SUCCESS', responseStatus: 200 })).toMatchObject({
      request: { protocol: 'sms', target: 'SMS:MSG91', method: null },
      response: { protocol: 'sms', ok: true, status: null, code: 'SENT', providerMessageId: 'r-1' },
    });
    expect(fromLog({ targetUrl: 'mllp://h:1', httpMethod: 'HL7_MLLP', status: 'FAILED', metadata: { hl7: { ackCode: 'AE' } } })).toMatchObject({
      response: { protocol: 'hl7', ok: false, code: 'AE' },
    });
  });
});

describe('saving stages wherever they live', () => {
  it('validates and normalizes action stages on create and update', async () => {
    const created = await stageFieldsForCreate(1, { direction: 'INBOUND', actions: [email({ stages: [stage('n')] })] }, deps);
    expect(created.actions[0].stages[0]).toMatchObject({ id: 'n', enabled: true, effect: 'observe' });
    await expect(stageFieldsForCreate(1, { actions: [email({ send: { bindings: { headers: { A: 'b' } } } })] }, deps)).rejects.toThrow(/actions\[0\]\.send\.bindings\.headers/);
    const existing = { direction: 'OUTBOUND', actions: [email()] };
    expect(await stageFieldsForUpdate(1, existing, { name: 'only a name' }, deps)).toBeNull();
    const updated = await stageFieldsForUpdate(1, existing, { actions: [email({ stages: [stage('u')] })] }, deps);
    expect(updated.actions[0].stages[0]).toMatchObject({ id: 'u', enabled: true });
  });

  it('a change to any action\'s stages needs stages:edit; adding, editing or reordering actions without them does not', () => {
    const before = { actions: [email({ stages: [stage('a')] }), hl7()] };
    expect(changesStages({ actions: [hl7(), email({ stages: [stage('a')] })] }, before)).toBe(false);
    expect(changesStages({ actions: [email({ stages: [stage('a')], name: 'Renamed' }), hl7(), { name: 'New' }] }, before)).toBe(false);
    expect(changesStages({ actions: [email({ stages: [stage('a', { name: 'B' })] }), hl7()] }, before)).toBe(true);
    expect(changesStages({ actions: [email()] }, before)).toBe(true);
    expect(changesStages({ actions: [email({ stages: [stage('a')] })] })).toBe(true);
    expect(changesStages({ actions: [email()] })).toBe(false);
  });

  it('scheduled work follows stages on actions: removed cancels, switched off pauses, back on resumes', async () => {
    const calls = [];
    const jobs = {
      cancelJobs: async (...args) => calls.push(['cancel', args[2]]),
      pauseJobs: async (...args) => calls.push(['pause', args[2]]),
      resumeJobs: async (...args) => calls.push(['resume', args[2]]),
    };
    const before = { actions: [email({ stages: [stage('gone'), stage('off'), stage('back', { enabled: false })] })] };
    const after = { actions: [email({ stages: [stage('off', { enabled: false }), stage('back')] })] };
    await applyStageLifecycle({ orgId: 1, integrationId: 'i', before, after }, jobs);
    expect(calls).toEqual([['cancel', 'gone'], ['pause', 'off'], ['resume', 'back']]);
  });
});
