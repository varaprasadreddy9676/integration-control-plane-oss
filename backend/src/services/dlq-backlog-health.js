'use strict';

/**
 * Alerts when failed deliveries pile up in an organization's dead-letter queue
 * (pending or retrying), and again when the backlog clears. One alert per
 * episode: it is raised at the threshold and cleared below half of it, so a
 * queue hovering around the threshold does not flap. An alert already raised
 * before a restart is not raised again.
 */

const DEFAULT_THRESHOLD = Number(process.env.DLQ_ALERT_THRESHOLD) || 100;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function createDlqBacklogWatcher({ countBacklogByOrg, lastAlertType, raise, log, threshold = DEFAULT_THRESHOLD }) {
  /** orgId -> true while an alert is open */
  const open = new Map();

  async function isOpen(orgId) {
    if (!open.has(orgId)) open.set(orgId, (await lastAlertType(orgId).catch(() => null)) === 'DLQ_BACKLOG');
    return open.get(orgId);
  }

  async function check() {
    let counts;
    try {
      counts = await countBacklogByOrg();
    } catch (error) {
      log('warn', 'Dead-letter queue backlog check failed', { error: error.message });
      return;
    }
    const orgIds = new Set([...counts.keys(), ...open.keys()]);
    for (const orgId of orgIds) {
      const count = counts.get(orgId) || 0;
      const alerted = await isOpen(orgId);
      if (!alerted && count >= threshold) {
        open.set(orgId, true);
        await raise(orgId, {
          type: 'DLQ_BACKLOG',
          status: 'FAILED',
          subject: `${count} failed deliveries are waiting in the dead-letter queue`,
          errorMessage: `The dead-letter queue holds ${count} deliveries waiting to be retried or resolved (alert threshold: ${threshold}).`,
          payload: { count },
          windowEnd: new Date(),
        });
      } else if (alerted && count < threshold / 2) {
        open.set(orgId, false);
        await raise(orgId, {
          type: 'DLQ_BACKLOG_CLEARED',
          status: 'RESOLVED',
          subject: `The dead-letter queue backlog has cleared (${count} waiting)`,
          payload: { count },
          windowEnd: new Date(),
        });
      }
    }
  }

  let timer = null;
  return {
    check,
    start(intervalMs = CHECK_INTERVAL_MS) {
      if (timer) return;
      timer = setInterval(() => {
        check().catch((error) => log('error', 'Dead-letter queue backlog check failed', { error: error.message }));
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createDlqBacklogWatcher, DEFAULT_THRESHOLD };
