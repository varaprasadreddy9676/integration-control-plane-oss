import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  ACCENT_OPTIONS,
  accentCss,
  accentForMode,
  isAccentChoice,
  readableOn,
  type AccentChoice,
} from '../design-system/theme/accents';

describe('accents', () => {
  it('returns null for the theme accent in both light and dark modes', () => {
    expect(accentForMode('theme', 'light')).toBeNull();
    expect(accentForMode('theme', 'dark')).toBeNull();
  });

  it('returns distinct mode palettes with matching hover/active pairs and readable on-colour', () => {
    const light = accentForMode('blue', 'light');
    const dark = accentForMode('blue', 'dark');

    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(light!.primary).not.toBe(dark!.primary);

    expect(light).toEqual({
      primary: ACCENTS.blue.light,
      hover: ACCENTS.blue.lightHover,
      active: ACCENTS.blue.lightActive,
      on: readableOn(ACCENTS.blue.light),
    });
    expect(dark).toEqual({
      primary: ACCENTS.blue.dark,
      hover: ACCENTS.blue.darkHover,
      active: ACCENTS.blue.darkActive,
      on: readableOn(ACCENTS.blue.dark),
    });

    expect(light!.hover).not.toBe(light!.active);
    expect(dark!.hover).not.toBe(dark!.active);
    expect(['#FFFFFF', '#101214']).toContain(light!.on);
    expect(['#FFFFFF', '#101214']).toContain(dark!.on);
  });

  it('chooses dark text on pale colours and light text on deep colours', () => {
    expect(readableOn('#CBD5E1')).toBe('#101214');
    expect(readableOn('#2563EB')).toBe('#FFFFFF');
  });

  it('generates scoped light-dark CSS for non-theme accents and null for theme', () => {
    expect(accentCss('theme')).toBeNull();

    const css = accentCss('violet');
    expect(css).not.toBeNull();
    expect(css).toContain('[data-astryx-theme]');
    expect(css).toContain('--color-app-chrome-accent');

    const propertyLines = css!
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('--'));

    expect(propertyLines).toHaveLength(6);
    for (const line of propertyLines) {
      expect(line).toMatch(/light-dark\([^,]+,\s*[^)]+\);$/);
    }
  });

  it('exposes the exact curated accent option ids without status colours', () => {
    const ids = ACCENT_OPTIONS.map((option) => option.id);
    expect(ids).toEqual(['theme', 'blue', 'violet', 'indigo', 'slate']);

    for (const forbidden of ['green', 'amber', 'yellow', 'red']) {
      expect(ids).not.toContain(forbidden);
    }
  });

  it('validates AccentChoice values with isAccentChoice', () => {
    const valid: AccentChoice = 'blue';
    expect(isAccentChoice(valid)).toBe(true);
    expect(isAccentChoice('blueish')).toBe(false);
    expect(isAccentChoice(null)).toBe(false);
  });
});
