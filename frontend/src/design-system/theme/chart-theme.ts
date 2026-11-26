import { resolveThemeTokens } from '@astryxdesign/core/theme/tokens';
import { medicsConsoleTheme } from './medics-console';
import { typography } from '../tokens/typography';

type ThemeMode = 'light' | 'dark';

const makeChartTheme = (mode: ThemeMode) => {
  const tokens = resolveThemeTokens(medicsConsoleTheme, { mode });
  const palette = {
    primary: {
      default: tokens['--color-accent'],
      hover: tokens['--color-icon-accent'],
      text: tokens['--color-text-accent'],
    },
    success: { text: tokens['--color-text-success'] },
    warning: { text: tokens['--color-text-warning'] },
    error: { text: tokens['--color-text-error'] },
    info: { text: tokens['--color-text-info'] },
    border: {
      default: tokens['--color-border'],
      subtle: tokens['--color-border'],
    },
    text: {
      primary: tokens['--color-text-primary'],
      secondary: tokens['--color-text-secondary'],
      muted: tokens['--color-text-secondary'],
    },
  };

  const colors = {
    primary: [palette.primary.default, palette.primary.hover, palette.primary.text, tokens['--color-data-blue-1']],
    categorical: [
      palette.primary.default,
      palette.success.text,
      palette.warning.text,
      palette.info.text,
      palette.error.text,
      palette.primary.hover,
      tokens['--color-data-categorical-teal'],
      tokens['--color-data-categorical-yellow'],
    ],
    sequential: [
      tokens['--color-data-blue-5'],
      tokens['--color-data-blue-4'],
      tokens['--color-data-blue-3'],
      tokens['--color-data-blue-2'],
      tokens['--color-data-blue-1'],
    ],
    diverging: [
      palette.error.text,
      tokens['--color-data-categorical-red'],
      palette.border.default,
      tokens['--color-data-categorical-teal'],
      palette.success.text,
    ],
    status: {
      success: palette.success.text,
      warning: palette.warning.text,
      error: palette.error.text,
      info: palette.info.text,
    },
  } as const;

  return {
    chartColors: colors,
    chartAxisConfig: {
      stroke: palette.border.default,
      strokeWidth: 1,
      style: {
        fontSize: 'var(--console-type-caption)',
        fontFamily: typography.fonts.sans.join(', '),
        fill: palette.text.muted,
        fontWeight: typography.fontWeight.medium,
      },
    },
    chartGridConfig: {
      stroke: palette.border.subtle,
      strokeWidth: 1,
      strokeDasharray: '3 3',
    },
    chartTooltipStyle: {
      backgroundColor: tokens['--color-background-popover'],
      border: `1px solid ${palette.border.default}`,
      borderRadius: 'var(--radius-surface)',
      padding: 'var(--spacing-3) var(--spacing-4)',
      boxShadow: 'var(--shadow-md)',
      fontSize: 'var(--console-type-body)',
      fontFamily: typography.fonts.sans.join(', '),
      color: palette.text.primary,
    },
    chartLegendConfig: {
      wrapperStyle: {
        fontSize: 'var(--console-type-caption)',
        fontFamily: typography.fonts.sans.join(', '),
        color: palette.text.secondary,
        paddingTop: 'var(--spacing-4)',
      },
      iconType: 'circle' as const,
      iconSize: 8,
    },
    chartCursor: {
      stroke: tokens['--color-data-blue-2'],
      strokeWidth: 1,
    },
    chartGradients: {
      primary: {
        id: 'colorPrimary',
        stops: [
          { offset: '5%', color: palette.primary.default, opacity: 0.3 },
          { offset: '95%', color: palette.primary.default, opacity: 0 },
        ],
      },
      success: {
        id: 'colorSuccess',
        stops: [
          { offset: '5%', color: palette.success.text, opacity: 0.3 },
          { offset: '95%', color: palette.success.text, opacity: 0 },
        ],
      },
      warning: {
        id: 'colorWarning',
        stops: [
          { offset: '5%', color: palette.warning.text, opacity: 0.3 },
          { offset: '95%', color: palette.warning.text, opacity: 0 },
        ],
      },
      error: {
        id: 'colorError',
        stops: [
          { offset: '5%', color: palette.error.text, opacity: 0.3 },
          { offset: '95%', color: palette.error.text, opacity: 0 },
        ],
      },
    },
  } as const;
};

const lightChartTheme = makeChartTheme('light');

export const chartColors = lightChartTheme.chartColors;
export const chartAxisConfig = lightChartTheme.chartAxisConfig;
export const chartGridConfig = lightChartTheme.chartGridConfig;
export const chartTooltipStyle = lightChartTheme.chartTooltipStyle;
export const chartLegendConfig = lightChartTheme.chartLegendConfig;
export const chartCursor = lightChartTheme.chartCursor;
export const chartGradients = lightChartTheme.chartGradients;

export const chartResponsive = {
  mobile: 480,
  tablet: 768,
  desktop: 1024,
} as const;

const chartMarginsConst = {
  default: { top: 10, right: 30, left: 0, bottom: 0 },
  withLegend: { top: 10, right: 30, left: 0, bottom: 30 },
  compact: { top: 5, right: 20, left: 0, bottom: 0 },
  spacious: { top: 20, right: 40, left: 10, bottom: 10 },
} as const;

export const chartMargins = chartMarginsConst;
export type ChartMargin = (typeof chartMarginsConst)[keyof typeof chartMarginsConst];

export const chartAnimationConfig = {
  duration: 800,
  easing: 'ease-out' as const,
};

export const getChartTheme = makeChartTheme;

export type ChartColor = typeof chartColors;
export type ChartGradient = typeof chartGradients;
