import { describe, expect, it } from 'vitest';
import { formatElapsed, isLiveStatus } from '../features/logs/utils/liveRun';

describe('live script runs', () => {
  it('treats a run that has not finished as live, whatever the case', () => {
    expect(isLiveStatus('PENDING')).toBe(true);
    expect(isLiveStatus('running')).toBe(true);
  });

  it('treats finished and unknown runs as not live', () => {
    for (const status of ['SUCCESS', 'FAILED', 'SKIPPED', 'ABANDONED', '', undefined, null]) {
      expect(isLiveStatus(status)).toBe(false);
    }
  });

  it('says how long it has been running in plain units', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(45_900)).toBe('45s');
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(187_000)).toBe('3m 07s');
  });

  it('never shows a negative time when the clocks disagree', () => {
    expect(formatElapsed(-5_000)).toBe('0s');
  });
});
