'use strict';

/**
 * When a deferred stage runs and what its job does after each run. Pure: no
 * clock or database of its own (callers pass `now`).
 *
 * after_delivery checks run at offsets from the accepted-send time
 * (checkAfterSeconds), or repeat every N seconds up to a maximum age or count.
 * A check that is not done moves to the next slot still ahead; missed slots
 * (after a pause or an outage) are skipped, never caught up in a burst.
 * on_failure runs once per terminal failure.
 *
 * Scheduling progress (seq, checksDone) and error retries (executionAttempt) are
 * separate counters.
 */

const NOT_STARTED = new Set(['BUSY', 'UNAVAILABLE', 'NOT_ISOLATED', 'SHUTDOWN']);
const DEFER_NOT_STARTED_MS = 60 * 1000;
const DEFER_LIMITED_MS = 30 * 1000;
const KEEP_FINISHED_MS = 30 * 24 * 3600 * 1000;
const EXPIRY_GRACE_MS = 24 * 3600 * 1000;

const addMs = (date, ms) => new Date(new Date(date).getTime() + ms);

function firstRunAt(stage, startedAt) {
  if (stage.hook !== 'after_delivery') return new Date(startedAt);
  const schedule = stage.schedule || {};
  const offset = schedule.checkAfterSeconds ? schedule.checkAfterSeconds[0] : schedule.everySeconds;
  return addMs(startedAt, offset * 1000);
}

/** The latest time the job can still be expected to run (for expiry and retention). */
function lastRunBy(stage, startedAt) {
  const onError = stage.onError || {};
  const retries = (onError.backoffSeconds || []).reduce((sum, s) => sum + s, 0) * 1000;
  if (stage.hook !== 'after_delivery') return addMs(startedAt, retries);
  const schedule = stage.schedule || {};
  const span = schedule.checkAfterSeconds
    ? schedule.checkAfterSeconds[schedule.checkAfterSeconds.length - 1]
    : schedule.maxAgeSeconds;
  return addMs(startedAt, span * 1000 + retries);
}

/** Has this job's window passed (the work is too old to be meaningful)? */
function isExpired(stage, job, now) {
  return now.getTime() > lastRunBy(stage, job.acceptedAt).getTime() + EXPIRY_GRACE_MS;
}

function finalState(state, now, extra = {}) {
  return {
    state,
    input: null,
    lease: null,
    finishedAt: now,
    purgeAt: addMs(now, KEEP_FINISHED_MS),
    ...extra,
  };
}

/** The next check after the one that just ran (or finished), or the end of the schedule. */
function advance(stage, job, now, extra) {
  const checksDone = (job.checksDone || 0) + 1;
  if (stage.hook !== 'after_delivery') return finalState('COMPLETED', now, { checksDone, ...extra });
  const schedule = stage.schedule || {};
  const startedAt = new Date(job.acceptedAt).getTime();

  if (schedule.checkAfterSeconds) {
    const list = schedule.checkAfterSeconds;
    for (let index = job.seq; index < list.length; index += 1) {
      const at = startedAt + list[index] * 1000;
      if (at > now.getTime()) {
        return { state: 'PENDING', seq: index + 1, executionAttempt: 1, checksDone, nextRunAt: new Date(at), lease: null, ...extra };
      }
    }
    return finalState('COMPLETED', now, { checksDone, exhausted: true, ...extra });
  }

  const next = now.getTime() + schedule.everySeconds * 1000;
  const tooOld = next > startedAt + schedule.maxAgeSeconds * 1000;
  const tooMany = schedule.maxChecks && checksDone >= schedule.maxChecks;
  if (tooOld || tooMany) return finalState('COMPLETED', now, { checksDone, exhausted: true, ...extra });
  return { state: 'PENDING', seq: job.seq + 1, executionAttempt: 1, checksDone, nextRunAt: new Date(next), lease: null, ...extra };
}

/**
 * What the job does after a run.
 * result: executeStage's result plus backoff: { retryAfterMs, limited }.
 * Resolves to { set, record }: the fields for the fenced commit, and whether the
 * run is worth recording (a run that never started is not).
 */
function nextJobState({ job, stage, result, now }) {
  const decision = result.decision || {};
  const backoff = result.backoff || { retryAfterMs: 0, limited: false };
  const last = { lastOutcome: result.outcome, lastStatus: result.status || null, lastRunAt: now, lastError: result.record ? result.record.error || null : null };

  if (result.outcome !== 'ok' && result.outcome !== 'skipped' && NOT_STARTED.has(decision.errorCode)) {
    return { record: false, set: { state: 'PENDING', nextRunAt: addMs(now, DEFER_NOT_STARTED_MS), lease: null, lastError: result.record ? result.record.error : null } };
  }
  if (result.outcome !== 'ok' && backoff.limited) {
    // Our own rate limit or quota stopped it: try again later, the attempt is not used up.
    const wait = Math.max(backoff.retryAfterMs, DEFER_LIMITED_MS);
    return { record: true, set: { state: 'PENDING', nextRunAt: addMs(now, wait), lease: null, ...last } };
  }

  if (result.outcome === 'ok') {
    if (result.done) return { record: true, set: finalState('COMPLETED', now, { checksDone: (job.checksDone || 0) + 1, ...last }) };
    return { record: true, set: advance(stage, job, now, last) };
  }
  if (result.outcome === 'skipped') {
    return { record: true, set: finalState('COMPLETED', now, { checksDone: (job.checksDone || 0) + 1, ...last }) };
  }

  // error or timeout
  const onError = stage.onError || {};
  if (onError.action === 'ignore' && !decision.failed) return { record: true, set: advance(stage, job, now, last) };
  if (onError.action !== 'retry_stage' || (decision.failed && !decision.retryStage)) {
    return { record: true, set: finalState('FAILED', now, last) };
  }
  if (decision.uncertain && !onError.allowUncertainSideEffects) {
    // The remote call may have taken effect; repeating it could do it twice.
    return { record: true, set: finalState('FAILED', now, { ...last, failedReason: 'UNCERTAIN_SIDE_EFFECT' }) };
  }
  if ((job.executionAttempt || 1) >= (onError.maxAttempts || 1)) {
    return { record: true, set: finalState('DEAD', now, last) };
  }
  const waits = onError.backoffSeconds || [60];
  const wait = waits[Math.min((job.executionAttempt || 1) - 1, waits.length - 1)] * 1000;
  return {
    record: true,
    set: {
      state: 'PENDING',
      executionAttempt: (job.executionAttempt || 1) + 1,
      nextRunAt: addMs(now, Math.max(wait, backoff.retryAfterMs)),
      lease: null,
      ...last,
    },
  };
}

module.exports = { firstRunAt, lastRunBy, isExpired, nextJobState, finalState };
