import type { ThemeConfig } from 'antd';
import type { DefinedTheme } from '@astryxdesign/core/theme';
import { resolveThemeTokens } from '@astryxdesign/core/theme/tokens';
import { medicsConsoleTheme } from './medics-console';
import { resolveThemeToken } from './resolve-theme-token';

type ThemeMode = 'light' | 'dark';
type ResolvedTokens = Record<string, string>;

const resolvedTokens = (mode: ThemeMode, theme: DefinedTheme) =>
  resolveThemeTokens(theme, { mode }) as ResolvedTokens;

export const getAntdTheme = (
  mode: ThemeMode,
  theme: DefinedTheme = medicsConsoleTheme,
  accent?: { primary: string; hover: string; active: string; on: string } | null
): ThemeConfig => {
  const tokens = resolvedTokens(mode, theme);
  const localTokens = theme.localTokens ?? {};
  const token = (name: string) => resolveThemeToken(tokens[name] || localTokens[name], mode) || '';
  const surface = token('--color-background-surface');
  const border = token('--color-border');
  const text = token('--color-text-primary');
  const secondaryText = token('--color-text-secondary');
  const sidebar = token('--color-background-sidebar');
  const pixels = (name: string) => Number.parseFloat(token(name));

  return {
    token: {
      colorPrimary: accent?.primary ?? token('--color-accent'),
      colorPrimaryHover: accent?.hover ?? token('--color-icon-accent'),
      colorPrimaryActive: accent?.active ?? token('--color-text-accent'),
      colorTextLightSolid: accent ? accent.on : token('--color-on-accent'),
      colorSuccess: token('--color-success'),
      colorWarning: token('--color-warning'),
      colorError: token('--color-error'),
      colorInfo: token('--color-info'),
      colorBgBase: token('--color-background-body'),
      colorBgContainer: surface,
      colorBgElevated: token('--color-background-popover'),
      colorLink: accent?.primary ?? token('--color-accent'),
      colorLinkHover: accent?.hover ?? token('--color-text-accent'),
      colorLinkActive: accent?.active ?? token('--color-text-accent'),
      colorBorder: border,
      colorBorderSecondary: border,
      colorTextBase: text,
      colorText: text,
      colorTextSecondary: secondaryText,
      // Without this Ant Design falls back to rgba(text, 0.45) for captions
      // such as .ant-statistic-title, which fails contrast in every pack.
      colorTextDescription: secondaryText,
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
      // Unselected segmented labels were secondary ink on the muted track,
      // which measured 4.18:1 in the cobalt pack. Primary ink clears AA.
      Segmented: {
        itemColor: text,
        itemHoverColor: text,
        itemSelectedColor: text,
        trackBg: token('--color-background-muted'),
      },
      Button: { controlHeight: 36, primaryShadow: 'none', borderRadius: 4 },
      // Match the Panel anatomy so a Card and a Panel read as the same surface:
      // 16px body, 44px header, 14px header title, transparent header.
      Card: {
        boxShadow: 'none',
        borderRadiusLG: 8,
        bodyPadding: 16,
        headerHeight: 44,
        headerBg: 'transparent',
        headerFontSize: 14,
      },
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
