import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from './Icon';
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
  tone === 'critical'
    ? cssVar.error?.text || 'var(--color-error-text)'
    : cssVar.text?.primary || 'var(--color-text-primary)';

const supportingColor = () => cssVar.text?.secondary || 'var(--color-text-secondary)';
const mutedColor = () => cssVar.text?.muted || 'var(--color-text-muted)';

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
      className={`state-panel state-panel--${size}`}
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: SIZE_PADDING[size],
        gap: 'var(--spacing-1)',
      }}
    >
      {glyph && (
        <span
          aria-hidden="true"
          style={{
            fontSize: Math.min(glyphSize ?? DEFAULT_GLYPH_SIZE[size], 32),
            color: tone === 'critical' ? cssVar.error?.text || 'var(--color-error-text)' : supportingColor(),
            marginBottom: 'var(--spacing-2)',
          }}
        >
          {glyph === 'disrupted' ? (
            <GatewayIcon name="DisconnectOutlined" />
          ) : glyph === 'connecting' ? (
            <GatewayIcon name="ApiOutlined" />
          ) : (
            <GatewayIcon name="InboxOutlined" />
          )}
        </span>
      )}

      <Heading
        level={5}
        style={{
          fontSize: 'var(--console-type-control)',
          fontWeight: 600,
          lineHeight: 1.35,
          color: toneColor(tone),
          margin: 'var(--spacing-0)',
        }}
      >
        {title}
      </Heading>

      {description && (
        <Text
          type="supporting"
          as="div"
          style={{
            fontSize: 'var(--console-type-body)',
            color: supportingColor(),
            maxWidth: 460,
            lineHeight: 1.6,
          }}
        >
          {description}
        </Text>
      )}

      {actions && (
        <div className="state-panel__actions">{actions}</div>
      )}

      {footnote && (
        <div
          style={{
            marginTop: 'var(--spacing-4)',
            fontSize: 'var(--console-type-caption)',
            color: mutedColor(),
            maxWidth: 520,
            wordBreak: 'break-word',
          }}
        >
          {footnote}
        </div>
      )}
    </div>
  );
};
