'use strict';

/**
 * Graceful drain relied on the event loop emptying for the process to exit. A
 * SIGTERM that landed mid-bootstrap (validation, 2026-09-28) let bootstrap go on
 * scheduling cron jobs after the drain, which kept the process alive — holding
 * the pid file, never listening — until it was SIGKILLed by hand.
 */

const { armForcedExit } = require('../../src/utils/forced-exit');

describe('armForcedExit', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('exits with the given code once the grace period passes', () => {
    const exit = jest.fn();
    armForcedExit({ afterMs: 10000, exitCode: 0, exit });
    jest.advanceTimersByTime(9999);
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('uses a timer that does not itself keep the process alive', () => {
    const timer = armForcedExit({ afterMs: 10000, exitCode: 1, exit: jest.fn() });
    expect(typeof timer.hasRef === 'function' ? timer.hasRef() : false).toBe(false);
  });
});
