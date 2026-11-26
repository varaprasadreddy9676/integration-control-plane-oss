import type { ThemeConfig } from 'antd';
import { resolveThemeTokens } from '@astryxdesign/core/theme/tokens';
import { medicsConsoleTheme } from './medics-console';
import { resolveThemeToken } from './resolve-theme-token';

type ThemeMode = 'light' | 'dark';
type ResolvedTokens = Record<string, string>;

const resolvedTokens = (mode: ThemeMode) =>
  resolveThemeTokens(medicsConsoleTheme, { mode }) as ResolvedTokens;

export const getAntdTheme = (mode: ThemeMode): ThemeConfig => {
  const tokens = resolvedTokens(mode);
  const localTokens = (medicsConsoleTheme as typeof medicsConsoleTheme & { localTokens: Record<string, string | [string, string]> }).localTokens;
  const token = (name: string) => resolveThemeToken(tokens[name] || localTokens[name], mode) || '';
  const surface = token('--color-background-surface');
  const border = token('--color-border');
  const text = token('--color-text-primary');
  const secondaryText = token('--color-text-secondary');
  const sidebar = token('--color-background-sidebar');
  const pixels = (name: string) => Number.parseFloat(token(name));

  return {
    token: {
      colorPrimary: token('--color-accent'),
      colorPrimaryHover: token('--color-icon-accent'),
      colorPrimaryActive: token('--color-text-accent'),
      colorSuccess: token('--color-success'),
      colorWarning: token('--color-warning'),
      colorError: token('--color-error'),
      colorInfo: token('--color-info'),
      colorBgBase: token('--color-background-body'),
      colorBgContainer: surface,
      colorBgElevated: token('--color-background-popover'),
      colorBorder: border,
      colorBorderSecondary: border,
      colorTextBase: text,
      colorText: text,
      colorTextSecondary: secondaryText,
      colorTextDisabled: token('--color-text-disabled'),
      colorTextPlaceholder: secondaryText,
      fontFamily: token('--font-family-body'),
      fontSize: pixels('--font-size-control'),
      lineHeight: 1.5,
      borderRadius: 4,
      borderRadiusLG: 8,
      borderRadiusSM: 4,
      padding: pixels('--space-4'),
      paddingLG: pixels('--space-6'),
      paddingSM: pixels('--space-2'),
      boxShadow: 'none',
      motionDurationMid: '0.2s',
    },
    components: {
      Form: { itemMarginBottom: 16, verticalLabelPadding: '0 0 4px' },
      Button: { controlHeight: 36, primaryShadow: 'none', borderRadius: 4 },
      Card: { boxShadow: 'none', borderRadiusLG: 8 },
      Table: {
        headerBg: surface,
        headerColor: secondaryText,
        rowHoverBg: token('--color-background-row-hover'),
        bodySortBg: 'transparent',
        headerSortActiveBg: surface,
        headerSortHoverBg: surface,
        borderColor: border,
      },
      Layout: { headerBg: surface, siderBg: sidebar },
      Menu: {
        darkItemBg: 'transparent',
        darkItemSelectedBg: token('--color-background-sidebar-active'),
        darkItemColor: token('--color-text-sidebar'),
        darkItemHoverColor: token('--color-text-sidebar-active'),
        darkItemHoverBg: token('--color-background-sidebar-hover'),
      },
      Modal: { contentBg: surface, headerBg: surface },
      Drawer: { colorBgElevated: surface },
    },
  };
};
