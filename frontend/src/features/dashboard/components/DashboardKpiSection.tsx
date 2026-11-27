import type { ReactElement } from 'react';
import { Metric, MetricStrip } from '../../../design-system/primitives';
import { AnimatedNumber } from '../../../components/motion/AnimatedNumber';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { StatePanel } from '../../../components/common/StatePanel';

interface DashboardKpiSectionProps {
  /** Spoken form of the selected window, e.g. "today" or "the last 7 days". */
  rangePhrase?: string;
  metrics: Array<{
    label: string;
    value: string;
    delta?: string;
    icon: ReactElement;
    tone: string;
    /** Metric is genuinely in a bad state (e.g. failures > 0), not just a red-themed category. */
    critical?: boolean;
    trend?: number;
    trendLabel?: string;
    onClick?: () => void;
  }>;
  loading: boolean;
}

/**
 * The first viewport of the dashboard: one divided strip of metrics, not five
 * floating cards. A serious figure colours the value only; the rest of the
 * strip stays neutral so the failure count is the one thing that stands out.
 */
export const DashboardKpiSection = ({ metrics, loading }: DashboardKpiSectionProps) => {
  if (loading) {
    return (
      <section className="dashboard-overview" aria-label="Key performance indicators">
        <StatePanel glyph="connecting" tone="busy" title="Loading delivery metrics" size="compact" />
      </section>
    );
  }

  return (
    <section className="dashboard-overview" aria-label="Key performance indicators">
      <MetricStrip className="ds-metrics--five">
        {metrics.map((metric) => {
          const hasTrend = metric.trend !== undefined && metric.trend !== 0;
          return (
            <Metric
              key={metric.label}
              label={metric.label}
              value={<AnimatedNumber value={metric.value} />}
              icon={metric.icon}
              tone={metric.critical ? 'bad' : 'neutral'}
              change={
                hasTrend ? (
                  <>
                    <GatewayIcon
                      size="xsm"
                      name={metric.trend! > 0 ? 'ArrowUpOutlined' : 'ArrowDownOutlined'}
                    />
                    {Math.abs(metric.trend!).toFixed(1)}%
                  </>
                ) : undefined
              }
              detail={metric.delta || metric.trendLabel}
              onClick={metric.onClick}
              ariaLabel={
                metric.onClick
                  ? `View details for ${metric.label}: ${metric.value}`
                  : `${metric.label}: ${metric.value}`
              }
            />
          );
        })}
      </MetricStrip>
    </section>
  );
};
