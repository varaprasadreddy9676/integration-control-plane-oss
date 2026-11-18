'use strict';

/**
 * The pure parts of what the workflow canvas reads: branch counts per delivery
 * target and the effect of saving on waiting checks.
 */

const { buildFlowStats } = require('../../../src/stages/flow-stats');
const { saveImpact } = require('../../../src/stages/save-impact');

const stage = (id, hook, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code: 'return null;' } }, ...extra });

describe('branch counts', () => {
  const integration = {
    actions: [
      { name: 'Message', kind: 'HTTP', targetUrl: 'https://x.test', stages: [stage('consent', 'before_send'), stage('status', 'after_delivery')] },
      { name: 'Mail', kind: 'COMMUNICATION', communicationConfig: { channel: 'EMAIL' }, stages: [stage('bounce', 'after_response')] },
    ],
  };

  it('counts each stage outcome and status word, and each action\'s deliveries and retries', () => {
    const stats = buildFlowStats(integration, {
      runRows: [
        { stageId: 'consent', hook: 'before_send', outcome: 'ok', errorCode: null, status: null, runs: 90 },
        { stageId: 'consent', hook: 'before_send', outcome: 'skipped', errorCode: null, status: null, runs: 7 },
        { stageId: 'consent', hook: 'before_send', outcome: 'error', errorCode: 'STAGE_FAILED', status: null, runs: 2 },
        { stageId: 'consent', hook: 'before_send', outcome: 'error', errorCode: 'BAD_RESULT', status: null, runs: 1 },
        { stageId: 'status', hook: 'after_delivery', outcome: 'ok', errorCode: null, status: 'DELIVERED', runs: 40 },
        { stageId: 'status', hook: 'after_delivery', outcome: 'ok', errorCode: null, status: 'PENDING', runs: 55 },
        { stageId: 'status', hook: 'after_delivery', outcome: 'timeout', errorCode: 'TIMEOUT', status: null, runs: 3 },
        { stageId: 'old', hook: 'after_response', outcome: 'ok', errorCode: null, status: null, runs: 4 },
      ],
      deliveryRows: [
        { actionIndex: 0, status: 'SUCCESS', deliveries: 80, attempts: 85, retries: 5 },
        { actionIndex: 0, status: 'ABANDONED', deliveries: 3, attempts: 9, retries: 6 },
        { actionIndex: 1, status: 'SUCCESS', deliveries: 12, attempts: 12, retries: 0 },
        { actionIndex: 7, status: 'FAILED', deliveries: 2, attempts: 2, retries: 0 },
      ],
      latestRows: [
        { stageId: 'status', status: 'DELIVERED', outcome: 'ok', deliveries: 38 },
        { stageId: 'status', status: 'PENDING', outcome: 'ok', deliveries: 9 },
        { stageId: 'status', status: null, outcome: 'timeout', deliveries: 1 },
      ],
    });

    const [message, mail] = stats.targets;
    expect(message.deliveries).toEqual({ total: 83, byStatus: { SUCCESS: 80, ABANDONED: 3 }, attempts: 94, retries: 11 });
    expect(message.stages[0]).toMatchObject({ stageId: 'consent', runs: 100, ok: 90, skipped: 7, rejected: 2, errored: 1, timedOut: 0 });
    expect(message.stages[1]).toMatchObject({ stageId: 'status', runs: 98, ok: 95, timedOut: 3, statuses: { DELIVERED: 40, PENDING: 55 }, latest: { DELIVERED: 38, PENDING: 9 } });
    expect(mail.deliveries.total).toBe(12);
    expect(mail.stages[0]).toMatchObject({ stageId: 'bounce', runs: 0 });
    expect(stats.removedStages).toEqual([expect.objectContaining({ stageId: 'old', runs: 4 })]);
    expect(stats.unattributed).toMatchObject({ total: 2, byStatus: { FAILED: 2 } });
  });

  it('an integration that sends once keeps its stages and deliveries under the integration itself', () => {
    const stats = buildFlowStats(
      { stages: [stage('gate', 'before_send')] },
      { runRows: [{ stageId: 'gate', hook: 'before_send', outcome: 'ok', errorCode: null, status: null, runs: 3 }], deliveryRows: [{ actionIndex: null, status: 'SUCCESS', deliveries: 3, attempts: 3, retries: 0 }] }
    );
    expect(stats.targets).toHaveLength(1);
    expect(stats.targets[0]).toMatchObject({ actionIndex: null, deliveries: { total: 3 }, stages: [expect.objectContaining({ stageId: 'gate', ok: 3 })] });
  });

  it('is empty, not broken, when nothing happened', () => {
    expect(buildFlowStats({ stages: [] }, {}).targets[0].deliveries).toEqual({ total: 0, byStatus: {}, attempts: 0, retries: 0 });
  });
});

describe('what saving does to waiting checks', () => {
  const hashOf = (candidate) => `h:${candidate.runner.config.code}`;
  const check = (code, extra = {}) => stage('status', 'after_delivery', { runner: { type: 'script', config: { code } }, ...extra });
  const row = (state, definitionHash, count, stageId = 'status') => ({ stageId, state, definitionHash, count });
  const integrationWith = (...stages) => ({ stages });

  it('an edited stage leaves its waiting checks on their version; a check on the new version is not counted', () => {
    const impact = saveImpact(integrationWith(check('v1')), integrationWith(check('v2')), [row('PENDING', 'h:v1', 41), row('PENDING', 'h:v2', 3), row('PAUSED', 'h:v1', 2)], hashOf);
    expect(impact.stages).toEqual([expect.objectContaining({ stageId: 'status', change: 'edited', keepOldVersion: 43 })]);
    expect(impact.totals).toEqual({ keepOldVersion: 43, paused: 0, resumed: 0, cancelled: 0 });
  });

  it('switching a stage off pauses its pending checks; switching it on resumes the paused ones', () => {
    const rows = [row('PENDING', 'h:v1', 5), row('PAUSED', 'h:v1', 2)];
    expect(saveImpact(integrationWith(check('v1')), integrationWith(check('v1', { enabled: false })), rows, hashOf).totals).toMatchObject({ paused: 5, resumed: 0 });
    expect(saveImpact(integrationWith(check('v1', { enabled: false })), integrationWith(check('v1')), rows, hashOf).totals).toMatchObject({ paused: 0, resumed: 2 });
  });

  it('removing a stage cancels everything waiting for it, and adding one affects nothing', () => {
    const rows = [row('PENDING', 'h:v1', 5), row('PAUSED', 'h:v1', 2), row('HANDOVER', 'h:v1', 1)];
    const removed = saveImpact(integrationWith(check('v1')), integrationWith(), rows, hashOf);
    expect(removed.stages).toEqual([expect.objectContaining({ change: 'removed', cancelled: 8 })]);
    const added = saveImpact(integrationWith(), integrationWith(check('v1')), rows, hashOf);
    expect(added.stages).toEqual([expect.objectContaining({ change: 'added', cancelled: 0, keepOldVersion: 0 })]);
  });

  it('an unchanged stage is listed only when an earlier edit left checks on an older version', () => {
    expect(saveImpact(integrationWith(check('v2')), integrationWith(check('v2')), [row('PENDING', 'h:v2', 9)], hashOf).stages).toEqual([]);
    const left = saveImpact(integrationWith(check('v2')), integrationWith(check('v2')), [row('PENDING', 'h:v1', 4)], hashOf);
    expect(left.stages).toEqual([expect.objectContaining({ change: 'unchanged', keepOldVersion: 4 })]);
  });

  it('a rename is not an edit (the hash ignores it) and other stages\' checks are not mixed in', () => {
    const hash = (candidate) => `h:${candidate.runner.config.code}`;
    const impact = saveImpact(integrationWith(check('v1')), integrationWith(check('v1', { name: 'Renamed' })), [row('PENDING', 'h:v1', 6), row('PENDING', 'h:zzz', 9, 'other')], hash);
    expect(impact.stages).toEqual([]);
    expect(impact.totals.keepOldVersion).toBe(0);
  });
});
