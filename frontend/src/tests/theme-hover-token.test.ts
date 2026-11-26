import { describe, expect, it } from 'vitest';
import { getAntdTheme } from '../design-system/theme/antd-theme';
import { medicsTheme } from '../design-system/theme/medics-theme';
import { resolveThemeToken } from '../design-system/theme/resolve-theme-token';

describe('console theme hover tokens', () => {
  it.each(['light', 'dark'] as const)('uses a visible surface color in %s mode', (mode) => {
    const tokens = medicsTheme.localTokens as Record<string, string | [string, string]>;

    const expectedHover = mode === 'light' ? '#F4F6F8' : '#1F2A3A';
    expect(resolveThemeToken(tokens['--color-background-row-hover'], mode)).toBe(expectedHover);
    expect(tokens['--color-hover']).toBe('var(--color-background-row-hover)');
    expect(tokens['--color-row-hover']).toBe('var(--color-background-row-hover)');
    expect(tokens['--color-neutral-0']).toBe('var(--color-on-accent)');
    expect(getAntdTheme(mode).components?.Table?.rowHoverBg).toBe(expectedHover);
  });
});
