import { useMemo } from 'react';
import { Card, List, Segmented, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { BarChart, FunnelChart, FunnelData } from '../../../components/charts';
import { ModernTable } from '../../../components/common/ModernTable';
import { formatDateTime, formatNumber } from '../../../utils/format';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import {
  DashboardEmptyState,
  DashboardLoadingState,
  DashboardSectionTitle,
  getDashboardIntegrationRowKey,
  DASHBOARD_PANEL_CLASS,
} from './DashboardPrimitives';
import { Button } from '../../../components/common/LegacyButton';

interface DashboardDeliveriesTabProps {
  analyticsLoading: boolean;
  integrationPerformance: Array<any>;
  performanceTitle: string;
  performanceSubtitle: string;
  performanceEntityLabel: string;
  manageLabel: string;
  onManageAll: () => void;
  onCreateNew: () => void;
  onViewEventAudit: () => void;
  onNavigate: (path: string) => void;
  getIntegrationPath: (record: any) => string;
  noDataHint: string;
  timeLabel: string;
  performanceChartData: Array<any>;
  performanceChartMetric: 'percent' | 'count';
  setPerformanceChartMetric: (value: 'percent' | 'count') => void;
  performanceChartLayout: 'horizontal' | 'vertical';
  setPerformanceChartLayout: (value: 'horizontal' | 'vertical') => void;
  showEventAudit: boolean;
  eventAuditLoading: boolean;
  eventAuditStats: {
    totalReceived?: number;
    delivered?: number;
    skipped?: number;
    failed?: number;
    stuck?: number;
    skipReasons?: Record<string, number>;
    duplicateTypes?: Record<string, number>;
    bySource?: Record<string, number>;
  } | null;
  funnelData: FunnelData[];
  errorBreakdown?: Array<{
    __KEEP___KEEP_integrationConfig__Id__: string;
    __KEEP_integrationName__?: string | null;
    count: number;
    lastSeen?: string | null;
    category?: string | null;
    topErrorMessage?: string | null;
  }>;
  onPerformanceChartClick?: (data: any) => void;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardDeliveriesTab = ({
  analyticsLoading,
  integrationPerformance,
  performanceTitle,
  performanceSubtitle,
  performanceEntityLabel,
  manageLabel,
  onManageAll,
  onCreateNew,
  onViewEventAudit,
  onNavigate,
  getIntegrationPath,
  noDataHint,
  timeLabel,
  performanceChartData,
  performanceChartMetric,
  setPerformanceChartMetric,
  performanceChartLayout,
  setPerformanceChartLayout,
  showEventAudit,
  eventAuditLoading,
  eventAuditStats,
  funnelData,
  errorBreakdown = [],
  onPerformanceChartClick,
  hiddenLegends,
  onLegendClick,
}: DashboardDeliveriesTabProps) => {
  const { themeColors, spacing } = useDesignTokens();

  const performanceChartBars =
    performanceChartMetric === 'count'
      ? [
          { dataKey: 'successCount', name: 'Success', color: themeColors.success.text, stackId: 'a' },
          { dataKey: 'failedCount', name: 'Failed', color: themeColors.error.text, stackId: 'a' },
          { dataKey: 'skippedCount', name: 'Skipped', color: themeColors.warning.text, stackId: 'a' },
        ]
      : [
          { dataKey: 'successRate', name: 'Success %', color: themeColors.success.text, stackId: 'a' },
          { dataKey: 'failureRate', name: 'Failure %', color: themeColors.error.text, stackId: 'a' },
          { dataKey: 'skippedRate', name: 'Skipped %', color: themeColors.warning.text, stackId: 'a' },
        ];
  const formatMetric = (value: any) => (performanceChartMetric === 'percent' ? `${value}%` : `${value}`);

  const attentionItems = useMemo(() => {
    const errorByIntegration = new Map(
      errorBreakdown.map((item) => [String(item.__KEEP___KEEP_integrationConfig__Id__), item])
    );

    return integrationPerformance
      .map((integration: any) => {
        const integrationId = String(
          integration.__KEEP___KEEP_integrationConfig__Id__ || integration.integrationConfigId || integration.id || ''
        );
        const total = Number(integration.total || 0);
        const failed = Number(integration.failed || 0);
        const skipped = Number(integration.skipped || 0);
        const successRate = Number(integration.successRate || 0);
        const errorEntry = integrationId ? errorByIntegration.get(integrationId) : undefined;
        const failureRate = total > 0 ? (failed / total) * 100 : 0;
        const skipRate = total > 0 ? (skipped / total) * 100 : 0;
        const pressureScore =
          failed * 4 +
          skipped * 2 +
          Math.max(0, Math.round((95 - successRate) * 2)) +
          Math.round(failureRate) +
          Math.round(skipRate / 2);

        return {
          integrationId,
          name: integration.__KEEP_integrationName__ || integration.integrationName || integrationId || 'Unknown',
          failed,
          skipped,
          total,
          successRate,
          failureRate,
          lastSeen: errorEntry?.lastSeen || integration.lastSeen || null,
          primaryIssue:
            errorEntry?.category ||
            errorEntry?.topErrorMessage ||
            (skipped > failed ? 'High skip volume' : failed > 0 ? 'Delivery failures' : 'Degraded success rate'),
          pressureScore,
        };
      })
      .filter((item) => item.failed > 0 || item.skipped > 0 || item.successRate < 98)
      .sort((a, b) => {
        if (b.pressureScore !== a.pressureScore) return b.pressureScore - a.pressureScore;
        if (b.failed !== a.failed) return b.failed - a.failed;
        return b.total - a.total;
      })
      .slice(0, 6);
  }, [errorBreakdown, integrationPerformance]);

  const auditInsights = useMemo(() => {
    const totalReceived = Number(eventAuditStats?.totalReceived || 0);
    const skipped = Number(eventAuditStats?.skipped || 0);
    const failed = Number(eventAuditStats?.failed || 0);
    const stuck = Number(eventAuditStats?.stuck || 0);
    const skipReasons = Object.entries(eventAuditStats?.skipReasons || {}).sort(
      ([, a], [, b]) => Number(b) - Number(a)
    );
    const duplicateTypes = Object.entries(eventAuditStats?.duplicateTypes || {}).sort(
      ([, a], [, b]) => Number(b) - Number(a)
    );
    const sources = Object.entries(eventAuditStats?.bySource || {}).sort(([, a], [, b]) => Number(b) - Number(a));
    const duplicateCount = Number(
      (eventAuditStats?.skipReasons && eventAuditStats.skipReasons.DUPLICATE) ||
        duplicateTypes.reduce((sum, [, count]) => sum + Number(count || 0), 0)
    );

    return {
      totalReceived,
      skipped,
      failed,
      stuck,
      skipRate: totalReceived > 0 ? (skipped / totalReceived) * 100 : 0,
      duplicateRate: totalReceived > 0 ? (duplicateCount / totalReceived) * 100 : 0,
      topSkipReasons: skipReasons.slice(0, 4),
      topDuplicateTypes: duplicateTypes.slice(0, 4),
      topSources: sources.slice(0, 3),
      topSkipReason: skipReasons[0] || null,
      topSource: sources[0] || null,
    };
  }, [eventAuditStats]);

  return (
    <>
      <section className={`${DASHBOARD_PANEL_CLASS} console-margin-top-4`}>
        <Card
          title={<DashboardSectionTitle title={performanceTitle} subtitle={performanceSubtitle} />}
          extra={
            <Button type="text" size="small" onClick={onManageAll}>
              {manageLabel}
            </Button>
          }
          styles={{ body: { padding: 'var(--spacing-0)' } }}
          variant="borderless"
        >
          {analyticsLoading ? (
            <DashboardLoadingState title="Loading delivery performance" />
          ) : integrationPerformance && integrationPerformance.length > 0 ? (
            <ModernTable<any>
              size="middle"
              dataSource={integrationPerformance}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 25,
                showSizeChanger: true,
                pageSizeOptions: ['10', '25', '50', '100'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} integrations`,
                position: ['bottomCenter'],
              }}
              rowKey={getDashboardIntegrationRowKey}
              columns={[
                {
                  title: performanceEntityLabel,
                  dataIndex: '__KEEP_integrationName__',
                  key: '__KEEP_integrationName__',
                  width: 300,
                  ellipsis: true,
                  sorter: (a: any, b: any) => a.__KEEP_integrationName__.localeCompare(b.__KEEP_integrationName__),
                  render: (name: string, record: any) => (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => onNavigate(getIntegrationPath(record))}
                      style={{
                        color: cssVar.accent.text,
                        fontWeight: 600,
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {name || 'Unknown'}
                    </Button>
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
                    <Text weight="semibold" color="primary" hasTabularNumbers>
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
                  sorter: (a: any, b: any) => parseFloat(a.successRate) - parseFloat(b.successRate),
                  render: (rate: number) => <Text hasTabularNumbers>{rate}%</Text>,
                },
                {
                  title: 'Avg Latency',
                  dataIndex: 'avgResponseTime',
                  key: 'avgResponseTime',
                  align: 'right',
                  width: 140,
                  sorter: (a: any, b: any) => a.avgResponseTime - b.avgResponseTime,
                  render: (latency: number) => (
                    <Text type="code" color="primary" hasTabularNumbers>
                      {latency} ms
                    </Text>
                  ),
                },
                {
                  title: 'Successful',
                  dataIndex: 'successful',
                  key: 'successful',
                  align: 'right',
                  width: 130,
                  sorter: (a: any, b: any) => a.successful - b.successful,
                  render: (count: number) => <Text hasTabularNumbers>{formatNumber(count)}</Text>,
                },
                {
                  title: 'Failed',
                  dataIndex: 'failed',
                  key: 'failed',
                  align: 'right',
                  width: 120,
                  sorter: (a: any, b: any) => a.failed - b.failed,
                  resizable: false,
                  render: (count: number) =>
                    count > 0 ? (
                      <Text style={{ color: themeColors.error.text }} hasTabularNumbers>
                        {formatNumber(count)}
                      </Text>
                    ) : (
                      <Text color="secondary">—</Text>
                    ),
                },
                {
                  title: 'Skipped',
                  dataIndex: 'skipped',
                  key: 'skipped',
                  align: 'right',
                  width: 120,
                  sorter: (a: any, b: any) => a.skipped - b.skipped,
                  render: (count: number) =>
                    count > 0 ? <Text hasTabularNumbers>{formatNumber(count)}</Text> : <Text color="secondary">—</Text>,
                },
              ]}
            />
          ) : (
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
              <GatewayIcon name="WarningOutlined" className="console-empty-state-icon" />
              <Text color="secondary">No activity in the selected period</Text>
              <Button type="primary" onClick={onCreateNew}>
                Create {performanceEntityLabel}
              </Button>
            </div>
          )}
        </Card>
      </section>

      <section className="dashboard-tab-grid">
        <Card
          className={DASHBOARD_PANEL_CLASS}
          variant="borderless"
          title={
            <DashboardSectionTitle
              title={`Success vs Failures (${timeLabel})`}
              subtitle={`Per ${performanceEntityLabel.toLowerCase()} delivery mix`}
            />
          }
          extra={
            <Space size={spacingToNumber(spacing[1])}>
              <Segmented
                size="small"
                value={performanceChartMetric}
                onChange={(value) => setPerformanceChartMetric(value as 'percent' | 'count')}
                options={[
                  { label: '% Rate', value: 'percent' },
                  { label: 'Count', value: 'count' },
                ]}
              />
              <Segmented
                size="small"
                value={performanceChartLayout}
                onChange={(value) => setPerformanceChartLayout(value as 'horizontal' | 'vertical')}
                options={[
                  { label: <GatewayIcon name="BarChartOutlined" />, value: 'horizontal' },
                  { label: <GatewayIcon name="LineChartOutlined" />, value: 'vertical' },
                ]}
              />
            </Space>
          }
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <DashboardLoadingState title="Loading integration performance" />
          ) : performanceChartData.length > 0 ? (
            <BarChart
              data={performanceChartData}
              bars={performanceChartBars}
              xAxisKey="nameShort"
              height={320}
              showLegend={true}
              layout={performanceChartLayout}
              barSize={performanceChartLayout === 'vertical' ? 18 : 24}
              wrapAxisLabels={true}
              axisLabelMaxWidth={110}
              axisLabelMaxLines={2}
              yAxisTickFormatter={performanceChartLayout === 'horizontal' ? formatMetric : undefined}
              xAxisTickFormatter={performanceChartLayout === 'vertical' ? formatMetric : undefined}
              onBarClick={onPerformanceChartClick}
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
              title="Needs Attention"
              subtitle="Integrations most likely to require operator action"
            />
          }
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <DashboardLoadingState title="Loading attention items" />
          ) : attentionItems.length > 0 ? (
            <List
              rowKey="integrationId"
              dataSource={attentionItems}
              renderItem={(item) => (
                <List.Item
                  style={{ padding: `${spacing[3]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}
                  actions={[
                    <Button
                      key="logs"
                      type="text"
                      size="small"
                      onClick={() =>
                        onNavigate(`/logs?integrationId=${encodeURIComponent(item.integrationId)}&status=FAILED`)
                      }
                    >
                      Open Logs
                    </Button>,
                  ]}
                >
                  <Space direction="vertical" size={spacingToNumber(spacing[1])} className="console-width-full">
                    <Space
                      style={{
                        width: '100%',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: spacing[2],
                      }}
                    >
                      <Button
                        type="link"
                        size="small"
                        onClick={() =>
                          onNavigate(
                            getIntegrationPath({
                              __KEEP___KEEP_integrationConfig__Id__: item.integrationId,
                              __KEEP_integrationName__: item.name,
                            })
                          )
                        }
                        style={{ color: cssVar.accent.text, fontWeight: 600 }}
                      >
                        {item.name}
                      </Button>
                      <Text
                        color={item.failed > 0 ? 'primary' : 'secondary'}
                        style={{ whiteSpace: 'nowrap', ...(item.failed > 0 ? { color: themeColors.error.text } : {}) }}
                        hasTabularNumbers
                      >
                        {item.failed > 0
                          ? `${formatNumber(item.failed)} failed`
                          : `${formatNumber(item.skipped)} skipped`}
                      </Text>
                    </Space>
                    <Text type="supporting" color="secondary">
                      {item.primaryIssue}
                    </Text>
                    <Space size={spacingToNumber(spacing[1])} wrap>
                      <Text type="supporting" color="secondary" hasTabularNumbers>
                        {item.failureRate.toFixed(1)}% failure rate
                      </Text>
                      <Text type="supporting" color="secondary" hasTabularNumbers>
                        {item.successRate.toFixed(1)}% success
                      </Text>
                      {item.lastSeen ? (
                        <Text type="supporting" color="secondary">
                          Last activity {formatDateTime(item.lastSeen)}
                        </Text>
                      ) : null}
                    </Space>
                  </Space>
                </List.Item>
              )}
            />
          ) : (
            <DashboardEmptyState message={noDataHint} />
          )}
        </Card>
      </section>

      {showEventAudit && (
        <section className="dashboard-tab-grid">
          <Card
            className={DASHBOARD_PANEL_CLASS}
            variant="borderless"
            title={
              <DashboardSectionTitle
                title="Skip & Duplicate Intelligence"
                subtitle="Why events are being ignored, dropped, or replayed"
              />
            }
            extra={
              <Button type="text" size="small" onClick={onViewEventAudit}>
                View Event Audit
              </Button>
            }
            styles={{ body: { padding: spacing[4] } }}
          >
            {eventAuditLoading ? (
              <DashboardLoadingState title="Loading event audit" />
            ) : auditInsights.totalReceived > 0 ? (
              <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
                <div className="dashboard-stat-row">
                  <Text color="secondary">Skip rate</Text>
                  <Text weight="semibold" hasTabularNumbers>
                    {auditInsights.skipRate.toFixed(1)}%
                  </Text>
                </div>
                <div className="dashboard-stat-row">
                  <Text color="secondary">Duplicate rate</Text>
                  <Text weight="semibold" hasTabularNumbers>
                    {auditInsights.duplicateRate.toFixed(1)}%
                  </Text>
                </div>
                <div className="dashboard-stat-row">
                  <Text color="secondary">Top skip reason</Text>
                  <Text weight="semibold">{auditInsights.topSkipReason?.[0] || '—'}</Text>
                </div>
                <div className="dashboard-stat-row">
                  <Text color="secondary">Noisiest source</Text>
                  <Text weight="semibold">{auditInsights.topSource?.[0] || '—'}</Text>
                </div>

                {auditInsights.topSkipReasons.length > 0 && (
                  <div>
                    <Text
                      as="div"
                      display="block"
                      type="supporting"
                      color="secondary"
                      className="console-margin-bottom-2"
                    >
                      Top skip reasons
                    </Text>
                    <Space direction="vertical" size={spacingToNumber(spacing[1])}>
                      {auditInsights.topSkipReasons.map(([reason, count]) => (
                        <Text key={reason} type="supporting" color="secondary" hasTabularNumbers>
                          {reason}: {formatNumber(count)}
                        </Text>
                      ))}
                    </Space>
                  </div>
                )}

                {auditInsights.topDuplicateTypes.length > 0 && (
                  <div>
                    <Text
                      as="div"
                      display="block"
                      type="supporting"
                      color="secondary"
                      className="console-margin-bottom-2"
                    >
                      Duplicate types
                    </Text>
                    <Space direction="vertical" size={spacingToNumber(spacing[1])}>
                      {auditInsights.topDuplicateTypes.map(([reason, count]) => (
                        <Text key={reason} type="supporting" color="secondary" hasTabularNumbers>
                          {reason || 'Unknown'}: {formatNumber(count)}
                        </Text>
                      ))}
                    </Space>
                  </div>
                )}

                {auditInsights.topSources.length > 0 && (
                  <div>
                    <Text
                      as="div"
                      display="block"
                      type="supporting"
                      color="secondary"
                      className="console-margin-bottom-2"
                    >
                      Busiest sources
                    </Text>
                    <List
                      size="small"
                      rowKey={(item) => item[0]}
                      dataSource={auditInsights.topSources}
                      renderItem={([source, count]) => (
                        <List.Item
                          style={{ padding: `${spacing[2]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}
                        >
                          <Space className="console-width-full-between">
                            <Text type="supporting">{source || 'Unknown source'}</Text>
                            <Text type="supporting" color="secondary" hasTabularNumbers>
                              {formatNumber(count)}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </div>
                )}
              </Space>
            ) : (
              <DashboardEmptyState message={noDataHint} />
            )}
          </Card>

          {funnelData.length > 0 && (
            <Card
              className={DASHBOARD_PANEL_CLASS}
              variant="borderless"
              title={
                <DashboardSectionTitle
                  title={`Event Flow (${timeLabel})`}
                  subtitle="Conversion funnel from received to delivered"
                />
              }
              styles={{ body: { padding: spacing[4] } }}
            >
              {eventAuditLoading ? (
                <DashboardLoadingState title="Loading event flow" />
              ) : (
                <FunnelChart data={funnelData} height={300} showPercentages={true} onSegmentClick={onViewEventAudit} />
              )}
            </Card>
          )}
        </section>
      )}
    </>
  );
};
