import { defineTheme, type DefinedTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';
import {
  foundationTokens,
  legacyColorAliases,
  medicsTheme,
  paletteTokens,
} from './medics-theme';

/**
 * Theme packs for the console.
 *
 * Every pack changes values only: typography, spacing, radius, motion and the
 * component contract are shared, so the layout and the status vocabulary are
 * identical whichever pack is chosen. Status colours are reserved — a pack may
 * retune them, never repurpose them for an accent.
 *
 * Packs are defined unbuilt (see `defineTheme` docs): `<Theme>` injects the
 * tokens at runtime, so adding a pack is a data change, not a build artifact.
 */

type ColourPair = [light: string, dark: string];

const TYPOGRAPHY = {
  scale: { base: 13, ratio: 1.2 },
  body: { family: 'Inter', fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  heading: { family: 'Inter', fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  code: { family: 'JetBrains Mono', fallbacks: '"SFMono-Regular", Consolas, monospace' },
};

const RADIUS = { base: 4, multiplier: 1 };
const MOTION = { fast: 175, medium: 200, ratio: 0.75 };

/**
 * Legacy components ask for "blue" tokens by name. In a pack whose accent is
 * ink, those must resolve to the accent rather than to Astryx's blue scale —
 * otherwise a single pill stays blue inside an otherwise monochrome screen.
 */
const ACCENT_ALIASES = {
  '--color-text-blue': 'var(--color-accent)',
  '--color-icon-blue': 'var(--color-accent)',
  '--color-border-blue': 'var(--color-border-emphasized)',
  '--color-background-blue': 'color-mix(in srgb, var(--color-accent) 8%, var(--color-background-surface))',
};

interface PackInput {
  name: string;
  accent: ColourPair;
  /** Readable label colour on the accent fill. */
  accentForeground: ColourPair;
  neutralStyle: 'warm' | 'cool' | 'neutral';
  contrast?: 'standard' | 'high';
  palette: Record<string, string | ColourPair>;
  chrome: Record<string, string | ColourPair>;
}

const buildPack = ({
  name,
  accent,
  accentForeground,
  neutralStyle,
  contrast,
  palette,
  chrome,
}: PackInput) =>
  defineTheme({
    name,
    extends: neutralTheme,
    color: { accent, neutralStyle, ...(contrast ? { contrast } : {}) },
    typography: TYPOGRAPHY,
    radius: RADIUS,
    motion: MOTION,
    // ACCENT_ALIASES are Astryx tokens, so they override in `tokens`; localTokens
    // only accepts variables that are not already theme tokens.
    tokens: {
      ...paletteTokens,
      ...ACCENT_ALIASES,
      // Astryx derives an accent hue from the seed; an achromatic seed (ink,
      // black) is hue-less, so the derived accent is arbitrary. State the
      // action tokens explicitly instead of trusting the derivation.
      '--color-accent': accent,
      '--color-on-accent': accentForeground,
      // Astryx primary controls take their label from `--color-on-dark`.
      '--color-on-dark': accentForeground,
      ...palette,
    },
    localTokens: { ...legacyColorAliases, ...foundationTokens, ...chrome },
  });

/**
 * The rail is part of the theme, not the page: selecting a pack must not leave
 * an indigo strip behind. `foundationTokens` ships a dark rail, so each pack
 * states its own.
 */
const chromeFor = (
  rail: ColourPair,
  railDeep: ColourPair,
  accent: ColourPair,
  accentHover: ColourPair,
  text: ColourPair,
  activeBg: ColourPair,
  activeText: ColourPair,
  railText: ColourPair
) => ({
  '--color-app-rail': rail,
  '--color-app-rail-deep': railDeep,
  '--color-app-chrome-accent': accent,
  '--color-app-chrome-accent-hover': accentHover,
  '--color-background-sidebar': rail,
  '--color-text-sidebar': text,
  '--color-background-sidebar-hover': railDeep,
  '--color-background-sidebar-active': activeBg,
  '--color-text-sidebar-active': activeText,
  // Brand/heading foreground for the rail; tracks whether the rail is light
  // or dark, which no single Astryx token expresses.
  '--color-app-rail-text': railText,
});

// ── Ledger — warm paper, ink actions, status is the only colour ─────────────
const ledger = buildPack({
  name: 'ledger',
  accent: ['#17191C', '#ECEDEE'],
  accentForeground: ['#FFFFFF', '#101214'],
  neutralStyle: 'warm',
  palette: {
    '--color-background-body': ['#F6F5F1', '#0F1113'],
    '--color-background-surface': ['#FFFFFF', '#17191C'],
    '--color-background-popover': ['#FFFFFF', '#1C1F23'],
    '--color-text-primary': ['#17191C', '#ECEDEE'],
    '--color-text-secondary': ['#5B6067', '#A3A9AF'],
    '--color-border': ['#E4E2DB', '#2A2E33'],
    '--color-success': ['#0E7A4B', '#6ECF9D'],
    '--color-error': ['#B3261E', '#F08A80'],
    '--color-warning': ['#8A5A00', '#E8B464'],
    '--color-info': ['#2F4E8C', '#9DB4E8'],
  },
  chrome: chromeFor(
    ['#EFEDE6', '#121417'],
    ['#E7E4DA', '#0E1013'],
    ['#17191C', '#ECEDEE'],
    ['#2B2F34', '#FFFFFF'],
    ['#5B6067', '#A3A9AF'],
    ['#FFFFFF', '#1C1F23'],
    ['#FFFFFF', '#101214'],
    ['#17191C', '#ECEDEE']
  ),
});

// ── Graphite — cool neutral, tighter, no warmth ─────────────────────────────
const graphite = buildPack({
  name: 'graphite',
  accent: ['#0E1116', '#E8EBEE'],
  accentForeground: ['#FFFFFF', '#0B0D10'],
  neutralStyle: 'cool',
  palette: {
    '--color-background-body': ['#F3F4F6', '#0B0D10'],
    '--color-background-surface': ['#FFFFFF', '#13171B'],
    '--color-background-popover': ['#FFFFFF', '#181D22'],
    '--color-text-primary': ['#0E1116', '#E8EBEE'],
    '--color-text-secondary': ['#565D66', '#9AA3AC'],
    '--color-border': ['#E3E6EA', '#232A31'],
    '--color-success': ['#0D7A4D', '#69D3A0'],
    '--color-error': ['#B3261E', '#F18F85'],
    '--color-warning': ['#8A5A00', '#E3B268'],
    '--color-info': ['#2F4E8C', '#9DB4E8'],
  },
  chrome: chromeFor(
    ['#ECEEF1', '#0B0D10'],
    ['#E3E6EA', '#08090C'],
    ['#0E1116', '#E8EBEE'],
    ['#232A31', '#FFFFFF'],
    ['#565D66', '#9AA3AC'],
    ['#FFFFFF', '#171C22'],
    ['#FFFFFF', '#0B0D10'],
    ['#0E1116', '#E8EBEE']
  ),
});

// ── Cobalt — the familiar enterprise blue ──────────────────────────────────
// The continuity pack for teams migrating from the old console: blue accent,
// indigo rail, cool neutrals. Stated explicitly rather than inheriting the
// legacy built theme, whose accent resolved through a `var()` chain.
const cobalt = buildPack({
  name: 'cobalt',
  accent: ['#2563EB', '#60A5FA'],
  accentForeground: ['#FFFFFF', '#0B1220'],
  neutralStyle: 'cool',
  palette: {
    '--color-background-body': ['#F8FAFC', '#0D1118'],
    '--color-background-surface': ['#FFFFFF', '#181C22'],
    '--color-background-popover': ['#FFFFFF', '#181C22'],
    '--color-text-primary': ['#1E293B', '#DEE2EC'],
    '--color-text-secondary': ['#5A6C83', '#A5ABB9'],
    '--color-border': ['#E2E8F0', '#EDF1FA1A'],
    '--color-success': ['#15803D', '#64AF4C'],
    '--color-error': ['#DC2626', '#F87171'],
    '--color-warning': ['#B45309', '#FBBF24'],
    '--color-info': ['#1D4ED8', '#60A5FA'],
  },
  chrome: chromeFor(
    ['#171638', '#14132D'],
    ['#111129', '#100F23'],
    ['#2563EB', '#60A5FA'],
    ['#1D4ED8', '#93C5FD'],
    ['#E7E9F5', '#E7E9F5'],
    ['#2B2A5C', '#25244F'],
    // Dark-mode chrome accent is a light blue, so the selected rail label must
    // be dark there; white on #60A5FA measures 2.5:1.
    ['#FFFFFF', '#0B1220'],
    ['#E7E9F5', '#E7E9F5']
  ),
});

// ── Midnight — dark-first, luminous data ────────────────────────────────────
const midnight = buildPack({
  name: 'midnight',
  accent: ['#0B6FA4', '#7DD3FC'],
  accentForeground: ['#FFFFFF', '#06121A'],
  neutralStyle: 'cool',
  palette: {
    '--color-background-body': ['#EFF4FA', '#070A0F'],
    '--color-background-surface': ['#FFFFFF', '#0C1219'],
    '--color-background-popover': ['#FFFFFF', '#101822'],
    '--color-text-primary': ['#0B1622', '#E9EFF7'],
    '--color-text-secondary': ['#47566A', '#93A2B5'],
    '--color-border': ['#DCE6F2', '#1A2533'],
    '--color-success': ['#0E7A4B', '#5FE0B0'],
    '--color-error': ['#B3261E', '#FF9B90'],
    '--color-warning': ['#8A5A00', '#F0C27A'],
    '--color-info': ['#0B6FA4', '#7DD3FC'],
  },
  chrome: chromeFor(
    ['#E6EEF8', '#05080C'],
    ['#DCE7F4', '#03060A'],
    ['#0B1622', '#7DD3FC'],
    ['#2A3A4A', '#A5E3FF'],
    ['#47566A', '#93A2B5'],
    ['#FFFFFF', '#0C1219'],
    ['#FFFFFF', '#06121A'],
    ['#0B1622', '#E9EFF7']
  ),
});

// ── Contrast — maximum legibility, heavier rules ────────────────────────────
const contrast = buildPack({
  name: 'contrast',
  accent: ['#000000', '#FFFFFF'],
  accentForeground: ['#FFFFFF', '#000000'],
  neutralStyle: 'neutral',
  contrast: 'high',
  palette: {
    '--color-background-body': ['#FFFFFF', '#000000'],
    '--color-background-surface': ['#FFFFFF', '#000000'],
    '--color-background-popover': ['#FFFFFF', '#000000'],
    '--color-text-primary': ['#000000', '#FFFFFF'],
    '--color-text-secondary': ['#1F1F1F', '#E8E8E8'],
    '--color-border': ['#000000', '#FFFFFF'],
    '--color-success': ['#0B5D3B', '#7FF0BD'],
    '--color-error': ['#A3001A', '#FFB3B8'],
    '--color-warning': ['#6B4100', '#FFD08A'],
    '--color-info': ['#1F3A8A', '#A9C1FF'],
  },
  chrome: chromeFor(
    ['#FFFFFF', '#000000'],
    ['#F0F0F0', '#1A1A1A'],
    ['#000000', '#FFFFFF'],
    ['#333333', '#E6E6E6'],
    ['#000000', '#FFFFFF'],
    ['#000000', '#FFFFFF'],
    ['#FFFFFF', '#000000'],
    ['#000000', '#FFFFFF']
  ),
});

export type ThemePackId = 'ledger' | 'graphite' | 'cobalt' | 'midnight' | 'contrast';

export interface ThemePack {
  id: ThemePackId;
  name: string;
  description: string;
  /** The mode this pack is designed for; the picker previews it in that mode. */
  designedFor: 'light' | 'dark';
  theme: DefinedTheme;
}

export const THEME_PACKS: Record<ThemePackId, ThemePack> = {
  ledger: {
    id: 'ledger',
    name: 'Ledger',
    description: 'Warm paper, ink actions. Status is the only colour.',
    designedFor: 'light',
    theme: ledger,
  },
  graphite: {
    id: 'graphite',
    name: 'Graphite',
    description: 'Cool neutral and tighter. Built for long shifts.',
    designedFor: 'light',
    theme: graphite,
  },
  cobalt: {
    id: 'cobalt',
    name: 'Cobalt',
    description: 'The familiar enterprise blue, without the noise.',
    designedFor: 'light',
    theme: cobalt,
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark-first: luminous data on deep slate.',
    designedFor: 'dark',
    theme: midnight,
  },
  contrast: {
    id: 'contrast',
    name: 'Contrast',
    description: 'Maximum legibility. Heavier rules, no faint greys.',
    designedFor: 'light',
    theme: contrast,
  },
};

export const THEME_PACK_LIST = Object.values(THEME_PACKS);

export const DEFAULT_PACK: ThemePackId = 'ledger';

export const isThemePackId = (value: unknown): value is ThemePackId =>
  typeof value === 'string' && value in THEME_PACKS;
