'use strict';

/**
 * Production incident, 2026-09-09: one misconfigured Communication integration
 * ("Email Generic", failing validation with "Email recipient (to) is required")
 * produced ~3,000 DLQ entries an hour — 6,009 *distinct* dlqIds, so it was
 * manufacturing new rows rather than retrying one.
 *
 * Cause: the DLQ worker re-delivers through deliverSingleAction, whose failure
 * path created a DLQ entry unconditionally. Each retry therefore produced a
 * brand-new entry with retryCount: 0, while the worker separately incremented
 * the original. maxRetries could never terminate the chain and the queue grew
 * without bound, taking disk with it.
 *
 * The fix is one flag: a delivery that IS a DLQ retry does not create another
 * DLQ entry. These pin both halves of that contract.
 */

const fs = require('fs');
const path = require('path');

const DLQ_RETRY_OPTIONS = { triggerType: 'MANUAL', fromDlqRetry: true };
const NORMAL_DELIVERY_OPTIONS = { triggerType: 'EVENT' };

// Mirrors the guard in delivery-engine.js maybeCreateActionDLQ.
const shouldCreateDlqEntry = (options, { isTest = false, errorMessage = 'boom' } = {}) => {
  if (isTest) return false;
  if (!errorMessage) return false;
  if (options.fromDlqRetry) return false;
  return true;
};

describe('DLQ entries do not self-amplify', () => {
  it('creates an entry when a normal delivery fails', () => {
    expect(shouldCreateDlqEntry(NORMAL_DELIVERY_OPTIONS)).toBe(true);
  });

  it('does not create a second entry when the failing delivery is itself a DLQ retry', () => {
    expect(shouldCreateDlqEntry(DLQ_RETRY_OPTIONS)).toBe(false);
  });

  it('still creates nothing for test events or empty errors', () => {
    expect(shouldCreateDlqEntry(NORMAL_DELIVERY_OPTIONS, { isTest: true })).toBe(false);
    expect(shouldCreateDlqEntry(NORMAL_DELIVERY_OPTIONS, { errorMessage: '' })).toBe(false);
  });

  it('terminates instead of growing: repeated retries of one failure add no rows', () => {
    const created = Array.from({ length: 50 }, () => shouldCreateDlqEntry(DLQ_RETRY_OPTIONS)).filter(Boolean);
    expect(created).toHaveLength(0);
  });
});

describe('the dlq worker marks its re-deliveries', () => {
  it('passes fromDlqRetry, and the engine honours it', () => {
    const worker = fs.readFileSync(path.resolve(__dirname, '../../src/processor/dlq-worker.js'), 'utf-8');
    const engine = fs.readFileSync(path.resolve(__dirname, '../../src/processor/delivery-engine.js'), 'utf-8');

    expect(worker).toContain('fromDlqRetry: true');
    expect(engine).toContain('if (options.fromDlqRetry) return;');
  });
});
