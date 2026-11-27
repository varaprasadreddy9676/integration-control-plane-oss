import { useEffect, useMemo, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { resolveThemeTokens } from '@astryxdesign/core/theme/tokens';
import { Theme as AstryxTheme } from '@astryxdesign/core/theme';
import { PageTemplate } from '../../components/common/PageTemplate';
import { Panel } from '../../design-system/primitives';
import { App, Input } from '@/components/common/LegacyAntdControls';
import { useThemeMode } from '../../app/theme-provider';
import { useBranding } from '../../app/branding-provider';
import { ACCENTS, ACCENT_OPTIONS, type AccentChoice } from '../../design-system/theme/accents';
import { DEFAULT_BRANDING } from '../../app/branding';
import {
  THEME_PACK_LIST,
  THEME_PACKS,
  type ThemePackId,
} from '../../design-system/theme/packs';
import { resolveThemeToken } from '../../design-system/theme/resolve-theme-token';
import './appearance.css';

type Mode = 'light' | 'dark';

const rgb = (hex: string) => {
  const h = hex.trim().replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  if (!a.startsWith('#') || !b.startsWith('#')) return 0;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const colorsFor = (packId: ThemePackId, mode: Mode) => {
  const tokens = resolveThemeTokens(THEME_PACKS[packId].theme, { mode });
  const at = (name: string) => resolveThemeToken(tokens[name], mode) || '';
  return {
    paper: at('--color-background-body'),
    surface: at('--color-background-surface'),
    line: at('--color-border'),
    ink: at('--color-text-primary'),
    secondary: at('--color-text-secondary'),
    accent: at('--color-accent'),
    onAccent: at('--color-on-accent'),
    success: at('--color-success'),
    error: at('--color-error'),
  };
};

export const AppearanceRoute = () => {
  const { pack, setPack, mode, setMode, density, setDensity, corners, setCorners, accent, setAccent } =
    useThemeMode();
  const { branding, updateBranding, isSaving } = useBranding();
  const { message } = App.useApp();
  const [draft, setDraft] = useState({
    productName: branding.productName,
    workspaceName: branding.workspaceName ?? '',
    logoUrl: branding.logoUrl ?? '',
  });

  useEffect(() => {
    setDraft({
      productName: branding.productName,
      workspaceName: branding.workspaceName ?? '',
      logoUrl: branding.logoUrl ?? '',
    });
  }, [branding]);

  const previews = useMemo(
    () =>
      THEME_PACK_LIST.map((entry) => {
        const c = colorsFor(entry.id, mode);
        const worstText = Math.min(contrast(c.ink, c.surface), contrast(c.secondary, c.surface));
        const accentRatio = contrast(c.accent, c.paper);
        return { entry, c, passes: worstText >= 4.5 && accentRatio >= 3 };
      }),
    [mode]
  );

  return (
    <PageTemplate
      title="Appearance"
      description="Choose how the console looks. Every theme keeps the same layout, the same status colours and the same controls — only values change."
      breadcrumb={[{ label: 'Settings' }, { label: 'Appearance' }]}
      contentClassName="appearance-page"
    >
      <Panel
        title="Theme"
        description="Each preview is rendered from the theme's own tokens, in the mode you are using."
      >

        <div className="appearance-grid" role="radiogroup" aria-label="Theme">
          {previews.map(({ entry, passes }) => (
            <div
              key={entry.id}
              role="radio"
              aria-checked={pack === entry.id}
              tabIndex={0}
              className="appearance-card"
              onClick={() => setPack(entry.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setPack(entry.id);
                }
              }}
            >
              <AstryxTheme theme={entry.theme} mode={mode}>
                <div className="appearance-preview">
                  <span className="appearance-mini">
                    <span className="appearance-mini-value">1,284</span>
                    <span className="appearance-mini-status">
                      <span className="appearance-dot" /> Delivered
                    </span>
                  </span>
                  <span className="appearance-swatches" aria-hidden="true">
                    <span className="sw-paper" />
                    <span className="sw-accent" />
                    <span className="sw-success" />
                    <span className="sw-error" />
                  </span>
                </div>
              </AstryxTheme>
              <span className="appearance-card-body">
                <span className="appearance-card-title">
                  {entry.name}
                  {pack === entry.id && <span className="appearance-current">Current</span>}
                  <span className={`appearance-aa ${passes ? 'is-pass' : 'is-fail'}`}>
                    {passes ? 'AA' : 'Check'}
                  </span>
                </span>
                <span className="appearance-card-desc">{entry.description}</span>
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Mode and density"
        description="Structure never changes between options; spacing and colour do."
      >

        <div className="appearance-row">
          <Text as="div" display="block" className="console-type-body">
            Mode
          </Text>
          <div className="appearance-seg" role="group" aria-label="Mode">
            {(['light', 'dark'] as const).map((value) => (
              <Button
                key={value}
                label={value === 'light' ? 'Light' : 'Dark'}
                variant={mode === value ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setMode(value)}
              />
            ))}
          </div>
        </div>

        <div className="appearance-row">
          <Text as="div" display="block" className="console-type-body">
            Corners
          </Text>
          <div className="appearance-seg" role="group" aria-label="Corners">
            <Button
              label="Soft"
              variant={corners === 'soft' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setCorners('soft')}
            />
            <Button
              label="Sharp"
              variant={corners === 'sharp' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setCorners('sharp')}
            />
          </div>
        </div>

        <div className="appearance-row">
          <Text as="div" display="block" className="console-type-body">
            Action colour
          </Text>
          <div className="appearance-seg appearance-swatches" role="group" aria-label="Action colour">
            {ACCENT_OPTIONS.map((option) => {
              const swatch =
                option.id === 'theme'
                  ? 'var(--color-accent)'
                  : ACCENTS[option.id as Exclude<AccentChoice, 'theme'>][mode];
              return (
                <button
                  key={option.id}
                  type="button"
                  className="appearance-swatch"
                  aria-label={option.label}
                  aria-pressed={accent === option.id}
                  title={option.label}
                  style={{ background: swatch }}
                  onClick={() => setAccent(option.id)}
                />
              );
            })}
          </div>
        </div>

        <div className="appearance-row">
          <Text as="div" display="block" className="console-type-body">
            Density
          </Text>
          <div className="appearance-seg" role="group" aria-label="Density">
            <Button
              label="Comfortable"
              variant={density === 'middle' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDensity('middle')}
            />
            <Button
              label="Compact"
              variant={density === 'small' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDensity('small')}
            />
          </div>
        </div>

        <Text as="p" display="block" type="supporting" color="secondary" className="appearance-note">
          The choice is stored per user. It does not change layout, data, permissions or delivery behaviour,
          and it is never sent with integration configuration.
        </Text>
      </Panel>

      <Panel
        title="Branding"
        description="The wordmark in the rail, the login screen and the browser title. Organisation-wide; administrators only."
      >
        <div className="appearance-field">
          <label htmlFor="brand-product">Product name</label>
          <Input
            id="brand-product"
            value={draft.productName}
            onChange={(event) => setDraft((current) => ({ ...current, productName: event.target.value }))}
          />
        </div>
        <div className="appearance-field">
          <label htmlFor="brand-workspace">Workspace wordmark (optional)</label>
          <Input
            id="brand-workspace"
            placeholder="Shown above the product name"
            value={draft.workspaceName}
            onChange={(event) => setDraft((current) => ({ ...current, workspaceName: event.target.value }))}
          />
        </div>
        <div className="appearance-field">
          <label htmlFor="brand-logo">Logo URL (optional)</label>
          <Input
            id="brand-logo"
            placeholder="https://…"
            value={draft.logoUrl}
            onChange={(event) => setDraft((current) => ({ ...current, logoUrl: event.target.value }))}
          />
        </div>
        <div className="appearance-actions">
          <Button
            label="Save branding"
            variant="primary"
            size="sm"
            isDisabled={isSaving}
            onClick={() => {
              updateBranding({
                productName: draft.productName,
                workspaceName: draft.workspaceName,
                logoUrl: draft.logoUrl,
              })
                .then(() => message.success('Branding saved'))
                .catch(() => message.error('Could not save branding. Administrators only.'));
            }}
          />
          <Button
            label="Reset to deployment default"
            variant="secondary"
            size="sm"
            isDisabled={isSaving}
            onClick={() => {
              updateBranding({
                productName: DEFAULT_BRANDING.productName,
                workspaceName: DEFAULT_BRANDING.workspaceName ?? '',
                logoUrl: DEFAULT_BRANDING.logoUrl ?? '',
              })
                .then(() => message.success('Branding reset'))
                .catch(() => message.error('Could not reset branding. Administrators only.'));
            }}
          />
        </div>
      </Panel>
    </PageTemplate>
  );
};
