'use strict';

/**
 * NCX (org 812) failed every delivery with 401 from 27 Sep onward and nothing
 * ever raised it — the event-source watcher only covers a source going quiet,
 * not an integration whose deliveries all fail while its event source is
 * healthy. This watches the circuit breaker's own consecutiveFailures /
 * lastSuccessAt (see data/delivery.js recordDeliveryFailure /
 * recordDeliverySuccess) instead of the source, and otherwise mirrors
 * event-source-health.js: one alert per continuous-failure episode, one on
 * recovery.
 */

const { createDeliveryFailureHealthWatcher, FAILING_ALERT_AFTER_MS } = require('../../src/services/delivery-failure-health');

const MIN = 60 * 1000;

function setup(initialCandidates) {
  let now = Date.parse('2026-09-28T10:00:00Z');
  let candidates = initialCandidates;
  const alerts = [];
  const watcher = createDeliveryFailureHealthWatcher({
    listCandidates: async () => candidates,
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
    setCandidates: (next) => {
      candidates = next;
    },
  };
}

const failing = (overrides = {}) => [
  {
    id: 'int-812-confirm',
    orgId: 812,
    name: 'NCX - Appointment Confirmation',
    consecutiveFailures: 9,
    lastSuccessAt: null,
    lastCircuitError: 'Auth error: 401 - Token may be expired',
    ...overrides,
  },
];
const healthy = () => [
  { id: 'int-812-confirm', orgId: 812, name: 'NCX - Appointment Confirmation', consecutiveFailures: 0, lastSuccessAt: '2026-09-28T10:00:00Z' },
];

describe('delivery failure health watcher', () => {
  it('alerts once an integration has failed every delivery for an hour, not before', async () => {
    const t = setup(failing());
    await t.watcher.check();
    t.advance(FAILING_ALERT_AFTER_MS - MIN);
    await t.watcher.check();
    expect(t.alerts).toHaveLength(0);

    t.advance(MIN);
    await t.watcher.check();
    expect(t.alerts).toHaveLength(1);
    expect(t.alerts[0]).toMatchObject({ orgId: 812, type: 'INTEGRATION_DELIVERY_FAILING', status: 'FAILED', channel: 'SYSTEM' });
    expect(t.alerts[0].subject).toContain('NCX - Appointment Confirmation');
    expect(t.alerts[0].errorMessage).toContain('401');
  });

  it('raises one alert per episode, not one per check', async () => {
    const t = setup(failing());
    for (let i = 0; i < 20; i += 1) {
      await t.watcher.check();
      t.advance(10 * MIN);
    }
    expect(t.alerts.filter((a) => a.type === 'INTEGRATION_DELIVERY_FAILING')).toHaveLength(1);
  });

  it('counts from lastSuccessAt, so a pre-existing failure alerts on the first check', async () => {
    const t = setup(failing({ lastSuccessAt: '2026-09-27T00:00:00Z' }));
    await t.watcher.check();
    expect(t.alerts).toHaveLength(1);
  });

  it('records the recovery once real delivery success resets consecutiveFailures', async () => {
    const t = setup(failing());
    await t.watcher.check();
    t.advance(FAILING_ALERT_AFTER_MS);
    await t.watcher.check();

    t.setCandidates(healthy());
    await t.watcher.check();
    await t.watcher.check();
    expect(t.alerts.map((a) => a.type)).toEqual(['INTEGRATION_DELIVERY_FAILING', 'INTEGRATION_DELIVERY_RECOVERED']);
    expect(t.alerts[1]).toMatchObject({ orgId: 812, status: 'RESOLVED' });
  });

  it('does not alert for a deactivated or deleted integration that drops out of the candidate list', async () => {
    const t = setup(failing());
    await t.watcher.check();
    t.advance(FAILING_ALERT_AFTER_MS);
    await t.watcher.check();

    t.setCandidates([]); // deactivated: no longer returned at all, not returned as healthy
    await t.watcher.check();
    expect(t.alerts.map((a) => a.type)).toEqual(['INTEGRATION_DELIVERY_FAILING']);
  });

  it('does not report a recovery for a blip that never reached the alert threshold', async () => {
    const t = setup(failing());
    await t.watcher.check();
    t.setCandidates(healthy());
    await t.watcher.check();
    expect(t.alerts).toHaveLength(0);
  });

  it('keeps checking other integrations when recording one alert fails', async () => {
    let now = 0;
    const recorded = [];
    const watcher = createDeliveryFailureHealthWatcher({
      listCandidates: async () => [
        { id: 'a', orgId: 1, name: 'A', consecutiveFailures: 5, lastSuccessAt: null },
        { id: 'b', orgId: 2, name: 'B', consecutiveFailures: 5, lastSuccessAt: null },
      ],
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

/**
 * One partner integration failed every delivery for a day after its TLS
 * certificate expired. The watcher noticed, but its alerts were only written
 * to the Alert Center (nobody was told), and every restart re-raised the same
 * episode. Alerts are now also sent through `notify`, and an episode already
 * alerted before a restart is not alerted again.
 */
describe('delivery failure alerts reach people, once', () => {
  function setupWith({ alreadyAlerted = false } = {}) {
    let now = Date.parse('2026-10-20T08:00:00Z');
    const recorded = [];
    const notified = [];
    const watcher = createDeliveryFailureHealthWatcher({
      listCandidates: async () => [
        {
          id: 'int-847',
          orgId: 847,
          name: 'ORDER_PLACED → Partner CRM',
          consecutiveFailures: 40,
          lastSuccessAt: '2026-10-19T08:55:00Z',
          lastCircuitError: 'certificate has expired',
        },
      ],
      recordAlert: async (orgId, alert) => recorded.push({ orgId, ...alert }),
      notify: async (orgId, alert) => notified.push({ orgId, ...alert }),
      wasAlertedSince: async () => alreadyAlerted,
      log: () => undefined,
      now: () => now,
    });
    return { watcher, recorded, notified, advance: (ms) => (now += ms) };
  }

  it('sends the failing alert, tagged with the integration', async () => {
    const t = setupWith();
    await t.watcher.check();
    expect(t.notified).toHaveLength(1);
    expect(t.notified[0]).toMatchObject({ orgId: 847, type: 'INTEGRATION_DELIVERY_FAILING' });
    expect(t.recorded[0].payload).toEqual({ integrationId: 'int-847', integrationName: 'ORDER_PLACED → Partner CRM' });
  });

  it('does not alert again after a restart for an episode already alerted', async () => {
    const t = setupWith({ alreadyAlerted: true });
    await t.watcher.check();
    t.advance(10 * MIN);
    await t.watcher.check();
    expect(t.recorded).toHaveLength(0);
    expect(t.notified).toHaveLength(0);
  });
});
