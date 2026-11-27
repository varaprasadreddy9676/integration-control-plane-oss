import { Text } from '@astryxdesign/core/Text';
import { BarChart, ComposedChart } from '../../../components/charts';
import { cssVar } from '../../../design-system/utils';
import { Panel } from '../../../design-system/primitives';
import { DashboardLoadingState } from './DashboardPrimitives';

interface DashboardOverviewTabProps {
  days: number;
  deliveryTrendData: Array<Record<string, any>>;
  hourlyPatternData: Array<Record<string, any>>;
  analyticsLoading: boolean;
  noDataHint: string;
  onTrendChartClick?: (data: any) => void;
  onHourlyChartClick?: (data: any) => void;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

/**
 * Overview: two panels, not six cards. Each chart owns one surface with a title
 * row and a description; the decorative "Aggregated by Day" / "24-Hour Cycle"
 * pills are gone — the aggregation is stated in the description instead.
 */
export const DashboardOverviewTab = ({
  days,
  deliveryTrendData,
  hourlyPatternData,
  analyticsLoading,
  noDataHint,
  onTrendChartClick,
  onHourlyChartClick,
  hiddenLegends,
  onLegendClick,
}: DashboardOverviewTabProps) => {
  const rangeLabel = days === 1 ? 'Today' : `${days} days`;

  return (
    <div className="dashboard-overview-panels">
      <Panel
        title={`Delivery Trends (${rangeLabel})`}
        description="Daily delivery success and failure, aggregated by day."
      >
        {analyticsLoading ? (
          <DashboardLoadingState title="Loading delivery trend" />
        ) : deliveryTrendData.length > 0 ? (
          <ComposedChart
            data={deliveryTrendData}
            bars={[
              { dataKey: 'Successful', name: 'Successful', color: cssVar.success.text, stackId: 'a' },
              { dataKey: 'Failed', name: 'Failed', color: cssVar.error.text, stackId: 'a' },
              { dataKey: 'Skipped', name: 'Skipped', color: cssVar.warning.text, stackId: 'a' },
            ]}
            lines={[]}
            xAxisKey="date"
            height={320}
            animate={false}
            showLegend={true}
            smooth={true}
            barSize={deliveryTrendData.length <= 7 ? 32 : deliveryTrendData.length <= 30 ? 18 : 10}
            onBarClick={onTrendChartClick}
            hiddenLegends={hiddenLegends}
            onLegendClick={onLegendClick}
          />
        ) : (
          <Text color="secondary">{noDataHint}</Text>
        )}
      </Panel>

      <Panel
        title="Hourly Delivery Pattern"
        description="Activity distribution across 24 hours — peak business traffic."
      >
        {analyticsLoading ? (
          <DashboardLoadingState title="Loading hourly pattern" />
        ) : hourlyPatternData.length > 0 ? (
          <BarChart
            data={hourlyPatternData}
            bars={[
              { dataKey: 'Successful', name: 'Successful', color: cssVar.success.text, stackId: 'a' },
              { dataKey: 'Failed', name: 'Failed', color: cssVar.error.text, stackId: 'a' },
              { dataKey: 'Skipped', name: 'Skipped', color: cssVar.warning.text, stackId: 'a' },
            ]}
            xAxisKey="hour"
            height={280}
            showLegend={true}
            barSize={18}
            onBarClick={onHourlyChartClick}
            hiddenLegends={hiddenLegends}
            onLegendClick={onLegendClick}
          />
        ) : (
          <Text color="secondary">{noDataHint}</Text>
        )}
      </Panel>
    </div>
  );
};
