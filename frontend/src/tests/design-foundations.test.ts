import { describe, expect, it } from 'vitest';
import { typography } from '../design-system/tokens/typography';
import { shadows } from '../design-system/tokens/shadows';

describe('operational design foundations', () => {
  it('uses compact, neutral tracking and shared interface fonts', () => {
    expect(typography.fonts.sans[0]).toBe('Inter');
    expect(typography.fonts.mono[0]).toBe('JetBrains Mono');
    expect(Object.values(typography.letterSpacing).every((value) => value === '0')).toBe(true);
    expect(typography.fontSize.base).toBe('0.875rem');
  });

  it('limits surface elevation to flat, subtle, and overlay levels', () => {
    expect(shadows.none).toBe('none');
    expect(shadows.xs).toBe(shadows.none);
    expect(shadows.sm).toBe(shadows.none);
    expect(shadows.lg).toBe(shadows.md);
    expect(shadows.xl).toBe(shadows.md);
    expect(shadows['2xl']).toBe(shadows.md);
  });
});
