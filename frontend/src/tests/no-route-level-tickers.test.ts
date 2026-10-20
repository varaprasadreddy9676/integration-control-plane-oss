import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * A countdown that calls setState once a second from inside a route component
 * re-renders that whole screen every second. On Delivery Logs it reconciled
 * away whatever the user was typing into the date picker — reported as "the
 * date resets 99% of the times" — and the identical pattern was later found
 * still live on System Logs, which has six filter inputs.
 *
 * The fix is always the same: move the tick into a leaf, so a second passing
 * repaints one line of text. components/common/RefreshCountdown exports
 * RefreshCountdown, SecondsAgo and CountdownTo for this.
 *
 * This walks the route files and fails if a per-second timer sits next to a
 * state setter in the same effect.
 */
const routesDir = resolve(__dirname, '../features');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
  });

const offenders = walk(routesDir).filter((file) => {
  const src = readFileSync(file, 'utf-8');
  // A 1000ms timer in the same file as a countdown-ish setter.
  const hasSecondTicker = /set(Interval|Timeout)\(\s*[^,]+,\s*1000\s*\)/.test(src);
  const setsCountdownState = /set[A-Za-z]*(Countdown|Now|Elapsed|Tick|Seconds)\s*\(/.test(src);
  return hasSecondTicker && setsCountdownState;
});

describe('no per-second state ticks inside route components', () => {
  it('keeps one-second timers in leaf components, not routes', () => {
    expect(offenders.map((f) => f.split('/src/')[1])).toEqual([]);
  });
});
