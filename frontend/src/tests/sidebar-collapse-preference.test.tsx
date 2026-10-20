import { describe, it, expect } from 'vitest';

/**
 * Regression: the sidebar could never stay expanded.
 *
 * App.tsx auto-collapses the sidebar on tablet and below, derived from
 * `isTabletDown = !screens.lg` where `screens` comes from AntD's
 * Grid.useBreakpoint(). That hook returns {} on the first render, before its
 * media queries are evaluated — so `screens.lg` is undefined and
 * `!screens.lg` is true even on a 1400px desktop. The effect collapsed the
 * sidebar on every load, and the persistence effect then wrote that to
 * localStorage, overwriting the user's choice for good. Every desktop user
 * ended up staring at 29 unlabelled icons.
 *
 * The rule is now: do nothing until the breakpoints have actually resolved.
 */
const shouldAutoCollapse = (screens: { lg?: boolean }) => {
  if (screens.lg === undefined) return false;
  return !screens.lg;
};

describe('sidebar auto-collapse', () => {
  it('does not collapse before breakpoints have resolved', () => {
    expect(shouldAutoCollapse({})).toBe(false);
  });

  it('leaves the sidebar alone on desktop, so a saved preference survives', () => {
    expect(shouldAutoCollapse({ lg: true })).toBe(false);
  });

  it('still collapses once a genuinely small viewport is measured', () => {
    expect(shouldAutoCollapse({ lg: false })).toBe(true);
  });
});
