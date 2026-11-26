// Three elevation levels only: flat, quiet surface, and overlay.
export const shadows = {
  none: 'none',
  xs: 'none',
  sm: 'none',
  base: '0 1px 2px rgba(16, 24, 40, 0.08)',
  md: '0 8px 24px rgba(16, 24, 40, 0.12)',
  lg: '0 8px 24px rgba(16, 24, 40, 0.12)',
  xl: '0 8px 24px rgba(16, 24, 40, 0.12)',
  '2xl': '0 8px 24px rgba(16, 24, 40, 0.12)',
  inner: 'none',
  focusRing: '0 0 0 3px rgba(91, 141, 239, 0.12)',
  focusRingError: '0 0 0 3px rgba(239, 68, 68, 0.12)',
  focusRingSuccess: '0 0 0 3px rgba(34, 197, 94, 0.12)',
  focusRingWarning: '0 0 0 3px rgba(234, 179, 8, 0.12)'
} as const;

// Colored shadows for interactive elements (using new color palette)
export const coloredShadows = {
  primary: shadows.base,
  primaryHover: shadows.md,
  success: shadows.base,
  successHover: shadows.md,
  warning: shadows.base,
  warningHover: shadows.md,
  error: shadows.base,
  errorHover: shadows.md,
} as const;

export type ShadowTokens = typeof shadows;
