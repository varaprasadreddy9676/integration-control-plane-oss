import { useMemo, type ReactNode } from 'react';
import { Skeleton, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, InboxOutlined } from '@ant-design/icons';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';
import { useThemeMode } from '../../../app/theme-provider';
import { AnimatedNumber } from '../../../components/motion/AnimatedNumber';

/**
 * Standard "nothing to show" panel state — icon + message, matching the treatment
 * "Top Errors" already used while other dashboard panels (Failure Categories, Needs
 * Attention, Recent Failures) fell back to bare text, an inconsistency confirmed
 * live on the same screen.
 */
export const DashboardEmptyState = ({ message, icon }: { message: string; icon?: JSX.Element }) => {
  const { spacing } = useDesignTokens();

  return (
    <div
      style={{
        textAlign: 'center',
        padding: `${spacing[9]} 0`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: spacing[2],
      }}
    >
      {icon ?? <InboxOutlined style={{ fontSize: spacing[10], color: cssVar.text.muted }} />}
      <Typography.Text type="secondary">{message}</Typography.Text>
    </div>
  );
};

export const useDashboardPanelStyle = () => {
  const { token } = useDesignTokens();

  return useMemo(
    () =>
      ({
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${cssVar.border.default}`,
        background: cssVar.bg.surface,
        boxShadow: 'none',
        overflow: 'hidden',
      }) as const,
    [token]
  );
};

export const useDashboardTagTone = () => {
  const { spacing, token, borderRadius } = useDesignTokens();

  return (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.25),
    background: withAlpha(base, 0.12),
    color: base,
    fontWeight: 700,
    paddingInline: spacing[2],
    paddingBlock: spacing['0.5'],
    fontSize: token.fontSizeSM,
  });
};

export const DashboardSectionTitle = ({ title, subtitle }: { title: string; subtitle?: string }) => {
  const { spacing, token } = useDesignTokens();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing['0.5'] }}>
      <Typography.Title level={4} style={{ margin: 0, fontSize: 15, letterSpacing: 0 }}>
        {title}
      </Typography.Title>
      {subtitle && (
        <Typography.Text type="secondary" style={{ fontSize: token.fontSize }}>
          {subtitle}
        </Typography.Text>
      )}
    </div>
  );
};

interface MetricStyleConfig {
  border: string;
  background: string;
  iconBg: string;
  iconBorder: string;
  iconColor: string;
  textColor: string;
  topHighlight?: string;
  isCritical?: boolean;
}

// Light-mode tints are flat washes, not top-to-bottom gradients: at 0.45-0.55
// over white the gradient's grey lower half was clearly visible and read as a
// rendering artefact rather than a deliberate tint.
const getMetricTileStyles = (
  _label: string,
  _fallbackTone: string,
  isDark: boolean,
  isCritical: boolean
): MetricStyleConfig => {
  if (isCritical) {
    return {
      border: cssVar.error.border,
      background: cssVar.bg.elevated,
      iconBg: cssVar.error.bg,
      iconBorder: cssVar.error.border,
      iconColor: cssVar.error.text,
      textColor: cssVar.error.text,
      isCritical: true,
    };
  }

  return {
    border: cssVar.border.default,
    background: isDark ? cssVar.bg.elevated : cssVar.bg.surface,
    iconBg: cssVar.bg.subtle,
    iconBorder: cssVar.border.default,
    iconColor: cssVar.text.secondary,
    textColor: cssVar.text.primary,
    isCritical: false,
  };
};

// A "sparkline" drawn from constants was removed here. It rendered fixed bar
// heights and fixed SVG paths that took no data argument, so every tile showed
// the same rising trend on every load — including while the tile itself read
// "No data for this range". On a delivery console that is not decoration, it is
// a chart that lies: an operator could read a recovery off a line that never
// moves. Real per-metric series are available (timeseriesDaily in
// DashboardRoute); wire those in if the sparkline is wanted back.

export const DashboardMetricTile = ({
  label,
  value,
  delta,
  icon,
  tone,
  loading = false,
  trend,
  trendLabel,
  onClick,
  critical,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  icon: JSX.Element;
  tone: string;
  /** Whether this metric is genuinely in a bad state right now. */
  critical?: boolean;
  loading?: boolean;
  trend?: number;
  trendLabel?: string;
  onClick?: () => void;
}) => {
  const { spacing, token } = useDesignTokens();
  const { mode } = useThemeMode();
  // The route decides whether a metric is genuinely bad; the tile must not
  // re-decide from its own title, or every Failed card is red regardless of the
  // number on it. Passed as a boolean rather than inferred by comparing colour
  // strings — cssVar values are 'var(--color-error-text)' while the route passes
  // a resolved hex, so that comparison silently never matched.
  const isCritical = Boolean(critical);
  // A tile with no number should recede. Rendering "—" at the same weight and
  // colour as a real figure gave five empty cards the visual mass of a full
  // dashboard, and made an empty Failed card look like an incident.
  const isPlaceholder = typeof value === 'string' && /^[—–-]$/.test(value.trim());
  const styles = useMemo(
    () => getMetricTileStyles(label, tone, mode === 'dark', isCritical),
    [label, tone, mode, isCritical]
  );

  // Use semantic button when clickable, div when not
  const Wrapper = onClick ? 'button' : 'div';
  const buttonProps = onClick
    ? {
        type: 'button' as const,
        'aria-label': `${label}: ${value}`,
        style: {
          margin: 0,
          width: '100%',
          cursor: 'pointer',
          font: 'inherit',
          textAlign: 'left',
          appearance: 'none' as const,
          WebkitAppearance: 'none' as const,
        } as React.CSSProperties,
      }
    : {};

  return (
    <Wrapper
      {...buttonProps}
      className="dashboard-metric-tile"
      onClick={onClick}
      style={{
        border: `1px solid ${styles.border}`,
        background: styles.background,
        padding: '12px',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 112,
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'none',
        cursor: onClick ? 'pointer' : 'default',
        ...(!onClick ? {} : (buttonProps.style as React.CSSProperties)),
      }}
    >
      {styles.topHighlight && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: styles.topHighlight,
          }}
        />
      )}

      {loading ? (
        <>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[1] }}
          >
            <Skeleton.Input active size="small" style={{ width: 120 }} />
            <Skeleton.Avatar active size="small" shape="square" style={{ borderRadius: 8 }} />
          </div>
          <Skeleton.Input active size="large" style={{ width: 140, height: 32 }} />
          <Skeleton.Input active size="small" style={{ width: 160 }} />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Typography.Text
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0,
                  color: styles.isCritical ? styles.textColor : cssVar.text.muted,
                }}
              >
                {label}
              </Typography.Text>
              {styles.isCritical && (
                <span
                  className="live-pulse-dot"
                  style={{ background: '#F43F5E', width: 6, height: 6 }}
                  title="Active error monitoring"
                />
              )}
            </div>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: styles.iconBg,
                border: `1px solid ${styles.iconBorder}`,
                color: styles.iconColor,
                display: 'grid',
                placeItems: 'center',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              {icon}
            </div>
          </div>

          <div style={{ marginTop: 6, marginBottom: 2 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <Typography.Text
                style={{
                  margin: 0,
                  fontSize: 24,
                  letterSpacing: 0,
                  lineHeight: 1.15,
                  color: isPlaceholder ? cssVar.text.muted : styles.textColor,
                  fontWeight: isPlaceholder ? 500 : 700,
                  fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <AnimatedNumber value={value} />
              </Typography.Text>
              {trend !== undefined && trend !== 0 && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: 9999,
                    background:
                      trend > 0
                        ? styles.isCritical
                          ? 'rgba(244, 63, 94, 0.12)'
                          : 'rgba(16, 185, 129, 0.12)'
                        : 'rgba(100, 116, 139, 0.1)',
                    color:
                      trend > 0
                        ? styles.isCritical
                          ? '#E11D48'
                          : '#059669'
                        : '#64748B',
                  }}
                >
                  {trend > 0 ? <ArrowUpOutlined style={{ fontSize: 9 }} /> : <ArrowDownOutlined style={{ fontSize: 9 }} />}
                  <span>{Math.abs(trend).toFixed(1)}%</span>
                </span>
              )}
            </div>
          </div>

          {(delta || trendLabel) && (
            <div
              style={{
                paddingTop: 6,
                borderTop: `1px solid ${styles.isCritical ? 'rgba(254, 205, 211, 0.5)' : 'rgba(226, 232, 240, 0.6)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Typography.Text
                ellipsis
                style={{
                  color: styles.isCritical ? styles.textColor : cssVar.text.muted,
                  fontSize: 11,
                  fontWeight: styles.isCritical ? 500 : 400,
                  lineHeight: 1.3,
                }}
              >
                {delta || trendLabel}
              </Typography.Text>
            </div>
          )}
        </>
      )}
    </Wrapper>
  );
};
