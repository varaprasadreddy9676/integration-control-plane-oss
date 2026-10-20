import { Card, Skeleton, Typography } from 'antd';
import { BarChart, ComposedChart } from '../../../components/charts';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';
import { DashboardSectionTitle, useDashboardPanelStyle } from './DashboardPrimitives';

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
  onLegendClick
}: DashboardOverviewTabProps) => {
  const { themeColors, spacing } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();

  return (
    <>
      {analyticsLoading ? (
        <section className="dashboard-chart-card" style={{ marginTop: spacing[4] }}>
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
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </section>
      ) : deliveryTrendData.length > 0 ? (
        <section className="dashboard-chart-card" style={{ marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <DashboardSectionTitle
                  title={`Delivery Trends (${days === 1 ? 'Today' : `${days} days`})`}
                  subtitle="Daily delivery success and failure breakdown across integration pipelines"
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 6,
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
                { dataKey: 'Successful', name: 'Successful', color: '#10B981', stackId: 'a' },
                { dataKey: 'Failed', name: 'Failed', color: '#F43F5E', stackId: 'a' },
                { dataKey: 'Skipped', name: 'Skipped', color: '#F59E0B', stackId: 'a' }
              ]}
              lines={[]}
              xAxisKey="date"
              height={320}
              showLegend={true}
              smooth={true}
              barSize={22}
              onBarClick={onTrendChartClick}
              hiddenLegends={hiddenLegends}
              onLegendClick={onLegendClick}
            />
          </Card>
        </section>
      ) : (
        <section className="dashboard-chart-card" style={{ marginTop: spacing[4] }}>
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
            <Typography.Text type="secondary">{noDataHint}</Typography.Text>
          </Card>
        </section>
      )}

      {analyticsLoading ? (
        <section className="dashboard-chart-card" style={{ marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={<DashboardSectionTitle title="Hourly Delivery Pattern" subtitle="Activity distribution across 24 hours" />}
            styles={{ body: { padding: spacing[5] } }}
          >
            <Skeleton active paragraph={{ rows: 5 }} />
          </Card>
        </section>
      ) : hourlyPatternData.length > 0 ? (
        <section className="dashboard-chart-card" style={{ marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <DashboardSectionTitle title="Hourly Delivery Pattern" subtitle="Activity distribution across 24 hours — peak business traffic" />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 6,
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
                { dataKey: 'Successful', name: 'Successful', color: '#10B981', stackId: 'a' },
                { dataKey: 'Failed', name: 'Failed', color: '#F43F5E', stackId: 'a' },
                { dataKey: 'Skipped', name: 'Skipped', color: '#F59E0B', stackId: 'a' }
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
        <section className="dashboard-chart-card" style={{ marginTop: spacing[4] }}>
          <Card
            variant="borderless"
            title={<DashboardSectionTitle title="Hourly Delivery Pattern" subtitle="Activity distribution across 24 hours" />}
            styles={{ body: { padding: spacing[5] } }}
          >
            <Typography.Text type="secondary">{noDataHint}</Typography.Text>
          </Card>
        </section>
      )}
    </>
  );
};
