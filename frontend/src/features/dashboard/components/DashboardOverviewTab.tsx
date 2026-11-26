import { Card } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { BarChart, ComposedChart } from '../../../components/charts';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';
import { DashboardLoadingState, DashboardSectionTitle } from './DashboardPrimitives';

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
  const { themeColors, spacing } = useDesignTokens();

  return (
    <>
      {analyticsLoading ? (
        <section className="dashboard-chart-card console-margin-top-4">
          <Card
            variant="borderless"
            title={
              <DashboardSectionTitle
                title={`Delivery Trends (${days === 1 ? 'Today' : `${days} days`})`}
                subtitle="Daily delivery success and failure breakdown across integration pipelines"
              />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            <DashboardLoadingState title="Loading delivery trend" />
          </Card>
        </section>
      ) : deliveryTrendData.length > 0 ? (
        <section className="dashboard-chart-card console-margin-top-4">
          <Card
            variant="borderless"
            title={
              <div className="dashboard-chart-heading console-row-wrap">
                <DashboardSectionTitle
                  title={`Delivery Trends (${days === 1 ? 'Today' : `${days} days`})`}
                  subtitle="Daily delivery success and failure breakdown across integration pipelines"
                />
                <div className="console-flex-center-gap-2">
                  <span
                    style={{
                      fontSize: 'var(--console-type-caption)',
                      fontWeight: 600,
                      padding: 'var(--spacing-0-5) var(--spacing-2)',
                      borderRadius: 4,
                      // Light-surface values here rendered a pale pill on the
                      // dark dashboard; tokens follow the theme.
                      background: cssVar.bg.subtle,
                      color: cssVar.text.secondary,
                      border: `1px solid ${cssVar.border.default}`,
                    }}
                  >
                    Aggregated by Day
                  </span>
                </div>
              </div>
            }
            styles={{ body: { padding: spacing[5] } }}
          >
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
          </Card>
        </section>
      ) : (
        <section className="dashboard-chart-card console-margin-top-4">
          <Card
            variant="borderless"
            title={
              <DashboardSectionTitle
                title={`Delivery Trends (${days === 1 ? 'Today' : `${days} days`})`}
                subtitle="Daily delivery success and failure breakdown"
              />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            <Text color="secondary">{noDataHint}</Text>
          </Card>
        </section>
      )}

      {analyticsLoading ? (
        <section className="dashboard-chart-card console-margin-top-4">
          <Card
            variant="borderless"
            title={
              <DashboardSectionTitle title="Hourly Delivery Pattern" subtitle="Activity distribution across 24 hours" />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            <DashboardLoadingState title="Loading hourly pattern" />
          </Card>
        </section>
      ) : hourlyPatternData.length > 0 ? (
        <section className="dashboard-chart-card console-margin-top-4">
          <Card
            variant="borderless"
            title={
              <div className="console-row-wrap">
                <DashboardSectionTitle
                  title="Hourly Delivery Pattern"
                  subtitle="Activity distribution across 24 hours — peak business traffic"
                />
                <span
                  style={{
                    fontSize: 'var(--console-type-caption)',
                    fontWeight: 600,
                    padding: 'var(--spacing-0-5) var(--spacing-2)',
                    borderRadius: 4,
                    background: withAlpha(cssVar.accent.text, 0.12),
                    color: cssVar.accent.text,
                    border: `1px solid ${withAlpha(cssVar.accent.text, 0.28)}`,
                  }}
                >
                  24-Hour Cycle
                </span>
              </div>
            }
            styles={{ body: { padding: spacing[5] } }}
          >
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
          </Card>
        </section>
      ) : (
        <section className="dashboard-chart-card console-margin-top-4">
          <Card
            variant="borderless"
            title={
              <DashboardSectionTitle title="Hourly Delivery Pattern" subtitle="Activity distribution across 24 hours" />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            <Text color="secondary">{noDataHint}</Text>
          </Card>
        </section>
      )}
    </>
  );
};
