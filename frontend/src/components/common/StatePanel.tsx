import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { ApiOutlined, DisconnectOutlined, InboxOutlined } from '@ant-design/icons';
import { cssVar } from '../../design-system/utils';

/**
 * Which state this panel depicts. Renders a small monochrome glyph — these were
 * full Lottie animations, removed because a 150px looping illustration is
 * decoration in a console people keep open all day.
 */
export type StateGlyph = 'connecting' | 'searching' | 'disrupted';

export type StateTone = 'neutral' | 'busy' | 'critical';

interface StatePanelProps {
  /** Which state glyph to show. Omit for a text-only panel. */
  glyph?: StateGlyph;
  title: ReactNode;
  description?: ReactNode;
  /** Primary/secondary buttons, rendered in a row under the copy. */
  actions?: ReactNode;
  /** Extra detail (error text, filter summary) shown below the actions. */
  footnote?: ReactNode;
  tone?: StateTone;
  size?: 'compact' | 'regular' | 'full';
  glyphSize?: number;
}

const SIZE_PADDING: Record<NonNullable<StatePanelProps['size']>, string> = {
  compact: '20px 16px',
  regular: '32px 20px',
  full: '48px 24px',
};

const DEFAULT_GLYPH_SIZE: Record<NonNullable<StatePanelProps['size']>, number> = {
  compact: 20,
  regular: 24,
  full: 32,
};

/**
 * The one empty / loading / error block used across the console.
 *
 * Every screen previously grew its own version of this moment — a bare spinner
 * here, an AntD <Empty> there, a full-bleed coloured panel somewhere else — so
 * the product felt different depending on which screen happened to have no data.
 * Routing all of them through one component is what makes "nothing to show"
 * look deliberate instead of unfinished.
 */
/**
 * Resolved per render rather than at module scope: these are CSS custom
 * properties, and reading them lazily keeps the component importable in
 * environments (tests, SSR) where the token module is stubbed.
 */
const toneColor = (tone: StateTone): string =>
  tone === 'critical' ? cssVar.error?.text : cssVar.text?.primary;

export const StatePanel = ({
  glyph,
  title,
  description,
  actions,
  footnote,
  tone = 'neutral',
  size = 'regular',
  glyphSize,
}: StatePanelProps) => {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: SIZE_PADDING[size],
        gap: 4,
      }}
    >
      {glyph && (
        <span aria-hidden="true" style={{ fontSize: Math.min(glyphSize ?? DEFAULT_GLYPH_SIZE[size], 32), color: tone === 'critical' ? cssVar.error.text : cssVar.text.secondary, marginBottom: 8 }}>
          {glyph === 'disrupted' ? <DisconnectOutlined /> : glyph === 'connecting' ? <ApiOutlined /> : <InboxOutlined />}
        </span>
      )}

      <Typography.Text
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: toneColor(tone),
          letterSpacing: 0,
        }}
      >
        {title}
      </Typography.Text>

      {description && (
        <Typography.Text
          style={{
            fontSize: 13,
            color: cssVar.text.secondary,
            maxWidth: 460,
            lineHeight: 1.6,
          }}
        >
          {description}
        </Typography.Text>
      )}

      {actions && <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>{actions}</div>}

      {footnote && (
        <div style={{ marginTop: 14, fontSize: 12, color: cssVar.text.muted, maxWidth: 520, wordBreak: 'break-word' }}>
          {footnote}
        </div>
      )}
    </div>
  );
};
