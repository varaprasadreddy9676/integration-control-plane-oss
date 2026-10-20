export const spacing = {
  0: '0',
  px: '1px',
  '0.5': '0.125rem',
  1: '0.25rem',
  '1.5': '0.375rem',
  2: '0.5rem',
  '2.5': '0.625rem',
  3: '0.75rem',
  '3.5': '0.875rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  7: '1.75rem',
  8: '2rem',
  9: '2.25rem',
  10: '2.5rem',
  12: '3rem',
  14: '3.5rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  32: '8rem',
  40: '10rem',
  48: '12rem',
  56: '14rem',
  64: '16rem'
} as const;

/**
 * Two radii, deliberately. 4px for controls, 8px for genuinely framed surfaces
 * (dialogs, menus, cards). The older 2/6/12/16/24px scale produced eight
 * different corner values on a single screen, which reads as unfinished.
 *
 * The names below are kept so existing call sites keep compiling, but several
 * resolve to the same value — `md`, `lg` and `base` are all 4px, and `xl`,
 * `2xl` and `3xl` are all 8px. Reach for `base` or `xl`; picking `3xl` will not
 * give you a bigger corner.
 */
export const borderRadius = {
  none: '0',
  sm: '0.25rem',
  base: '0.25rem',
  md: '0.25rem',
  lg: '0.25rem',
  xl: '0.5rem',
  '2xl': '0.5rem',
  '3xl': '0.5rem',
  full: '9999px'
} as const;

export const container = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
  prose: '65ch',
  narrow: '720px',
  wide: '1440px',
  full: '100%'
} as const;

export type SpacingScale = typeof spacing;
