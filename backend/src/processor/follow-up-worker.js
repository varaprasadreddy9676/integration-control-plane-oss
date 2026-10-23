'use strict';

/**
 * Runs the delivery follow-up checks that have come due (see
 * services/delivery-follow-up.js). Each pass takes a bounded number of jobs,
 * a few at a time, so a backlog never turns into a burst of calls to a
 * provider. Jobs are leased in the queue, so several processes can run this
 * safely.
 */

const queue = require('../data/delivery-follow-ups');
const followUp = require('../services/delivery-follow-up');
const { log } = require('../logger');
const { markWorkerRunError, markWorkerRunStart, markWorkerRunSuccess, setWorkerState, stopWorker } = require('../worker-heartbeat');

const WORKER = 'followUpWorker';
const POLL_MS = Number(process.env.FOLLOW_UP_POLL_MS) || 15000;
const MAX_PER_RUN = Number(process.env.FOLLOW_UP_MAX_PER_RUN) || 20;
const CONCURRENCY = Number(process.env.FOLLOW_UP_CONCURRENCY) || 4;

let timer = null;
let running = false;

/** Check due jobs until none are left or the per-run cap is reached. Resolves to how many were checked. */
async function processDueFollowUps(now = new Date()) {
  let taken = 0;
  const lane = async () => {
    while (taken < MAX_PER_RUN) {
      const job = await queue.claimDue(now);
      if (!job) return;
      taken += 1;
      try {
        await followUp.processFollowUp(job, new Date());
      } catch (error) {
        // The lease expires and the job is tried again.
        log('warn', 'Delivery follow-up check failed', { jobId: String(job._id), error: error.message });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return taken;
}

/** One guarded pass. Resolves to the number checked, or null when skipped or failed. */
async function runOnce() {
  if (running) return null;
  running = true;
  markWorkerRunStart(WORKER);
  try {
    const processed = await processDueFollowUps();
    markWorkerRunSuccess(WORKER, { meta: { lastProcessed: processed } });
    return processed;
  } catch (error) {
    log('error', 'Delivery follow-up pass failed', { error: error.message });
    markWorkerRunError(WORKER, error);
    return null;
  } finally {
    running = false;
  }
}

function startFollowUpWorker() {
  if (timer) return;
  setWorkerState(WORKER, {
    enabled: true,
    running: true,
    startedAt: new Date(),
    thresholdMs: POLL_MS * 6,
    meta: { everyMs: POLL_MS, maxPerRun: MAX_PER_RUN, concurrency: CONCURRENCY },
  });
  timer = setInterval(runOnce, POLL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  log('info', 'Delivery follow-up worker started', { everyMs: POLL_MS });
}

function stopFollowUpWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  stopWorker(WORKER);
}

module.exports = {
  MAX_PER_RUN,
  CONCURRENCY,
  processDueFollowUps,
  runOnce,
  startFollowUpWorker,
  stopFollowUpWorker,
};
