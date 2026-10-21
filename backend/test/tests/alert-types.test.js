'use strict';

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const { ALERT_EVENTS, ALERT_EVENT_TYPES } = require('../../src/services/notifications/alert-events');
const { toChannelAlert } = require('../../src/services/notifications/alert-dispatcher');
const { createAlertRaiser } = require('../../src/services/notifications/raise-alert');
const { alertOnScheduledJobOutcome } = require('../../src/services/scheduled-job-alerts');
const { createDlqBacklogWatcher } = require('../../src/services/dlq-backlog-health');

describe('alert types', () => {
  it('covers integrations, event sources, scheduled jobs and the dead-letter queue, each with its all-clear', () => {
    expect(ALERT_EVENT_TYPES).toEqual([
      'INTEGRATION_DELIVERY_FAILING',
      'INTEGRATION_DELIVERY_RECOVERED',
      'EVENT_SOURCE_DOWN',
      'EVENT_SOURCE_RECOVERED',
      'SCHEDULED_JOB_FAILED',
      'SCHEDULED_JOB_RECOVERED',
      'DLQ_BACKLOG',
      'DLQ_BACKLOG_CLEARED',
    ]);
    for (const event of ALERT_EVENTS) expect(event.label).toEqual(expect.any(String));
  });

  it.each([
    ['INTEGRATION_DELIVERY_FAILING', { integrationId: 'i1' }, 'critical', '/logs?orgId=1'],
    ['EVENT_SOURCE_RECOVERED', {}, 'resolved', '/settings/event-source?orgId=1'],
    ['SCHEDULED_JOB_FAILED', { jobId: 'j1', jobName: 'Nightly sync' }, 'critical', '/scheduled-jobs/j1?orgId=1'],
    ['DLQ_BACKLOG_CLEARED', {}, 'resolved', '/dlq?orgId=1'],
  ])('%s links to the right console page', (type, payload, severity, path) => {
    const alert = toChannelAlert(1, { type, subject: 'S', payload }, { frontendUrl: 'https://c.example.com/' });
    expect(alert.severity).toBe(severity);
    expect(alert.link).toBe(`https://c.example.com${path}`);
  });

  it('describes the scheduled job an alert is about', () => {
    const alert = toChannelAlert(1, { type: 'SCHEDULED_JOB_FAILED', subject: 'S', payload: { jobId: 'j1', jobName: 'Nightly sync' } });
    expect(alert.job).toEqual({ id: 'j1', name: 'Nightly sync' });
  });
});

describe('raiseAlert', () => {
  it('records the alert in the Alert Center and sends it to the channels', async () => {
    const recordAlert = jest.fn();
    const dispatch = jest.fn().mockResolvedValue([]);
    const raise = createAlertRaiser({ recordAlert, dispatch, getOrgName: async () => 'Acme', frontendUrl: 'https://c.example.com' });

    await raise(1, { type: 'EVENT_SOURCE_DOWN', subject: 'Event source down: MySQL', errorMessage: 'ECONNREFUSED' });

    expect(recordAlert).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'EVENT_SOURCE_DOWN', channel: 'SYSTEM' }));
    expect(dispatch).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: 'EVENT_SOURCE_DOWN', orgName: 'Acme', message: 'ECONNREFUSED', severity: 'critical' })
    );
  });

  it('still sends to channels when the Alert Center write fails, and never throws', async () => {
    const dispatch = jest.fn().mockResolvedValue([]);
    const raise = createAlertRaiser({
      recordAlert: jest.fn().mockRejectedValue(new Error('mongo down')),
      dispatch,
      getOrgName: async () => undefined,
    });
    await expect(raise(1, { type: 'DLQ_BACKLOG', subject: 'S' })).resolves.toBeUndefined();
    expect(dispatch).toHaveBeenCalled();
  });
});

describe('scheduled job failure alerts', () => {
  const job = { _id: { toString: () => 'j1' }, orgId: 1, name: 'Nightly sync' };
  const run = (status, previous, extra = {}) => {
    const raise = jest.fn();
    return alertOnScheduledJobOutcome({
      job,
      result: { status, logId: 'log-2', error: 'Target returned 500' },
      previousStatus: async () => previous,
      raise,
      ...extra,
    }).then(() => raise);
  };

  it('alerts when a job that worked (or never ran) fails', async () => {
    for (const previous of ['SUCCESS', null]) {
      const raise = await run('FAILED', previous);
      expect(raise).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          type: 'SCHEDULED_JOB_FAILED',
          errorMessage: 'Target returned 500',
          payload: { jobId: 'j1', jobName: 'Nightly sync' },
        })
      );
    }
  });

  it('does not alert again while it keeps failing', async () => {
    expect(await run('FAILED', 'FAILED')).not.toHaveBeenCalled();
  });

  it('reports the recovery on the first success after a failure', async () => {
    const raise = await run('SUCCESS', 'FAILED');
    expect(raise).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'SCHEDULED_JOB_RECOVERED' }));
    expect(await run('SUCCESS', 'SUCCESS')).not.toHaveBeenCalled();
  });

  it('ignores dry runs, skips and locked runs', async () => {
    expect(await run('FAILED', 'SUCCESS', { dryRun: true })).not.toHaveBeenCalled();
    expect(await run('SKIPPED', 'FAILED')).not.toHaveBeenCalled();
    expect(await run('SKIPPED_LOCKED', 'FAILED')).not.toHaveBeenCalled();
  });
});

describe('dead-letter queue backlog alerts', () => {
  function setup({ counts, lastAlertType = null }) {
    const raise = jest.fn();
    const state = { counts };
    const watcher = createDlqBacklogWatcher({
      countBacklogByOrg: async () => new Map(Object.entries(state.counts).map(([k, v]) => [Number(k), v])),
      lastAlertType: async () => lastAlertType,
      raise,
      log: jest.fn(),
      threshold: 100,
    });
    return { watcher, raise, state };
  }

  it('alerts once when an organization’s backlog reaches the threshold', async () => {
    const { watcher, raise, state } = setup({ counts: { 1: 150, 2: 5 } });
    await watcher.check();
    await watcher.check();
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'DLQ_BACKLOG', payload: { count: 150 } }));

    state.counts = { 1: 80 };
    await watcher.check();
    expect(raise).toHaveBeenCalledTimes(1); // below threshold but not yet clear (half)

    state.counts = { 1: 20 };
    await watcher.check();
    expect(raise).toHaveBeenLastCalledWith(1, expect.objectContaining({ type: 'DLQ_BACKLOG_CLEARED' }));
  });

  it('does not repeat an alert that was already raised before a restart', async () => {
    const { watcher, raise } = setup({ counts: { 1: 150 }, lastAlertType: 'DLQ_BACKLOG' });
    await watcher.check();
    expect(raise).not.toHaveBeenCalled();
  });

  it('reports the all-clear when an org’s queue empties entirely', async () => {
    const { watcher, raise, state } = setup({ counts: { 1: 150 } });
    await watcher.check();
    state.counts = {};
    await watcher.check();
    expect(raise).toHaveBeenLastCalledWith(1, expect.objectContaining({ type: 'DLQ_BACKLOG_CLEARED' }));
  });
});
