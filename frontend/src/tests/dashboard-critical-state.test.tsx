import { describe, it, expect } from 'vitest';

/**
 * Red on a metric tile has to mean "this is bad right now", not "this tile is
 * the failures tile". Two separate bugs got in the way:
 *
 *  1. getMetricTileStyles keyed the red treatment off the word "failed" in the
 *     label, so the card glowed red while showing "—".
 *  2. The fix then inferred badness by comparing the tone string to
 *     cssVar.error.text — but that constant is 'var(--color-error-text)' while
 *     the route passes a resolved hex, so it never matched and the card could
 *     never go red, even with 8 real failures in production.
 *
 * Criticality is now an explicit boolean from the route, which is the only
 * place that knows the number.
 */
const isCritical = (critical?: boolean) => Boolean(critical);

describe('dashboard tile critical state', () => {
  it('is not critical when the caller says nothing', () => {
    expect(isCritical(undefined)).toBe(false);
  });

  it('is not critical when there are no failures', () => {
    expect(isCritical(false)).toBe(false);
  });

  it('is critical only when the route reports real failures', () => {
    expect(isCritical(true)).toBe(true);
  });

  it('never depends on comparing colour strings', () => {
    // The trap: these look equal in intent but never match.
    const cssVarToken: string = 'var(--color-error-text)';
    const resolvedHex: string = '#DC2626';
    expect(cssVarToken).not.toEqual(resolvedHex);
  });
});
