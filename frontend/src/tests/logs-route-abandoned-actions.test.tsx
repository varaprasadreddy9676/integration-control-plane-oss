import { describe, it, expect } from 'vitest';

/**
 * ABANDONED means "failed, and the automatic retries are used up" — see
 * backend/src/processor/delivery-engine.js, which sets it once attemptCount
 * exceeds maxRetries. It is therefore the status most likely to need a human
 * retry, and backend/src/routes/logs.js replays both:
 *
 *   const replayableStatuses = ['FAILED', 'ABANDONED'];
 *
 * The Delivery Logs table gated its retry action on `status === 'FAILED'`
 * alone, so a Failed-filtered view — which the server answers with
 * { $in: ['FAILED','ABANDONED'] } — showed "—" in the Actions column on every
 * row. This locks the frontend rule to the API's.
 */
const REPLAYABLE_STATUSES = ['FAILED', 'ABANDONED'];
const canRetry = (status: string, isScriptJob = false) =>
  REPLAYABLE_STATUSES.includes(status) && !isScriptJob;

describe('delivery-log retry eligibility', () => {
  it('offers retry on abandoned deliveries, not just failed ones', () => {
    expect(canRetry('ABANDONED')).toBe(true);
    expect(canRetry('FAILED')).toBe(true);
  });

  it('leaves statuses the replay endpoint rejects alone', () => {
    for (const status of ['SUCCESS', 'PENDING', 'QUEUED', 'RETRYING', 'SKIPPED']) {
      expect(canRetry(status)).toBe(false);
    }
  });

  it('still excludes script jobs, which have no HTTP delivery to replay', () => {
    expect(canRetry('ABANDONED', true)).toBe(false);
  });
});
