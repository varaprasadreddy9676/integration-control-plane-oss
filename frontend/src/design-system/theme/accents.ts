/**
 * Curated action colours. The console reserves colour for status, so an accent
 * may only be a neutral-ish blue/violet/slate — never green, amber or red,
 * which would collide with delivered/warning/failed.
 *
 * Values are derived here rather than at call sites so Ant Design (which
 * computes its own colour maths) receives plain hex strings.
 */
export type AccentChoice = 'theme' | 'blue' | 'violet' | 'indigo' | 'slate';

interface AccentSpec {
  light: string;
  lightHover: string;
  lightActive: string;
  dark: string;
  darkHover: string;
  darkActive: string;
}

const mix = (hex: string, target: 'white' | 'black', amount: number): string => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const base = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const bound = target === 'white' ? 255 : 0;
  return (
    '#' +
    base
      .map((channel) => Math.round(channel + (bound - channel) * amount))
      .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0'))
      .join('')
  );
};

const spec = (light: string, dark: string): AccentSpec => ({
  light,
  lightHover: mix(light, 'black', 0.12),
  lightActive: mix(light, 'black', 0.2),
  dark,
  darkHover: mix(dark, 'white', 0.15),
  darkActive: mix(dark, 'white', 0.25),
});

export const ACCENTS: Record<Exclude<AccentChoice, 'theme'>, AccentSpec> = {
  blue: spec('#2563EB', '#7EB0FF'),
  violet: spec('#6D28D9', '#C4B5FD'),
  indigo: spec('#4338CA', '#A5B4FC'),
  slate: spec('#334155', '#CBD5E1'),
};

export const ACCENT_OPTIONS: Array<{ id: AccentChoice; label: string }> = [
  { id: 'theme', label: 'Theme default' },
  { id: 'blue', label: 'Blue' },
  { id: 'violet', label: 'Violet' },
  { id: 'indigo', label: 'Indigo' },
  { id: 'slate', label: 'Slate' },
];

export const isAccentChoice = (value: unknown): value is AccentChoice =>
  typeof value === 'string' && ACCENT_OPTIONS.some((option) => option.id === value);

/** Readable label colour for a filled action. */
export const readableOn = (hex: string): string => {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.42 ? '#101214' : '#FFFFFF';
};

export interface AccentTokens {
  primary: string;
  hover: string;
  active: string;
  on: string;
}

export const accentForMode = (
  choice: AccentChoice,
  mode: 'light' | 'dark'
): AccentTokens | null => {
  if (choice === 'theme') return null;
  const entry = ACCENTS[choice];
  if (!entry) return null;
  const primary = mode === 'dark' ? entry.dark : entry.light;
  return {
    primary,
    hover: mode === 'dark' ? entry.darkHover : entry.lightHover,
    active: mode === 'dark' ? entry.darkActive : entry.lightActive,
    on: readableOn(primary),
  };
};

/**
 * A scoped override sheet. Astryx applies theme tokens on its own wrapper, so
 * setting variables on the document root does not reach components; this rule
 * targets the theme wrapper and uses light-dark() so both modes keep working.
 */
export const accentCss = (choice: AccentChoice): string | null => {
  if (choice === 'theme') return null;
  const entry = ACCENTS[choice];
  if (!entry) return null;
  const onLight = readableOn(entry.light);
  const onDark = readableOn(entry.dark);
  return [
    '[data-astryx-theme] {',
    `  --color-accent: light-dark(${entry.light}, ${entry.dark});`,
    `  --color-on-accent: light-dark(${onLight}, ${onDark});`,
    `  --color-on-dark: light-dark(${onLight}, ${onDark});`,
    `  --color-app-chrome-accent: light-dark(${entry.light}, ${entry.dark});`,
    `  --color-app-chrome-accent-hover: light-dark(${entry.lightHover}, ${entry.darkHover});`,
    `  --color-text-sidebar-active: light-dark(${onLight}, ${onDark});`,
    '}',
  ].join('\n');
};
