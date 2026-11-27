import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { DefinedTheme } from '@astryxdesign/core/theme';
import { ConfigProvider, App as AntdApp } from '@/components/common/LegacyAntdControls';
import { Theme as AstryxTheme } from '@astryxdesign/core/theme';
import { useEffect } from 'react';
import { getAntdTheme } from '../design-system/theme';
import { accentCss, accentForMode, isAccentChoice, type AccentChoice } from '../design-system/theme/accents';
import {
  DEFAULT_PACK,
  THEME_PACKS,
  isThemePackId,
  type ThemePackId,
} from '../design-system/theme/packs';

type ThemeMode = 'light' | 'dark';
type Density = 'middle' | 'small';
type Corners = 'soft' | 'sharp';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  density: Density;
  setDensity: (density: Density) => void;
  toggleDensity: () => void;
  corners: Corners;
  setCorners: (corners: Corners) => void;
  accent: AccentChoice;
  setAccent: (accent: AccentChoice) => void;
  /** Active visual pack. Packs change values only; layout stays identical. */
  pack: ThemePackId;
  setPack: (pack: ThemePackId) => void;
  /** The pack's theme object, so token readers follow the active pack. */
  theme: DefinedTheme;
}

const ThemeModeContext = createContext<ThemeContextValue | undefined>(undefined);

const MODE_KEY = 'themeMode';
const DENSITY_KEY = 'density';
const CORNERS_KEY = 'uiCorners';
const ACCENT_KEY = 'uiAccent';
const PACK_KEY = 'uiPack';

const readPack = (): ThemePackId => {
  if (typeof window === 'undefined') return DEFAULT_PACK;
  const stored = window.localStorage.getItem(PACK_KEY);
  return isThemePackId(stored) ? stored : DEFAULT_PACK;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem(MODE_KEY) as ThemeMode) || 'light'
  );
  const [density, setDensity] = useState<Density>(
    () => (localStorage.getItem(DENSITY_KEY) as Density) || 'middle'
  );
  const [pack, setPackState] = useState<ThemePackId>(readPack);
  const [corners, setCorners] = useState<Corners>(
    () => (localStorage.getItem(CORNERS_KEY) === 'sharp' ? 'sharp' : 'soft')
  );
  const [accent, setAccentState] = useState<AccentChoice>(() => {
    const stored = localStorage.getItem(ACCENT_KEY);
    return isAccentChoice(stored) ? stored : 'theme';
  });

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    const className = 'density-compact';
    if (density === 'small') {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }
    localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  useEffect(() => {
    localStorage.setItem(PACK_KEY, pack);
    document.documentElement.dataset.themePack = pack;
  }, [pack]);

  useEffect(() => {
    localStorage.setItem(CORNERS_KEY, corners);
    document.documentElement.dataset.corners = corners;
  }, [corners]);

  // An action colour overrides the pack's accent at the document root. Status
  // colours are never derived from it — the curated set excludes their hues.
  const accentTokens = accentForMode(accent, mode);
  // Astryx applies tokens on its theme wrapper, so a root-level variable would
  // be shadowed. Append a scoped sheet after the theme's own style instead, and
  // re-append when the pack or mode changes so the override stays last.
  useEffect(() => {
    localStorage.setItem(ACCENT_KEY, accent);
    const id = 'accent-overrides';
    document.getElementById(id)?.remove();
    const css = accentCss(accent);
    if (!css) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }, [accent, mode, pack]);

  const theme = THEME_PACKS[pack].theme;

  const value = useMemo(
    () => ({
      mode,
      setMode,
      toggleMode: () => setMode((prev) => (prev === 'light' ? 'dark' : 'light')),
      density,
      setDensity,
      toggleDensity: () => setDensity((prev) => (prev === 'middle' ? 'small' : 'middle')),
      corners,
      setCorners,
      accent,
      setAccent: setAccentState,
      pack,
      setPack: (next: ThemePackId) => {
        setPackState(next);
        // A dark-first pack is previewed in the mode it was designed for; the
        // user can still choose light afterwards.
        if (THEME_PACKS[next].designedFor === 'dark') setMode('dark');
      },
      theme,
    }),
    [mode, density, pack, theme, corners, accent]
  );

  return (
    <ThemeModeContext.Provider value={value}>
      <AstryxTheme theme={theme} mode={mode}>
        <ConfigProvider theme={getAntdTheme(mode, theme, accentTokens)} componentSize={density} variant="outlined">
          <AntdApp>{children}</AntdApp>
        </ConfigProvider>
      </AstryxTheme>
    </ThemeModeContext.Provider>
  );
};

export const useThemeMode = () => {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used inside ThemeProvider');
  }
  return ctx;
};
