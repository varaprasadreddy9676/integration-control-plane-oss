'use strict';

/**
 * Production's org 783 event source failed every 30s for 19 days
 * (connect ETIMEDOUT, 2026-09-06 → 2026-09-25) and nobody knew — the adapter
 * counted consecutiveErrors but nothing ever looked at it. The watcher raises
 * one alert per failure episode once a source has been failing for 30 minutes,
 * and one when it recovers.
 */

const { createEventSourceHealthWatcher, FAILING_ALERT_AFTER_MS } = require('../../src/services/event-source-health');

const MIN = 60 * 1000;

function setup(initialStatus) {
  let now = Date.parse('2026-09-28T10:00:00Z');
  let status = initialStatus;
  const alerts = [];
  const watcher = createEventSourceHealthWatcher({
    getStatus: async () => status,
    recordAlert: async (orgId, alert) => alerts.push({ orgId, ...alert }),
    log: () => undefined,
    now: () => now,
  });
  return {
    watcher,
    alerts,
    advance: (ms) => {
      now += ms;
    },
    setStatus: (next) => {
      status = next;
    },
  };
}

const failing = (orgId, extra = {}) => ({
  adapters: [{ orgId, name: `MysqlEventSource[org=${orgId}]`, consecutiveErrors: 3, lastSuccessAt: null, lastErrorMessage: 'connect ETIMEDOUT', ...extra }],
  desiredConfigs: [],
});
const healthy = (orgId) => ({
  adapters: [{ orgId, name: `MysqlEventSource[org=${orgId}]`, consecutiveErrors: 0, lastSuccessAt: '2026-09-28T10:00:00Z' }],
  desiredConfigs: [],
});

describe('event source health watcher', () => {
  it('alerts once a source has been failing for 30 minutes, not before', async () => {
    const t = setup(failing(783));
    await t.watcher.check();
    t.advance(FAILING_ALERT_AFTER_MS - MIN);
    await t.watcher.check();
    expect(t.alerts).toHaveLength(0);

    t.advance(MIN);
    await t.watcher.check();
    expect(t.alerts).toHaveLength(1);
    expect(t.alerts[0]).toMatchObject({ orgId: 783, type: 'EVENT_SOURCE_DOWN', status: 'FAILED', channel: 'SYSTEM' });
    expect(t.alerts[0].errorMessage).toContain('connect ETIMEDOUT');
  });

  it('raises one alert per episode, not one per check', async () => {
    const t = setup(failing(783));
    for (let i = 0; i < 120; i += 1) {
      await t.watcher.check();
      t.advance(MIN);
    }
    expect(t.alerts.filter((a) => a.type === 'EVENT_SOURCE_DOWN')).toHaveLength(1);
  });

  it('counts from the last success, so a long outage alerts on the first check after a restart', async () => {
    const t = setup(failing(783, { lastSuccessAt: '2026-09-28T08:00:00Z' }));
    await t.watcher.check();
    expect(t.alerts).toHaveLength(1);
  });

  it('records the recovery once, then can alert again on a new episode', async () => {
    const t = setup(failing(783));
    await t.watcher.check();
    t.advance(FAILING_ALERT_AFTER_MS);
    await t.watcher.check();

    t.setStatus(healthy(783));
    await t.watcher.check();
    await t.watcher.check();
    expect(t.alerts.map((a) => a.type)).toEqual(['EVENT_SOURCE_DOWN', 'EVENT_SOURCE_RECOVERED']);
    expect(t.alerts[1]).toMatchObject({ status: 'RESOLVED' });

    t.setStatus(failing(783));
    await t.watcher.check();
    t.advance(FAILING_ALERT_AFTER_MS);
    await t.watcher.check();
    expect(t.alerts.map((a) => a.type)).toEqual(['EVENT_SOURCE_DOWN', 'EVENT_SOURCE_RECOVERED', 'EVENT_SOURCE_DOWN']);
  });

  it('does not report a recovery for a blip that never alerted', async () => {
    const t = setup(failing(783));
    await t.watcher.check();
    t.setStatus(healthy(783));
    await t.watcher.check();
    expect(t.alerts).toHaveLength(0);
  });

  it('treats a source that failed to start as failing', async () => {
    const t = setup({
      adapters: [],
      desiredConfigs: [{ orgId: 892, state: 'error', error: { message: 'Access denied for user' } }],
    });
    await t.watcher.check();
    t.advance(FAILING_ALERT_AFTER_MS);
    await t.watcher.check();
    expect(t.alerts[0]).toMatchObject({ orgId: 892, type: 'EVENT_SOURCE_DOWN' });
    expect(t.alerts[0].errorMessage).toContain('Access denied');
  });

  it('keeps checking other sources when recording one alert fails', async () => {
    let now = 0;
    const recorded = [];
    const watcher = createEventSourceHealthWatcher({
      getStatus: async () => ({ adapters: [failing(1).adapters[0], failing(2).adapters[0]], desiredConfigs: [] }),
      recordAlert: async (orgId) => {
        if (orgId === 1) throw new Error('mongo down');
        recorded.push(orgId);
      },
      log: () => undefined,
      now: () => now,
    });
    await watcher.check();
    now += FAILING_ALERT_AFTER_MS;
    await expect(watcher.check()).resolves.toBeUndefined();
    expect(recorded).toEqual([2]);
  });
});
