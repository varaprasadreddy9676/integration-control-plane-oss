import { useMemo } from 'react';
import { resolveThemeTokens } from '@astryxdesign/core/theme/tokens';
import { useThemeMode } from '../../app/theme-provider';
import { medicsTheme } from '../theme/medics-theme';
import { resolveThemeToken } from '../theme/resolve-theme-token';

export const useThemeColors = () => {
  const { mode } = useThemeMode();

  return useMemo(() => {
    const tokens = resolveThemeTokens(medicsTheme, { mode }) as Record<string, string>;
    const localTokens = medicsTheme.localTokens as Record<string, string | [string, string]>;
    const color = (name: string) => resolveThemeToken(tokens[name] || localTokens[name], mode) || '';

    return {
      bg: {
        base: color('--color-background-body'),
        subtle: color('--color-background-muted'),
        surface: color('--color-background-surface'),
        elevated: color('--color-background-popover'),
        overlay: color('--color-overlay'),
      },
      text: {
        primary: color('--color-text-primary'),
        secondary: color('--color-text-secondary'),
        muted: color('--color-text-secondary'),
        disabled: color('--color-text-disabled'),
        inverse: color('--color-on-accent'),
      },
      border: {
        subtle: color('--color-border'),
        default: color('--color-border'),
        strong: color('--color-border-emphasized'),
      },
      primary: {
        default: color('--color-accent'),
        hover: color('--color-icon-accent'),
        active: color('--color-text-accent'),
        text: color('--color-text-accent'),
      },
      success: {
        bg: color('--color-success-muted'),
        border: color('--color-border-success'),
        text: color('--color-text-success'),
      },
      warning: {
        bg: color('--color-warning-muted'),
        border: color('--color-border-warning'),
        text: color('--color-text-warning'),
      },
      error: {
        bg: color('--color-error-muted'),
        border: color('--color-border-error'),
        text: color('--color-text-error'),
      },
      info: {
        bg: color('--color-info-muted'),
        border: color('--color-border-info'),
        text: color('--color-text-info'),
      },
      table: {
        rowHover: color('--color-background-row-hover'),
        rowSelected: color('--color-background-row-active'),
        rowActive: color('--color-background-row-active'),
        codeBg: color('--color-background-muted'),
        codeBorder: color('--color-border'),
      },
      sidebar: {
        bg: color('--color-background-sidebar'),
        item: color('--color-text-sidebar'),
        hover: color('--color-background-sidebar-hover'),
        activeBg: color('--color-background-sidebar-active'),
        activeText: color('--color-text-sidebar-active'),
        accent: color('--color-accent'),
      },
    };
  }, [mode]);
};
