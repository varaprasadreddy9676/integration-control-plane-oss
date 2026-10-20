'use strict';

/**
 * Turns the event sources' own failure counters into alerts. Production's org
 * 783 source failed every 30s for 19 days and nobody knew: the adapter counted
 * consecutiveErrors, but nothing ever looked at them.
 *
 * One alert per failure episode once a source has been failing for
 * FAILING_ALERT_AFTER_MS, and one when it recovers. The alert goes to the
 * server log (error level) and to that org's Alert Center.
 */

const { formatDuration } = require('../utils/format-duration');

const FAILING_ALERT_AFTER_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

/** Flatten manager status into { orgId, name, failing, lastSuccessAt, message }. */
function readSources(status) {
  const sources = new Map();
  for (const adapter of status?.adapters || []) {
    sources.set(Number(adapter.orgId), {
      orgId: Number(adapter.orgId),
      name: adapter.name || adapter.adapterName || `org ${adapter.orgId}`,
      failing: Number(adapter.consecutiveErrors) > 0 || adapter.connectionStatus === 'error',
      lastSuccessAt: adapter.lastSuccessAt || null,
      message: adapter.lastErrorMessage || adapter.statusError || null,
    });
  }
  // A source that could not even be started never shows up as a running adapter.
  for (const desired of status?.desiredConfigs || []) {
    const orgId = Number(desired.orgId);
    if (desired.state !== 'error' || sources.has(orgId)) continue;
    sources.set(orgId, {
      orgId,
      name: `${desired.sourceType || 'event'} source for org ${orgId}`,
      failing: true,
      lastSuccessAt: null,
      message: desired.error?.message || 'Event source failed to start',
    });
  }
  return [...sources.values()];
}

/**
 * @param {{
 *   getStatus: () => Promise<object>,
 *   recordAlert: (orgId: number, alert: object) => Promise<unknown>,
 *   log: (level: string, message: string, meta?: object) => void,
 *   now?: () => number,
 *   alertAfterMs?: number,
 * }} deps
 */
function createEventSourceHealthWatcher({
  getStatus,
  recordAlert,
  log,
  now = () => Date.now(),
  alertAfterMs = FAILING_ALERT_AFTER_MS,
}) {
  /** orgId -> { failingSince: number|null, alerted: boolean } */
  const episodes = new Map();

  async function raise(orgId, alert) {
    try {
      await recordAlert(orgId, { channel: 'SYSTEM', recipients: [], ...alert });
    } catch (error) {
      log('error', 'Could not record event source health alert', { orgId, error: error.message });
    }
  }

  async function check() {
    let status;
    try {
      status = await getStatus();
    } catch (error) {
      log('warn', 'Event source health check could not read source status', { error: error.message });
      return;
    }

    const current = now();
    const seen = new Set();

    for (const source of readSources(status)) {
      seen.add(source.orgId);
      const episode = episodes.get(source.orgId) || { failingSince: null, alerted: false };

      if (source.failing) {
        if (episode.failingSince === null) {
          const lastSuccess = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : NaN;
          episode.failingSince = Number.isFinite(lastSuccess) ? lastSuccess : current;
        }
        const failingFor = current - episode.failingSince;
        if (!episode.alerted && failingFor >= alertAfterMs) {
          episode.alerted = true;
          const subject = `Event source down: ${source.name} has been failing for ${formatDuration(failingFor)}`;
          log('error', subject, { orgId: source.orgId, error: source.message });
          await raise(source.orgId, {
            type: 'EVENT_SOURCE_DOWN',
            status: 'FAILED',
            subject,
            errorMessage: source.message || 'Unknown error',
            windowStart: new Date(episode.failingSince),
            windowEnd: new Date(current),
          });
        }
      } else if (episode.alerted) {
        const subject = `Event source recovered: ${source.name}`;
        log('info', subject, { orgId: source.orgId });
        await raise(source.orgId, {
          type: 'EVENT_SOURCE_RECOVERED',
          status: 'RESOLVED',
          subject,
          windowStart: new Date(episode.failingSince),
          windowEnd: new Date(current),
        });
        episode.failingSince = null;
        episode.alerted = false;
      } else {
        episode.failingSince = null;
      }
      episodes.set(source.orgId, episode);
    }

    // Sources that were removed or deactivated are no longer tracked.
    for (const orgId of episodes.keys()) {
      if (!seen.has(orgId)) episodes.delete(orgId);
    }
  }

  let timer = null;
  return {
    check,
    start(intervalMs = CHECK_INTERVAL_MS) {
      if (timer) return;
      timer = setInterval(() => {
        check().catch((error) => log('error', 'Event source health check failed', { error: error.message }));
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createEventSourceHealthWatcher, FAILING_ALERT_AFTER_MS, CHECK_INTERVAL_MS };
