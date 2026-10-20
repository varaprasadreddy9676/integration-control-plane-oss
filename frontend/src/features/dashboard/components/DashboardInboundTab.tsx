import { useMemo } from 'react';
import { Card, Typography, Skeleton, Tag } from 'antd';
import { ApiOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { LineChart, BarChart, ComposedChart, HeatmapChart, HeatmapData } from '../../../components/charts';
import { ModernTable } from '../../../components/common/ModernTable';
import { formatNumber } from '../../../utils/format';
import { useDesignTokens } from '../../../design-system/utils';
import {
  DashboardEmptyState,
  DashboardSectionTitle,
  DashboardMetricTile,
  useDashboardPanelStyle,
  useDashboardTagTone,
} from './DashboardPrimitives';

interface DashboardInboundTabProps {
  days: number;
  timeLabel: string;
  analyticsLoading: boolean;
  analytics: any;
  timeseriesHourly: any;
  performanceAnalytics: any;
  integrationPerformance: Array<any>;
  onNavigate: (path: string) => void;
  getIntegrationPath: (record: any) => string;
  noDataHint: string;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardInboundTab = ({
  days,
  timeLabel,
  analyticsLoading,
  analytics,
  timeseriesHourly,
  performanceAnalytics,
  integrationPerformance,
  onNavigate,
  getIntegrationPath,
  noDataHint,
  hiddenLegends,
  onLegendClick,
}: DashboardInboundTabProps) => {
  const { themeColors, spacing, token } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();
  const tagTone = useDashboardTagTone();

  // KPI Metrics
  const kpiMetrics = useMemo(() => {
    const summary = analytics?.summary || {};
    const performance = analytics?.performance || {};
    const performanceMetrics = performanceAnalytics?.metrics || {};
    const total = summary.total || 0;
    const successful = summary.successful || 0;
    const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0';
    const avgResponseTime = performance.avgResponseTime || 0;
    const p95 = performanceMetrics.p95ResponseTime || 0;

    return [
      {
        label: 'Total Requests',
        value: formatNumber(total),
        delta: timeLabel,
        icon: <ApiOutlined />,
        tone: themeColors.primary.default,
        onClick: () => onNavigate('/logs?direction=INBOUND'),
      },
      {
        label: 'Success Rate',
        value: `${successRate}%`,
        delta: `${formatNumber(successful)} successful`,
        icon: <CheckCircleOutlined />,
        // total === 0 means no inbound integrations have run yet — a genuinely
        // neutral "no data" state, not a failure, and must not read as red the
        // same way a real 0% success rate out of real traffic would.
        tone:
          total === 0
            ? themeColors.text.muted
            : parseFloat(successRate) >= 95
              ? themeColors.success.text
              : parseFloat(successRate) >= 85
                ? themeColors.warning.text
                : themeColors.error.text,
        onClick: () => onNavigate('/logs?direction=INBOUND&status=SUCCESS'),
      },
      {
        label: 'Avg Response Time',
        value: `${Math.round(avgResponseTime)} ms`,
        delta: `P95: ${Math.round(p95)} ms`,
        icon: <ClockCircleOutlined />,
        tone: themeColors.info.text,
      },
      {
        label: 'Rate Limit Status',
        value: '—',
        delta: 'Telemetry unavailable',
        icon: <WarningOutlined />,
        tone: token.colorTextSecondary,
      },
    ];
  }, [analytics, performanceAnalytics, themeColors, timeLabel, onNavigate, token.colorTextSecondary]);

  // Response Time Trend Data
  const responseTimeTrend = useMemo(() => {
    const hourlyData = timeseriesHourly?.data || [];
    return hourlyData
      .map((point: any) => {
        const timestamp = point.timestamp ? new Date(point.timestamp) : null;
        if (!timestamp || Number.isNaN(timestamp.getTime())) return null;
        return {
          hour: `${timestamp.getHours()}:00`,
          count: point.total || 0,
          avgResponseTime: point.avgResponseTime || 0,
          successful: point.successful || 0,
          failed: point.failed || 0,
        };
      })
      .filter(Boolean);
  }, [timeseriesHourly]);

  // Performance by Endpoint Table Data
  const endpointPerformance = useMemo(() => {
    return integrationPerformance
      .map((integration: any) => {
        return {
          ...integration,
          p95: integration.p95 ?? null,
          p99: integration.p99 ?? null,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [integrationPerformance]);

  // Success Rate by Integration for Reliability Chart
  const reliabilityChartData = useMemo(() => {
    return integrationPerformance
      .slice(0, 10) // Top 10
      .map((integration: any) => {
        const successRate = parseFloat(integration.successRate) || 0;
        const failureRate = 100 - successRate;
        return {
          name: integration.__KEEP_integrationName__?.substring(0, 30) || 'Unknown',
          nameShort: integration.__KEEP_integrationName__?.substring(0, 20) || 'Unknown',
          successRate,
          failureRate,
          total: integration.total,
        };
      })
      .sort((a, b) => a.successRate - b.successRate); // Sort by success rate ascending to show problematic ones first
  }, [integrationPerformance]);

  // Peak Hours Heatmap
  const heatmapData: HeatmapData[] = useMemo(() => {
    const hourlyData = timeseriesHourly?.data || [];
    const heatmap: HeatmapData[] = [];
    const dayLabelsByIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const groupedData: Record<string, Record<string, number>> = {};

    hourlyData.forEach((point: any) => {
      const timestamp = point.timestamp ? new Date(point.timestamp) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) return;

      const day = dayLabelsByIndex[timestamp.getDay()];
      const hour = `${timestamp.getHours()}`;
      if (!groupedData[day]) groupedData[day] = {};
      groupedData[day][hour] = (groupedData[day][hour] || 0) + (point.total || 0);
    });

    Object.entries(groupedData).forEach(([day, hours]) => {
      Object.entries(hours).forEach(([hour, value]) => {
        heatmap.push({
          x: `${hour}h`,
          y: day,
          value,
        });
      });
    });

    return heatmap;
  }, [timeseriesHourly]);

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i}h`);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <>
      {/* Real-Time Health Status KPI Cards */}
      <section className="dashboard-overview" style={{ marginTop: spacing[4] }}>
        <div className="dashboard-kpis">
          {kpiMetrics.map((metric) => (
            <DashboardMetricTile key={metric.label} {...metric} loading={analyticsLoading} />
          ))}
        </div>
      </section>

      {/* API Performance Metrics */}
      <section style={{ ...panelStyle, marginTop: spacing[4] }}>
        <Card
          variant="borderless"
          title={
            <DashboardSectionTitle
              title="API Performance Trends"
              subtitle={`Response time and request volume over time (${timeLabel})`}
            />
          }
          styles={{ body: { padding: spacing[5] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : responseTimeTrend.length > 0 ? (
            <ComposedChart
              data={responseTimeTrend}
              bars={[{ dataKey: 'count', name: 'Requests', color: themeColors.primary.default }]}
              lines={[
                {
                  dataKey: 'avgResponseTime',
                  name: 'Avg Response Time (ms)',
                  color: themeColors.info.text,
                  strokeWidth: 2,
                },
              ]}
              xAxisKey="hour"
              height={280}
              showLegend={true}
              hiddenLegends={hiddenLegends}
              onLegendClick={onLegendClick}
            />
          ) : (
            <DashboardEmptyState message={noDataHint} />
          )}
        </Card>

        <Card
          style={{ marginTop: spacing[4] }}
          variant="borderless"
          title={
            <DashboardSectionTitle
              title="Performance by Endpoint"
              subtitle="Latency and success metrics per inbound integration"
            />
          }
          styles={{ body: { padding: 0 } }}
        >
          {analyticsLoading ? (
            <div style={{ padding: spacing[4] }}>
              <Skeleton active paragraph={{ rows: 6 }} />
            </div>
          ) : endpointPerformance.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={endpointPerformance}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} endpoints`,
                position: ['bottomCenter'],
              }}
              rowKey="__KEEP___KEEP_integrationConfig__Id__"
              columns={[
                {
                  title: 'Endpoint',
                  dataIndex: '__KEEP_integrationName__',
                  key: '__KEEP_integrationName__',
                  width: 250,
                  ellipsis: true,
                  sorter: (a: any, b: any) => a.__KEEP_integrationName__.localeCompare(b.__KEEP_integrationName__),
                  render: (name: string, record: any) => (
                    <Typography.Link
                      onClick={() => onNavigate(getIntegrationPath(record))}
                      style={{ fontWeight: 600, fontSize: 14 }}
                      ellipsis
                    >
                      {name || 'Unknown'}
                    </Typography.Link>
                  ),
                },
                {
                  title: 'Total Requests',
                  dataIndex: 'total',
                  key: 'total',
                  align: 'right',
                  width: 150,
                  sorter: (a: any, b: any) => a.total - b.total,
                  render: (value: number) => (
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      {formatNumber(value)}
                    </Typography.Text>
                  ),
                },
                {
                  title: 'Success Rate',
                  dataIndex: 'successRate',
                  key: 'successRate',
                  align: 'right',
                  width: 140,
                  sorter: (a: any, b: any) => parseFloat(a.successRate) - parseFloat(b.successRate),
                  render: (rate: string) => {
                    const numRate = parseFloat(rate);
                    const color =
                      numRate >= 95
                        ? themeColors.success.text
                        : numRate >= 85
                          ? themeColors.warning.text
                          : themeColors.error.text;
                    return <Tag style={tagTone(color)}>{rate}%</Tag>;
                  },
                },
                {
                  title: 'Avg Response',
                  dataIndex: 'avgResponseTime',
                  key: 'avgResponseTime',
                  align: 'right',
                  width: 140,
                  sorter: (a: any, b: any) => a.avgResponseTime - b.avgResponseTime,
                  render: (latency: number) => (
                    <Typography.Text style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
                      {Math.round(latency)} ms
                    </Typography.Text>
                  ),
                },
                {
                  title: 'P95',
                  dataIndex: 'p95',
                  key: 'p95',
                  align: 'right',
                  width: 100,
                  sorter: (a: any, b: any) => a.p95 - b.p95,
                  render: (latency: number) =>
                    latency != null ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                        {latency} ms
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        —
                      </Typography.Text>
                    ),
                },
                {
                  title: 'P99',
                  dataIndex: 'p99',
                  key: 'p99',
                  align: 'right',
                  width: 100,
                  sorter: (a: any, b: any) => a.p99 - b.p99,
                  render: (latency: number) =>
                    latency != null ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                        {latency} ms
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        —
                      </Typography.Text>
                    ),
                },
              ]}
            />
          ) : (
            <DashboardEmptyState message={noDataHint} />
          )}
        </Card>
      </section>

      {/* Reliability Tracking */}
      <section className="dashboard-tab-grid">
        <Card
          style={panelStyle}
          variant="borderless"
          title={
            <DashboardSectionTitle
              title="Reliability by Integration"
              subtitle="Success vs failure rates for inbound APIs"
            />
          }
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : reliabilityChartData.length > 0 ? (
            <BarChart
              data={reliabilityChartData}
              bars={[
                { dataKey: 'successRate', name: 'Success %', color: themeColors.success.text, stackId: 'a' },
                { dataKey: 'failureRate', name: 'Failure %', color: themeColors.error.text, stackId: 'a' },
              ]}
              xAxisKey="nameShort"
              height={320}
              layout="horizontal"
              showLegend={true}
              barSize={24}
              wrapAxisLabels={true}
              axisLabelMaxWidth={110}
              yAxisTickFormatter={(value) => `${value}%`}
              hiddenLegends={hiddenLegends}
              onLegendClick={onLegendClick}
            />
          ) : (
            <DashboardEmptyState message={noDataHint} />
          )}
        </Card>
      </section>

      {/* Usage Patterns */}
      <section className="dashboard-tab-grid">
        {days >= 7 && heatmapData.length > 0 && (
          <Card
            style={panelStyle}
            variant="borderless"
            title={
              <DashboardSectionTitle title="Peak Hours Heatmap" subtitle="Request patterns by day of week and hour" />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            {analyticsLoading ? (
              <Skeleton active paragraph={{ rows: 8 }} />
            ) : (
              <HeatmapChart
                data={heatmapData}
                xLabels={hourLabels}
                yLabels={dayLabels}
                height={280}
                valueFormatter={(v) => formatNumber(v)}
                onCellClick={(data) => {
                  onNavigate(`/logs?direction=INBOUND&hour=${data.x}&dayOfWeek=${data.y}`);
                }}
              />
            )}
          </Card>
        )}
      </section>
    </>
  );
};
