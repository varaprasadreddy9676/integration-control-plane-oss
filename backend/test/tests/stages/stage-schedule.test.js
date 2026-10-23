'use strict';

/** When deferred stages run and what their job does after each run (pure rules). */

const { firstRunAt, lastRunBy, isExpired, nextJobState } = require('../../../src/stages/schedule');

const T0 = new Date('2026-10-23T10:00:00Z');
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);

const checks = {
  hook: 'after_delivery',
  schedule: { checkAfterSeconds: [30, 300, 3600] },
  onError: { action: 'retry_stage', maxAttempts: 3, backoffSeconds: [10, 60] },
};
const repeating = {
  hook: 'after_delivery',
  schedule: { everySeconds: 600, maxAgeSeconds: 3600, maxChecks: 4 },
  onError: { action: 'ignore' },
};
const onFailure = { hook: 'on_failure', onError: { action: 'retry_stage', maxAttempts: 2, backoffSeconds: [30] } };

const job = (overrides = {}) => ({ seq: 1, executionAttempt: 1, checksDone: 0, acceptedAt: T0, ...overrides });
const ok = (extra = {}) => ({ outcome: 'ok', status: 'PENDING', done: false, decision: {}, record: {}, ...extra });
const failed = (decision = {}, extra = {}) => ({ outcome: 'error', decision, record: { error: 'boom' }, ...extra });

describe('first and last run', () => {
  it('starts a scheduled check at its first offset and on_failure at once', () => {
    expect(firstRunAt(checks, T0)).toEqual(at(30));
    expect(firstRunAt(repeating, T0)).toEqual(at(600));
    expect(firstRunAt(onFailure, T0)).toEqual(T0);
  });

  it('knows the last time the job can still be expected to run, retries included', () => {
    expect(lastRunBy(checks, T0)).toEqual(at(3600 + 70));
    expect(lastRunBy(repeating, T0)).toEqual(at(3600));
    expect(isExpired(checks, job(), at(3670 + 24 * 3600 + 1))).toBe(true);
    expect(isExpired(checks, job(), at(3670))).toBe(false);
  });
});

describe('after a check', () => {
  it('done ends the job', () => {
    const { set } = nextJobState({ job: job(), stage: checks, result: ok({ status: 'DELIVERED', done: true }), now: at(31) });
    expect(set).toMatchObject({ state: 'COMPLETED', input: null, checksDone: 1, lastStatus: 'DELIVERED' });
  });

  it('not done moves to the next slot', () => {
    const { set } = nextJobState({ job: job(), stage: checks, result: ok(), now: at(31) });
    expect(set).toMatchObject({ state: 'PENDING', seq: 2, executionAttempt: 1, checksDone: 1, nextRunAt: at(300) });
  });

  it('skips slots that already passed (after a pause or outage), without a burst', () => {
    const { set } = nextJobState({ job: job(), stage: checks, result: ok(), now: at(400) });
    expect(set).toMatchObject({ state: 'PENDING', seq: 3, nextRunAt: at(3600) });
  });

  it('ends, marked exhausted, when no slot is left', () => {
    const { set } = nextJobState({ job: job({ seq: 3, checksDone: 2 }), stage: checks, result: ok(), now: at(3601) });
    expect(set).toMatchObject({ state: 'COMPLETED', exhausted: true, checksDone: 3 });
  });

  it('a repeating check stops at its maximum age or count', () => {
    expect(nextJobState({ job: job(), stage: repeating, result: ok(), now: at(600) }).set).toMatchObject({ state: 'PENDING', seq: 2, nextRunAt: at(1200) });
    expect(nextJobState({ job: job({ seq: 5 }), stage: repeating, result: ok(), now: at(3100) }).set).toMatchObject({ state: 'COMPLETED', exhausted: true });
    expect(nextJobState({ job: job({ checksDone: 3 }), stage: repeating, result: ok(), now: at(600) }).set).toMatchObject({ state: 'COMPLETED', exhausted: true });
  });

  it('a skip ends the job; on_failure runs once', () => {
    expect(nextJobState({ job: job(), stage: checks, result: { outcome: 'skipped', decision: {}, record: {} }, now: at(31) }).set.state).toBe('COMPLETED');
    expect(nextJobState({ job: job(), stage: onFailure, result: ok(), now: at(1) }).set.state).toBe('COMPLETED');
  });
});

describe('after an error', () => {
  it('retries the same check with backoff, then dead-letters', () => {
    const first = nextJobState({ job: job(), stage: checks, result: failed(), now: at(31) }).set;
    expect(first).toMatchObject({ state: 'PENDING', executionAttempt: 2, nextRunAt: at(41) });
    expect(first.seq).toBeUndefined(); // still the same check
    const second = nextJobState({ job: job({ executionAttempt: 2 }), stage: checks, result: failed(), now: at(41) }).set;
    expect(second).toMatchObject({ state: 'PENDING', executionAttempt: 3, nextRunAt: at(101) });
    expect(nextJobState({ job: job({ executionAttempt: 3 }), stage: checks, result: failed(), now: at(101) }).set).toMatchObject({ state: 'DEAD', input: null });
  });

  it('waits at least as long as the provider asked (Retry-After)', () => {
    const { set } = nextJobState({ job: job(), stage: checks, result: failed({}, { backoff: { retryAfterMs: 120000, limited: false } }), now: at(31) });
    expect(set.nextRunAt).toEqual(at(151));
  });

  it('never repeats a call that may have taken effect, unless the stage allows it', () => {
    const uncertain = failed({ uncertain: true });
    expect(nextJobState({ job: job(), stage: checks, result: uncertain, now: at(31) }).set).toMatchObject({ state: 'FAILED', failedReason: 'UNCERTAIN_SIDE_EFFECT' });
    const allowing = { ...checks, onError: { ...checks.onError, allowUncertainSideEffects: true } };
    expect(nextJobState({ job: job(), stage: allowing, result: uncertain, now: at(31) }).set.state).toBe('PENDING');
  });

  it('a deliberate fail() is final unless it asks for a retry', () => {
    expect(nextJobState({ job: job(), stage: checks, result: failed({ failed: true }), now: at(31) }).set.state).toBe('FAILED');
    expect(nextJobState({ job: job(), stage: checks, result: failed({ failed: true, retryStage: true }), now: at(31) }).set.state).toBe('PENDING');
  });

  it('ignore moves on to the next check; fail_stage stops', () => {
    expect(nextJobState({ job: job(), stage: repeating, result: failed(), now: at(600) }).set).toMatchObject({ state: 'PENDING', seq: 2 });
    const failing = { ...checks, onError: { action: 'fail_stage' } };
    expect(nextJobState({ job: job(), stage: failing, result: failed(), now: at(31) }).set.state).toBe('FAILED');
  });

  it('our own rate limit or quota defers the job without using up an attempt', () => {
    const limited = failed({}, { backoff: { retryAfterMs: 500, limited: true } });
    const { set, record } = nextJobState({ job: job({ executionAttempt: 3 }), stage: checks, result: limited, now: at(31) });
    expect(record).toBe(true);
    expect(set).toMatchObject({ state: 'PENDING', nextRunAt: at(61) });
    expect(set.executionAttempt).toBeUndefined();
  });

  it('a run that never started (runtime busy or down) is deferred and not recorded', () => {
    const busy = { outcome: 'error', decision: { errorCode: 'BUSY' }, record: { error: 'All stage runners are busy' } };
    const { set, record } = nextJobState({ job: job(), stage: checks, result: busy, now: at(31) });
    expect(record).toBe(false);
    expect(set).toMatchObject({ state: 'PENDING', nextRunAt: at(91) });
  });
});
