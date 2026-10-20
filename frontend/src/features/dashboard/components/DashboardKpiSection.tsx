import { DashboardMetricTile } from './DashboardPrimitives';

interface DashboardKpiSectionProps {
  /** Spoken form of the selected window, e.g. "today" or "the last 7 days". */
  rangePhrase?: string;
  metrics: Array<{
    label: string;
    value: string;
    delta?: string;
    icon: JSX.Element;
    tone: string;
    /** Metric is genuinely in a bad state (e.g. failures > 0), not just a red-themed category. */
    critical?: boolean;
    trend?: number;
    trendLabel?: string;
    onClick?: () => void;
  }>;
  loading: boolean;
}

export const DashboardKpiSection = ({ metrics, loading }: DashboardKpiSectionProps) => {
  return (
    <section className="dashboard-overview" aria-label="Key performance indicators">
      <div className="dashboard-kpis">
        {loading
          ? metrics.map((metric) => (
              <DashboardMetricTile key={metric.label} {...metric} loading />
            ))
          : metrics.map((metric) => (
              <DashboardMetricTile
                key={metric.label}
                {...metric}
                onClick={metric.onClick}
                aria-label={metric.onClick ? `View details for ${metric.label}: ${metric.value}` : `${metric.label}: ${metric.value}`}
              />
            ))}
      </div>
    </section>
  );
};
