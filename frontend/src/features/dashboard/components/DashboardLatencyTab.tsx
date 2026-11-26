import { Card, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { BarChart } from '../../../components/charts';
import { useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { DashboardLoadingState, DashboardSectionTitle, DASHBOARD_PANEL_CLASS } from './DashboardPrimitives';

interface DashboardLatencyTabProps {
  performanceLoading: boolean;
  latencyDistributionData: Array<{ bucket: string; Count: number }>;
  latencySummary: { avg: number; p95: number; min: number; max: number } | null;
  noDataHint: string;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardLatencyTab = ({
  performanceLoading,
  latencyDistributionData,
  latencySummary,
  noDataHint,
  hiddenLegends,
  onLegendClick,
}: DashboardLatencyTabProps) => {
  const { themeColors, spacing } = useDesignTokens();

  return (
    <section className="dashboard-tab-grid">
      <Card
        className={DASHBOARD_PANEL_CLASS}
        variant="borderless"
        title={
          <DashboardSectionTitle title="Latency Distribution" subtitle="Response times across the selected window" />
        }
        styles={{ body: { padding: spacing[4] } }}
      >
        {performanceLoading ? (
          <DashboardLoadingState title="Loading latency distribution" />
        ) : latencyDistributionData.length > 0 ? (
          <BarChart
            data={latencyDistributionData}
            bars={[{ dataKey: 'Count', name: 'Requests', color: themeColors.info.text }]}
            xAxisKey="bucket"
            height={320}
            showLegend={false}
            barSize={20}
            wrapAxisLabels={true}
            axisLabelMaxWidth={80}
            axisLabelMaxLines={2}
            hiddenLegends={hiddenLegends}
            onLegendClick={onLegendClick}
          />
        ) : (
          <div className="console-empty-centered">
            <Text type="supporting" color="secondary">
              {noDataHint}
            </Text>
          </div>
        )}
      </Card>

      <Card
        className={DASHBOARD_PANEL_CLASS}
        variant="borderless"
        title={<DashboardSectionTitle title="Latency Summary" subtitle="Key response time metrics" />}
        styles={{ body: { padding: spacing[4] } }}
      >
        {performanceLoading ? (
          <DashboardLoadingState title="Loading latency summary" />
        ) : latencySummary ? (
          <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
            <div className="dashboard-stat-row">
              <Text type="supporting" color="secondary">
                Average
              </Text>
              <Text weight="semibold" hasTabularNumbers>
                {latencySummary.avg} ms
              </Text>
            </div>
            <div className="dashboard-stat-row">
              <Text type="supporting" color="secondary">
                P95
              </Text>
              <Text weight="semibold" hasTabularNumbers>
                {latencySummary.p95} ms
              </Text>
            </div>
            <div className="dashboard-stat-row">
              <Text type="supporting" color="secondary">
                Min
              </Text>
              <Text weight="semibold" hasTabularNumbers>
                {latencySummary.min} ms
              </Text>
            </div>
            <div className="dashboard-stat-row">
              <Text type="supporting" color="secondary">
                Max
              </Text>
              <Text weight="semibold" hasTabularNumbers>
                {latencySummary.max} ms
              </Text>
            </div>
          </Space>
        ) : (
          <div className="console-empty-centered">
            <Text type="supporting" color="secondary">
              {noDataHint}
            </Text>
          </div>
        )}
      </Card>
    </section>
  );
};
