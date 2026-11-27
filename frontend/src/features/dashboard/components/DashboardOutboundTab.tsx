import { useMemo } from 'react';
import { Card, List, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '../../../components/common/LegacyButton';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { BarChart, PieChart } from '../../../components/charts';
import { ModernTable } from '../../../components/common/ModernTable';
import { formatNumber, formatDateTime } from '../../../utils/format';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import {
  DashboardEmptyState,
  DashboardLoadingState,
  DashboardSectionTitle,
  getDashboardIntegrationRowKey,
  getDashboardRateTone,
  DASHBOARD_PANEL_CLASS,
} from './DashboardPrimitives';

interface DashboardOutboundTabProps {
  days: number;
  timeLabel: string;
  analyticsLoading: boolean;
  performanceLoading: boolean;
  errorsLoading: boolean;
  analytics: any;
  performanceAnalytics: any;
  errorAnalytics: any;
  timeseriesDaily: any;
  integrationPerformance: Array<any>;
  onNavigate: (path: string) => void;
  getIntegrationPath: (record: any) => string;
  noDataHint: string;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardOutboundTab = ({
  days,
  timeLabel,
  analyticsLoading,
  performanceLoading,
  errorsLoading,
  analytics,
  performanceAnalytics,
  errorAnalytics,
  timeseriesDaily,
  integrationPerformance,
  onNavigate,
  getIntegrationPath,
  noDataHint,
  hiddenLegends,
  onLegendClick,
}: DashboardOutboundTabProps) => {
  const { themeColors, spacing, token } = useDesignTokens();

  // Event Type Performance Metrics
  const eventTypeMetrics = useMemo(() => {
    const eventTypes = analytics?.eventTypes || {};
    const timeseriesData = timeseriesDaily?.data || [];

    return Object.entries(eventTypes)
      .map(([eventType, stats]: [string, any]) => {
        const total = typeof stats === 'number' ? stats : stats?.total || 0;
        const successful = typeof stats === 'number' ? 0 : stats?.successful || 0;
        const failed = typeof stats === 'number' ? 0 : stats?.failed || 0;
        const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0';
        const avgLatency = typeof stats === 'number' ? 0 : stats?.avgResponseTime || 0;

        // Calculate trend from timeseries
        const eventTypeSeries = timeseriesData
          .map((point: any) => {
            const eventData = point.eventTypes?.[eventType];
            return eventData ? (eventData.successful / (eventData.total || 1)) * 100 : 0;
          })
          .filter((v: number) => v > 0);

        let trend = 0;
        if (eventTypeSeries.length >= 2) {
          const recent = eventTypeSeries.slice(-Math.ceil(eventTypeSeries.length / 2));
          const older = eventTypeSeries.slice(0, Math.floor(eventTypeSeries.length / 2));
          const recentAvg = recent.reduce((a: number, b: number) => a + b, 0) / recent.length;
          const olderAvg = older.reduce((a: number, b: number) => a + b, 0) / older.length;
          trend = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;
        }

        return {
          eventType,
          total,
          successRate: parseFloat(successRate),
          avgLatency: Math.round(avgLatency),
          failed,
          trend,
        };
      })
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [analytics, timeseriesDaily]);

  // Per-Integration Health Status
  const integrationHealth = useMemo(() => {
    return integrationPerformance
      .map((integration: any) => {
        const successRate = parseFloat(integration.successRate) || 0;
        const health =
          successRate >= 95
            ? { status: 'Healthy', color: themeColors.success.text }
            : successRate >= 85
              ? { status: 'Degraded', color: themeColors.warning.text }
              : { status: 'Unhealthy', color: themeColors.error.text };

        const integrationError = errorAnalytics?.integrationBreakdown?.find(
          (err: any) => err.integrationConfigId === integration.integrationConfigId
        );
        const primaryFailure = integrationError?.category || integrationError?.topErrorMessage || '—';

        return {
          ...integration,
          health,
          primaryFailure: primaryFailure.length > 50 ? primaryFailure.substring(0, 50) + '...' : primaryFailure,
          lastDelivery: integration.lastSeen || integrationError?.lastSeen || null,
        };
      })
      .sort((a, b) => a.health.status.localeCompare(b.health.status) || b.total - a.total);
  }, [integrationPerformance, errorAnalytics, themeColors]);

  // Response Time Distribution
  const responseTimeDistribution = useMemo(() => {
    const buckets = performanceAnalytics?.distribution?.buckets || [];
    const total = buckets.reduce((sum: number, bucket: any) => sum + Number(bucket.count || 0), 0);
    return buckets.map((bucket: any) => ({
      label: bucket.label,
      count: bucket.count,
      percentage: total > 0 ? ((bucket.count / total) * 100).toFixed(1) : '0.0',
    }));
  }, [performanceAnalytics]);

  // Top Failures by Category
  const failuresByCategory = useMemo(() => {
    const categories = errorAnalytics?.summary?.errorCategories || {};
    return Object.entries(categories)
      .map(([category, count]) => ({
        name: category,
        value: count as number,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [errorAnalytics]);

  // Affected Integrations by Failures
  const affectedIntegrations = useMemo(() => {
    return integrationPerformance
      .filter((integration: any) => integration.failed > 0)
      .sort((a: any, b: any) => b.failed - a.failed)
      .slice(0, 10);
  }, [integrationPerformance]);

  return (
    <>
      {/* Event Type Performance Table */}
      <section className={`${DASHBOARD_PANEL_CLASS} console-margin-top-4`}>
        <Card
          title={
            <DashboardSectionTitle title="Event Type Performance" subtitle="Success rates and latency by event type" />
          }
          styles={{ body: { padding: 'var(--spacing-0)' } }}
          variant="borderless"
        >
          {analyticsLoading ? (
            <DashboardLoadingState title="Loading event type performance" />
          ) : eventTypeMetrics.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={eventTypeMetrics}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} event types`,
                position: ['bottomCenter'],
              }}
              rowKey="eventType"
              onRow={(record) => ({
                onClick: () => onNavigate(`/logs?eventType=${encodeURIComponent(record.eventType)}`),
                style: { cursor: 'pointer' },
              })}
              columns={[
                {
                  title: 'Event Type',
                  dataIndex: 'eventType',
                  key: 'eventType',
                  width: 280,
                  ellipsis: true,
                  sorter: (a: any, b: any) => a.eventType.localeCompare(b.eventType),
                  render: (name: string) => <Text weight="semibold">{name}</Text>,
                },
                {
                  title: 'Total Deliveries',
                  dataIndex: 'total',
                  key: 'total',
                  align: 'right',
                  width: 150,
                  sorter: (a: any, b: any) => a.total - b.total,
                  render: (value: number) => (
                    <Text weight="semibold" hasTabularNumbers>
                      {formatNumber(value)}
                    </Text>
                  ),
                },
                {
                  title: 'Success Rate',
                  dataIndex: 'successRate',
                  key: 'successRate',
                  align: 'right',
                  width: 150,
                  sorter: (a: any, b: any) => a.successRate - b.successRate,
                  render: (rate: number) => {
                    return (
                      <Text
                        hasTabularNumbers
                        className={`dashboard-metric-tone dashboard-metric-tone--${getDashboardRateTone(rate)}`}
                      >
                        {rate}%
                      </Text>
                    );
                  },
                },
                {
                  title: 'Avg Latency',
                  dataIndex: 'avgLatency',
                  key: 'avgLatency',
                  align: 'right',
                  width: 140,
                  sorter: (a: any, b: any) => a.avgLatency - b.avgLatency,
                  render: (latency: number) => (
                    <Text type="code" hasTabularNumbers>
                      {latency} ms
                    </Text>
                  ),
                },
                {
                  title: 'Failures',
                  dataIndex: 'failed',
                  key: 'failed',
                  align: 'right',
                  width: 120,
                  sorter: (a: any, b: any) => a.failed - b.failed,
                  render: (count: number) =>
                    count > 0 ? (
                      <Text className="dashboard-metric-tone dashboard-metric-tone--error">{formatNumber(count)}</Text>
                    ) : (
                      <Text type="supporting" color="secondary">
                        —
                      </Text>
                    ),
                },
                {
                  title: 'Trend',
                  dataIndex: 'trend',
                  key: 'trend',
                  align: 'right',
                  width: 100,
                  render: (trend: number) => {
                    if (Math.abs(trend) < 0.5) {
                      return (
                        <Text type="supporting" color="secondary">
                          —
                        </Text>
                      );
                    }
                    const trendClassName = trend > 0 ? 'console-text-success' : 'console-text-error';
                    return (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: spacing['0.5'],
                          justifyContent: 'flex-end',
                        }}
                      >
                        {trend > 0 ? (
                          <GatewayIcon size="xsm" name="ArrowUpOutlined" className={trendClassName} />
                        ) : (
                          <GatewayIcon size="xsm" name="ArrowDownOutlined" className={trendClassName} />
                        )}
                        <Text weight="semibold" hasTabularNumbers className={trendClassName}>
                          {Math.abs(trend).toFixed(1)}%
                        </Text>
                      </div>
                    );
                  },
                },
              ]}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: `${spacing[9]} 0` }}>
              <GatewayIcon name="WarningOutlined" className="console-empty-state-icon" />
              <Text type="supporting" color="secondary" display="block" className="console-margin-top-2">
                {noDataHint}
              </Text>
            </div>
          )}
        </Card>
      </section>

      {/* Per-Integration Health Table */}
      <section className={`${DASHBOARD_PANEL_CLASS} console-margin-top-4`}>
        <Card
          title={
            <DashboardSectionTitle title="Integration Health" subtitle="Health status and performance by integration" />
          }
          styles={{ body: { padding: 'var(--spacing-0)' } }}
          variant="borderless"
        >
          {analyticsLoading ? (
            <DashboardLoadingState title="Loading integration health" />
          ) : integrationHealth.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={integrationHealth}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} integrations`,
                position: ['bottomCenter'],
              }}
              rowKey={getDashboardIntegrationRowKey}
              columns={[
                {
                  title: 'Integration Name',
                  dataIndex: 'integrationName',
                  key: 'integrationName',
                  width: 250,
                  ellipsis: true,
                  sorter: (a: any, b: any) => a.integrationName.localeCompare(b.integrationName),
                  render: (name: string, record: any) => (
                    <Button type="link" onClick={() => onNavigate(getIntegrationPath(record))}>
                      {name || 'Unknown'}
                    </Button>
                  ),
                },
                {
                  title: 'Health',
                  dataIndex: 'health',
                  key: 'health',
                  align: 'center',
                  width: 120,
                  sorter: (a: any, b: any) => a.health.status.localeCompare(b.health.status),
                  render: (health: any) => (
                    <Text
                      hasTabularNumbers
                      className={`dashboard-metric-tone dashboard-metric-tone--${health.status.toLowerCase()}`}
                    >
                      {health.status}
                    </Text>
                  ),
                },
                {
                  title: 'Success Rate',
                  dataIndex: 'successRate',
                  key: 'successRate',
                  align: 'right',
                  width: 130,
                  sorter: (a: any, b: any) => parseFloat(a.successRate) - parseFloat(b.successRate),
                  render: (rate: string) => {
                    const numRate = parseFloat(rate);
                    return (
                      <Text
                        hasTabularNumbers
                        className={`dashboard-metric-tone dashboard-metric-tone--${getDashboardRateTone(numRate)}`}
                      >
                        {rate}%
                      </Text>
                    );
                  },
                },
                {
                  title: 'Avg Latency',
                  dataIndex: 'avgResponseTime',
                  key: 'avgResponseTime',
                  align: 'right',
                  width: 130,
                  sorter: (a: any, b: any) => a.avgResponseTime - b.avgResponseTime,
                  render: (latency: number) => (
                    <Text type="code" hasTabularNumbers>
                      {Math.round(latency)} ms
                    </Text>
                  ),
                },
                {
                  title: 'Last Delivery',
                  dataIndex: 'lastDelivery',
                  key: 'lastDelivery',
                  align: 'right',
                  width: 140,
                  render: (timestamp: string | null) =>
                    timestamp ? (
                      <Text type="supporting" color="secondary">
                        {formatDateTime(timestamp)}
                      </Text>
                    ) : (
                      <Text type="supporting" color="secondary">
                        —
                      </Text>
                    ),
                },
                {
                  title: 'Total',
                  dataIndex: 'total',
                  key: 'total',
                  align: 'right',
                  width: 100,
                  sorter: (a: any, b: any) => a.total - b.total,
                  render: (value: number) => (
                    <Text type="code" hasTabularNumbers>
                      {formatNumber(value)}
                    </Text>
                  ),
                },
                {
                  title: 'Failed',
                  dataIndex: 'failed',
                  key: 'failed',
                  align: 'right',
                  width: 100,
                  sorter: (a: any, b: any) => a.failed - b.failed,
                  render: (count: number) =>
                    count > 0 ? (
                      <Text className="dashboard-metric-tone dashboard-metric-tone--error">{formatNumber(count)}</Text>
                    ) : (
                      <Text type="supporting" color="secondary">
                        —
                      </Text>
                    ),
                },
                {
                  title: 'Primary Failure Reason',
                  dataIndex: 'primaryFailure',
                  key: 'primaryFailure',
                  width: 280,
                  ellipsis: true,
                  render: (reason: string) => (
                    <Text type="supporting" color="secondary" maxLines={1}>
                      {reason}
                    </Text>
                  ),
                },
              ]}
            />
          ) : (
            <DashboardEmptyState message={noDataHint} />
          )}
        </Card>
      </section>

      {/* Response Time Distribution & Top Failures */}
      <section className="dashboard-tab-grid">
        <Card
          className={DASHBOARD_PANEL_CLASS}
          variant="borderless"
          title={
            <DashboardSectionTitle
              title="Response Time Distribution"
              subtitle={`Distribution of webhook response times (${timeLabel})`}
            />
          }
          styles={{ body: { padding: spacing[4] } }}
        >
          {performanceLoading ? (
            <DashboardLoadingState title="Loading outbound response times" />
          ) : responseTimeDistribution.length > 0 ? (
            <BarChart
              data={responseTimeDistribution}
              bars={[{ dataKey: 'count', name: 'Deliveries', color: themeColors.primary.default }]}
              xAxisKey="label"
              height={300}
              layout="horizontal"
              showLegend={false}
              yAxisTickFormatter={(value) => formatNumber(value)}
              hiddenLegends={hiddenLegends}
              onLegendClick={onLegendClick}
            />
          ) : (
            <DashboardEmptyState message={noDataHint} />
          )}
        </Card>

        <Card
          className={DASHBOARD_PANEL_CLASS}
          variant="borderless"
          title={
            <DashboardSectionTitle
              title="Top Failures Analysis"
              subtitle={`Error categories and affected integrations (${timeLabel})`}
            />
          }
          styles={{ body: { padding: spacing[4] } }}
        >
          {errorsLoading ? (
            <DashboardLoadingState title="Loading failure categories" />
          ) : failuresByCategory.length > 0 ? (
            <>
              <PieChart
                data={failuresByCategory}
                height={220}
                showLegend={false}
                innerRadius={50}
                outerRadius={80}
                label={true}
                paddingAngle={2}
                onSliceClick={(data) =>
                  onNavigate(`/logs?status=FAILED&errorCategory=${encodeURIComponent(data.name)}`)
                }
                hiddenLegends={hiddenLegends}
                onLegendClick={onLegendClick}
              />
              <div style={{ marginTop: spacing[3], maxHeight: 180, overflowY: 'auto' }}>
                <Text
                  type="label"
                  color="secondary"
                  weight="semibold"
                  display="block"
                  className="console-margin-bottom-2"
                >
                  Most Affected Integrations
                </Text>
                <List
                  size="small"
                  dataSource={affectedIntegrations}
                  renderItem={(integration: any) => (
                    <List.Item
                      style={{
                        padding: `${spacing[2]} 0`,
                        borderBlockEnd: `1px solid ${cssVar.border.default}`,
                        cursor: 'pointer',
                      }}
                      onClick={() => onNavigate(getIntegrationPath(integration))}
                    >
                      <Space className="console-width-full-between">
                        <Text weight="medium" maxLines={1} className="ui-extracted-888b85c032">
                          {integration.integrationName}
                        </Text>
                        <Text className="dashboard-metric-tone dashboard-metric-tone--error">
                          {formatNumber(integration.failed)} failures
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            </>
          ) : (
            <DashboardEmptyState message={noDataHint} />
          )}
        </Card>
      </section>
    </>
  );
};
