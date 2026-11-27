import { type ReactElement, type ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useDesignTokens, withAlpha } from '../../../design-system/utils';
import { AnimatedNumber } from '../../../components/motion/AnimatedNumber';
import { StatePanel } from '../../../components/common/StatePanel';

/**
 * Standard "nothing to show" panel state — icon + message, matching the treatment
 * "Top Errors" already used while other dashboard panels (Failure Categories, Needs
 * Attention, Recent Failures) fell back to bare text, an inconsistency confirmed
 * live on the same screen.
 */
export const DashboardEmptyState = ({ message }: { message: string }) => (
  <StatePanel glyph="searching" title={message} size="compact" />
);

export const DashboardLoadingState = ({ title = 'Loading dashboard data' }: { title?: string }) => (
  <StatePanel glyph="connecting" tone="busy" title={title} size="compact" />
);

export const DASHBOARD_PANEL_CLASS = 'console-dashboard-panel';

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
    fontSize: 'var(--console-type-caption)',
  });
};

export const getDashboardRateTone = (rate: number) => (rate >= 95 ? 'success' : rate >= 85 ? 'warning' : 'error');

export const getDashboardIntegrationRowKey = (record: Record<string, unknown>): string => {
  const key = [
    record.integrationConfigId,
    record.id,
    record.integrationName,
    record.integrationName,
  ].find((value) => (typeof value === 'string' && value.trim() !== '') || typeof value === 'number');

  return key === undefined ? JSON.stringify(record) || 'unknown-integration' : String(key);
};

export const DashboardSectionTitle = ({ title, subtitle }: { title: string; subtitle?: string }) => {
  return (
    <div className="dashboard-section-title dashboard-section-title-stack">
      <Heading level={4} className="console-margin-none">
        {title}
      </Heading>
      {subtitle && (
        <Text type="supporting" color="secondary">
          {subtitle}
        </Text>
      )}
    </div>
  );
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
  trend,
  trendLabel,
  onClick,
  critical,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  icon: ReactElement;
  tone: string;
  /** Whether this metric is genuinely in a bad state right now. */
  critical?: boolean;
  trend?: number;
  trendLabel?: string;
  onClick?: () => void;
}) => {
  // The route decides whether a metric is genuinely bad; the tile must not
  // re-decide from its own title, or every Failed card is red regardless of the
  // number on it. The route passes the critical state explicitly.
  const isCritical = Boolean(critical);
  // A tile with no number should recede. Rendering "—" at the same weight and
  // colour as a real figure gave five empty cards the visual mass of a full
  // dashboard, and made an empty Failed card look like an incident.
  const isPlaceholder = typeof value === 'string' && /^[—–-]$/.test(value.trim());
  // Use semantic button when clickable, div when not
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, 'aria-label': `${label}: ${value}` } : {})}
      className={`dashboard-metric-tile${onClick ? ' dashboard-metric-tile--interactive' : ''}`}
      onClick={onClick}
      data-critical={isCritical}
      data-placeholder={isPlaceholder}
    >
      {isCritical && <div className="dashboard-metric-critical-edge" />}

      <div className="dashboard-metric-heading">
        <div className="console-flex-center-gap-2">
          <Text type="label" weight="semibold" className={isCritical ? 'console-text-error' : 'console-text-secondary'}>
            {label}
          </Text>
          {isCritical && (
            <span className="live-pulse-dot dashboard-metric-critical-dot" title="Active error monitoring" />
          )}
        </div>
        <div className="dashboard-metric-icon" data-critical={isCritical}>
          {icon}
        </div>
      </div>

      <div className="dashboard-metric-value-wrap">
        <div className="dashboard-metric-value-row">
          <Text
            type="code"
            hasTabularNumbers
            className={`dashboard-metric-value${isPlaceholder ? ' dashboard-metric-value--placeholder' : ''}${isCritical ? ' dashboard-metric-value--critical' : ''}`}
          >
            <AnimatedNumber value={value} />
          </Text>
          {trend !== undefined && trend !== 0 && (
            <span className="dashboard-metric-trend">
              {trend > 0 ? (
                <GatewayIcon size="xsm" name="ArrowUpOutlined" />
              ) : (
                <GatewayIcon size="xsm" name="ArrowDownOutlined" />
              )}
              <span>{Math.abs(trend).toFixed(1)}%</span>
            </span>
          )}
        </div>
      </div>

      {(delta || trendLabel) && (
        <div className="dashboard-metric-footer" data-critical={isCritical}>
          <Text
            type="supporting"
            maxLines={1}
            className={
              isCritical ? 'console-text-error console-type-caption' : 'console-text-secondary console-type-caption'
            }
          >
            {delta || trendLabel}
          </Text>
        </div>
      )}
    </Wrapper>
  );
};
