'use strict';

/**
 * Alerts when an integration's DELIVERIES keep failing, even while its event
 * source is healthy — the gap that let NCX (org 812) fail every delivery with
 * 401 from 27 Sep onward unnoticed: services/event-source-health.js only
 * watches whether a source is still producing events, not whether what it
 * produces is actually being delivered.
 *
 * Reuses the circuit breaker's own counters (data/delivery.js
 * recordDeliveryFailure / recordDeliverySuccess): consecutiveFailures only
 * resets on a real success, so it stays accurate across HALF_OPEN retries.
 * One alert per continuous-failure episode once an integration has been
 * failing for FAILING_ALERT_AFTER_MS, and one when it recovers — the same
 * shape as event-source-health.js, applied to a different signal.
 */

const { formatDuration } = require('../utils/format-duration');

const FAILING_ALERT_AFTER_MS = 60 * 60 * 1000; // longer than the source watcher's 30 min: a single bad delivery batch is normal, sustained failure across circuit-breaker retries is not.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * @param {{
 *   listCandidates: (trackedIds: string[]) => Promise<Array<{id, orgId, name, consecutiveFailures, lastSuccessAt, lastCircuitError}>>,
 *   recordAlert: (orgId: number, alert: object) => Promise<unknown>,
 *   log: (level: string, message: string, meta?: object) => void,
 *   notify?: (orgId: number, alert: object) => Promise<unknown>,
 *   wasAlertedSince?: (integrationId: string, orgId: number, sinceMs: number) => Promise<boolean>,
 *   now?: () => number,
 *   alertAfterMs?: number,
 * }} deps
 * notify sends the alert to people (email); recordAlert only writes the Alert
 * Center. wasAlertedSince lets a restarted process recognise an episode it had
 * already alerted, instead of raising it again.
 */
function createDeliveryFailureHealthWatcher({
  listCandidates,
  recordAlert,
  log,
  notify = async () => undefined,
  wasAlertedSince = async () => false,
  now = () => Date.now(),
  alertAfterMs = FAILING_ALERT_AFTER_MS,
}) {
  /** integrationId -> { orgId, failingSince: number|null, alerted: boolean } */
  const episodes = new Map();

  async function raise(orgId, alert) {
    try {
      await recordAlert(orgId, { channel: 'SYSTEM', recipients: [], ...alert });
    } catch (error) {
      log('error', 'Could not record delivery failure health alert', { orgId, error: error.message });
    }
    try {
      await notify(orgId, alert);
    } catch (error) {
      log('error', 'Could not send delivery failure health alert', { orgId, error: error.message });
    }
  }

  async function check() {
    let candidates;
    try {
      candidates = await listCandidates([...episodes.keys()]);
    } catch (error) {
      log('warn', 'Delivery failure health check could not read candidates', { error: error.message });
      return;
    }

    const current = now();
    const seen = new Set();

    for (const integration of candidates) {
      const id = String(integration.id);
      seen.add(id);
      const episode = episodes.get(id) || { orgId: integration.orgId, failingSince: null, alerted: false };
      episode.orgId = integration.orgId;
      const failing = Number(integration.consecutiveFailures) > 0;

      if (failing) {
        if (episode.failingSince === null) {
          const lastSuccess = integration.lastSuccessAt ? Date.parse(integration.lastSuccessAt) : NaN;
          episode.failingSince = Number.isFinite(lastSuccess) ? lastSuccess : current;
        }
        const failingFor = current - episode.failingSince;
        if (!episode.alerted && failingFor >= alertAfterMs) {
          episode.alerted = true;
          if (await wasAlertedSince(id, integration.orgId, episode.failingSince).catch(() => false)) {
            // Alerted before this process started; keep tracking so recovery is still reported.
            episodes.set(id, episode);
            continue;
          }
          const subject = `Integration deliveries failing: ${integration.name} has failed every delivery for ${formatDuration(failingFor)}`;
          log('error', subject, { orgId: integration.orgId, integrationId: id, error: integration.lastCircuitError });
          await raise(integration.orgId, {
            type: 'INTEGRATION_DELIVERY_FAILING',
            status: 'FAILED',
            subject,
            errorMessage: integration.lastCircuitError || 'Unknown error',
            payload: { integrationId: id },
            windowStart: new Date(episode.failingSince),
            windowEnd: new Date(current),
          });
        }
      } else if (episode.alerted) {
        const subject = `Integration deliveries recovered: ${integration.name}`;
        log('info', subject, { orgId: integration.orgId, integrationId: id });
        await raise(integration.orgId, {
          type: 'INTEGRATION_DELIVERY_RECOVERED',
          status: 'RESOLVED',
          subject,
          payload: { integrationId: id },
          windowStart: new Date(episode.failingSince),
          windowEnd: new Date(current),
        });
        episode.failingSince = null;
        episode.alerted = false;
      } else {
        episode.failingSince = null;
      }
      episodes.set(id, episode);
    }

    // A deactivated or deleted integration is dropped without a recovered
    // alert — it stopped failing because it stopped running, not because
    // whatever was wrong got fixed.
    for (const id of episodes.keys()) {
      if (!seen.has(id)) episodes.delete(id);
    }
  }

  let timer = null;
  return {
    check,
    start(intervalMs = CHECK_INTERVAL_MS) {
      if (timer) return;
      timer = setInterval(() => {
        check().catch((error) => log('error', 'Delivery failure health check failed', { error: error.message }));
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createDeliveryFailureHealthWatcher, FAILING_ALERT_AFTER_MS, CHECK_INTERVAL_MS };
