import { useMemo } from 'react';
import { Card, List, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { BarChart, ComposedChart, LineChart } from '../../../components/charts';
import { ModernTable } from '../../../components/common/ModernTable';
import { Button } from '../../../components/common/LegacyButton';
import { CountdownTo } from '../../../components/common/RefreshCountdown';
import { formatNumber, formatDateTime, formatDuration } from '../../../utils/format';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import {
  DashboardEmptyState,
  DashboardLoadingState,
  DashboardSectionTitle,
  DashboardMetricTile,
  getDashboardIntegrationRowKey,
  getDashboardRateTone,
  DASHBOARD_PANEL_CLASS,
} from './DashboardPrimitives';

interface DashboardScheduledTabProps {
  days: number;
  timeLabel: string;
  analyticsLoading: boolean;
  errorsLoading: boolean;
  analytics: any;
  timeseriesDaily: any;
  performanceAnalytics: any;
  errorAnalytics: any;
  integrationPerformance: Array<any>;
  scheduledJobs?: Array<any>;
  scheduledJobLogs?: Array<any>;
  onNavigate: (path: string) => void;
  getIntegrationPath: (record: any) => string;
  noDataHint: string;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardScheduledTab = ({
  days,
  timeLabel,
  analyticsLoading,
  errorsLoading,
  analytics,
  timeseriesDaily,
  performanceAnalytics,
  errorAnalytics,
  integrationPerformance,
  scheduledJobs = [],
  scheduledJobLogs = [],
  onNavigate,
  getIntegrationPath,
  noDataHint,
  hiddenLegends,
  onLegendClick,
}: DashboardScheduledTabProps) => {
  const { themeColors, spacing, token } = useDesignTokens();
  // Next Scheduled Run Countdown
  const nextScheduledRun = useMemo(() => {
    const activeJobs = scheduledJobs.filter((job: any) => job.isActive && job.nextRunTime);
    if (activeJobs.length === 0) return null;

    const nextJob = activeJobs.sort(
      (a: any, b: any) => new Date(a.nextRunTime).getTime() - new Date(b.nextRunTime).getTime()
    )[0];

    // The ticking countdown itself lives in <CountdownTo>, which re-renders
    // only itself — keeping the clock out of this tab's render path.
    const ms = new Date(nextJob.nextRunTime).getTime() - Date.now();

    return { job: nextJob, ms };
  }, [scheduledJobs]);

  // KPI Metrics
  const kpiMetrics = useMemo(() => {
    const summary = analytics?.summary || {};
    const performance = analytics?.performance || {};
    const performanceMetrics = performanceAnalytics?.metrics || {};
    const total = summary.total || 0;
    const successful = summary.successful || 0;
    const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0';
    const avgDuration = performance.avgResponseTime || 0;
    const p95Duration = performanceMetrics.p95ResponseTime || 0;

    return [
      {
        label: 'Total Executions',
        value: formatNumber(total),
        delta: timeLabel,
        icon: <GatewayIcon name="DashboardOutlined" />,
        tone: themeColors.primary.default,
        onClick: () => onNavigate('/logs?triggerType=SCHEDULED'),
      },
      {
        label: 'Execution Success Rate',
        value: `${successRate}%`,
        delta: `${formatNumber(successful)} successful`,
        icon: <GatewayIcon name="CheckCircleOutlined" />,
        // total === 0 means no scheduled jobs have run yet — a neutral "no data"
        // state, not a failure; must not read as red the way a real 0% success
        // rate out of real executions would.
        tone:
          total === 0
            ? themeColors.text.muted
            : parseFloat(successRate) >= 95
              ? themeColors.success.text
              : parseFloat(successRate) >= 85
                ? themeColors.warning.text
                : themeColors.error.text,
        onClick: () => onNavigate('/logs?triggerType=SCHEDULED&status=SUCCESS'),
      },
      {
        label: 'Avg Execution Duration',
        value: formatDuration(avgDuration),
        delta: `P95: ${formatDuration(p95Duration)}`,
        icon: <GatewayIcon name="ClockCircleOutlined" />,
        tone: themeColors.info.text,
      },
      {
        label: 'Next Scheduled Run',
        value: <CountdownTo target={nextScheduledRun?.job?.nextRunTime} />,
        delta: nextScheduledRun?.job?.name || 'No active jobs',
        icon: <GatewayIcon name="WarningOutlined" />,
        tone:
          nextScheduledRun?.ms && nextScheduledRun.ms < 5 * 60 * 1000
            ? themeColors.warning.text
            : themeColors.success.text,
      },
    ];
  }, [analytics, performanceAnalytics, themeColors, timeLabel, nextScheduledRun, onNavigate]);

  // Job Health Table Data
  const jobHealthData = useMemo(() => {
    return integrationPerformance
      .map((job: any) => {
        const successRate = parseFloat(job.successRate) || 0;
        const jobDetails = scheduledJobs.find((j: any) => j.id === job.__KEEP___KEEP_integrationConfig__Id__);

        // Determine health status
        let health: { status: string; color: string } = { status: 'Healthy', color: themeColors.success.text };
        if (successRate < 85) {
          health = { status: 'Unhealthy', color: themeColors.error.text };
        } else if (successRate < 95) {
          health = { status: 'Degraded', color: themeColors.warning.text };
        }

        // Check if execution is delayed
        if (jobDetails?.nextRunTime) {
          const nextRun = new Date(jobDetails.nextRunTime).getTime();
          const now = Date.now();
          if (nextRun < now - 60 * 60 * 1000) {
            // More than 1 hour overdue
            health = { status: 'Delayed', color: themeColors.error.text };
          }
        }

        return {
          ...job,
          schedule:
            jobDetails?.schedule?.expression || jobDetails?.schedule?.intervalMs
              ? jobDetails.schedule.expression || `Every ${formatDuration(jobDetails.schedule.intervalMs)}`
              : '—',
          lastRun: jobDetails?.lastExecution?.startedAt || job.lastSuccessful || job.lastFailed || null,
          nextRun: jobDetails?.nextRunTime || null,
          health,
          recordsProcessed: jobDetails?.lastExecution?.recordsFetched || 0,
        };
      })
      .sort((a, b) => a.health.status.localeCompare(b.health.status) || b.total - a.total);
  }, [integrationPerformance, scheduledJobs, themeColors]);

  const durationTrendData = useMemo(() => {
    const dailyData = timeseriesDaily?.data || [];
    return dailyData.map((point: any) => {
      return {
        date: point.timestamp
          ? new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'Unknown',
        avgResponseTime: point.avgResponseTime || 0,
      };
    });
  }, [timeseriesDaily]);

  // Execution Reliability Chart Data
  const reliabilityChartData = useMemo(() => {
    const dailyData = timeseriesDaily?.data || [];
    return dailyData.map((point: any) => {
      const total = point.total || 0;
      const successful = point.successful || 0;
      const failed = point.failed || 0;
      const successRate = total > 0 ? (successful / total) * 100 : 0;

      return {
        date: point.timestamp
          ? new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'Unknown',
        successful,
        failed,
        successRate,
      };
    });
  }, [timeseriesDaily]);

  // Failure Analysis
  const failureAnalysis = useMemo(() => {
    const topErrors = errorAnalytics?.topErrors || [];
    const failedJobs = integrationPerformance.filter((job: any) => job.failed > 0);
    const retriedExecutions = scheduledJobLogs.filter((log: any) => Number(log.attemptCount || 0) > 1).length;

    return {
      topFailureReasons: topErrors.slice(0, 5),
      retriedErrors: retriedExecutions,
      failedJobsCount: failedJobs.length,
    };
  }, [errorAnalytics, integrationPerformance, scheduledJobLogs]);

  // Records Processed Trend
  const recordsProcessedTrend = useMemo(() => {
    // Group logs by date and job
    const groupedByDate: Record<string, Record<string, number>> = {};

    scheduledJobLogs.forEach((log: any) => {
      const date = new Date(log.startedAt || log.createdAt).toISOString().split('T')[0];
      const jobName =
        log.__KEEP_integrationName__ || log.integrationName || log.__KEEP___KEEP_integrationConfig__Id__ || 'Unknown';
      const records = log.recordsFetched || 0;

      if (!groupedByDate[date]) groupedByDate[date] = {};
      groupedByDate[date][jobName] = (groupedByDate[date][jobName] || 0) + records;
    });

    // Convert to chart format
    const chartData = Object.entries(groupedByDate)
      .map(([date, jobs]) => {
        const dataPoint: any = { date };
        let total = 0;
        Object.entries(jobs).forEach(([jobName, count]) => {
          dataPoint[jobName] = count;
          total += count as number;
        });
        dataPoint.total = total;
        return dataPoint;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return chartData;
  }, [scheduledJobLogs]);

  // Data Source Performance (from execution logs)
  const dataSourcePerformance = useMemo(() => {
    // Group by integration to calculate data source metrics
    const grouped: Record<string, { queryTimes: number[]; timeouts: number; totalRecords: number; count: number }> = {};

    scheduledJobLogs.forEach((log: any) => {
      const integrationId = log.__KEEP___KEEP_integrationConfig__Id__ || log.integrationConfigId || 'unknown';
      if (!grouped[integrationId]) {
        grouped[integrationId] = { queryTimes: [], timeouts: 0, totalRecords: 0, count: 0 };
      }

      const duration = log.durationMs || log.responseTimeMs || 0;
      grouped[integrationId].queryTimes.push(duration);
      grouped[integrationId].totalRecords += log.recordsFetched || 0;
      grouped[integrationId].count += 1;

      if (log.status === 'FAILED' && log.errorMessage?.toLowerCase().includes('timeout')) {
        grouped[integrationId].timeouts += 1;
      }
    });

    return Object.entries(grouped)
      .map(([integrationId, stats]) => {
        const integration = integrationPerformance.find(
          (j: any) => j.__KEEP___KEEP_integrationConfig__Id__ === integrationId
        );

        const avgQueryTime =
          stats.queryTimes.length > 0 ? stats.queryTimes.reduce((a, b) => a + b, 0) / stats.queryTimes.length : 0;
        const maxQueryTime = stats.queryTimes.length > 0 ? Math.max(...stats.queryTimes) : 0;
        const timeoutRate = stats.count > 0 ? (stats.timeouts / stats.count) * 100 : 0;

        return {
          dataSource: integration?.__KEEP_integrationName__ || integrationId || 'Unknown',
          avgQueryTime: Math.round(avgQueryTime),
          maxQueryTime: Math.round(maxQueryTime),
          timeoutRate: timeoutRate.toFixed(1),
          totalRecords: stats.totalRecords,
        };
      })
      .sort((a, b) => b.totalRecords - a.totalRecords)
      .slice(0, 10);
  }, [scheduledJobLogs, integrationPerformance]);

  return (
    <>
      {/* Real-Time Health Status KPI Cards */}
      <section className="dashboard-overview console-margin-top-4">
        {analyticsLoading ? (
          <DashboardLoadingState title="Loading scheduled job health" />
        ) : (
          <div className="dashboard-kpis">
            {kpiMetrics.map((metric) => (
              <DashboardMetricTile key={metric.label} {...metric} />
            ))}
          </div>
        )}
      </section>

      {/* Job Performance Metrics - Job Health Table */}
      <section className={`${DASHBOARD_PANEL_CLASS} console-margin-top-4`}>
        <Card
          title={
            <DashboardSectionTitle
              title="Job Health Status"
              subtitle="Health and performance metrics for scheduled jobs"
            />
          }
          styles={{ body: { padding: 'var(--spacing-0)' } }}
          variant="borderless"
        >
          {analyticsLoading ? (
            <DashboardLoadingState title="Loading job health" />
          ) : jobHealthData.length > 0 ? (
            <ModernTable<any>
              size="middle"
              tableLayout="fixed"
              scroll={{ x: '100%' }}
              dataSource={jobHealthData}
              enableResize={true}
              stickyHeader={false}
              pagination={{
                pageSize: 15,
                showSizeChanger: true,
                pageSizeOptions: ['10', '15', '25', '50'],
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} jobs`,
                position: ['bottomCenter'],
              }}
              rowKey={getDashboardIntegrationRowKey}
              columns={[
                {
                  title: 'Job Name',
                  dataIndex: '__KEEP_integrationName__',
                  key: '__KEEP_integrationName__',
                  width: 200,
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
                  title: 'Schedule',
                  dataIndex: 'schedule',
                  key: 'schedule',
                  width: 150,
                  ellipsis: true,
                  render: (schedule: string) => (
                    <Text type="code" color="secondary">
                      {schedule}
                    </Text>
                  ),
                },
                {
                  title: 'Last Run',
                  dataIndex: 'lastRun',
                  key: 'lastRun',
                  width: 125,
                  render: (timestamp: string | null) =>
                    timestamp ? (
                      <Text type="supporting" color="secondary">
                        {formatDateTime(timestamp)}
                      </Text>
                    ) : (
                      <Text color="secondary">—</Text>
                    ),
                },
                {
                  title: 'Next Run',
                  dataIndex: 'nextRun',
                  key: 'nextRun',
                  width: 125,
                  render: (timestamp: string | null) =>
                    timestamp ? (
                      <Text type="supporting">{formatDateTime(timestamp)}</Text>
                    ) : (
                      <Text color="secondary">—</Text>
                    ),
                },
                {
                  title: 'Success Rate',
                  dataIndex: 'successRate',
                  key: 'successRate',
                  align: 'right',
                  width: 110,
                  sorter: (a: any, b: any) => parseFloat(a.successRate) - parseFloat(b.successRate),
                  render: (rate: string) => {
                    const numRate = parseFloat(rate);
                    return (
                      <Text
                        className={`dashboard-metric-tone dashboard-metric-tone--${getDashboardRateTone(numRate)}`}
                        hasTabularNumbers
                      >
                        {rate}%
                      </Text>
                    );
                  },
                },
                {
                  title: 'Avg Duration',
                  dataIndex: 'avgResponseTime',
                  key: 'avgResponseTime',
                  align: 'right',
                  width: 110,
                  sorter: (a: any, b: any) => a.avgResponseTime - b.avgResponseTime,
                  render: (duration: number) => (
                    <Text type="code" hasTabularNumbers>
                      {formatDuration(duration)}
                    </Text>
                  ),
                },
                {
                  title: 'Records Processed',
                  dataIndex: 'recordsProcessed',
                  key: 'recordsProcessed',
                  align: 'right',
                  width: 130,
                  sorter: (a: any, b: any) => a.recordsProcessed - b.recordsProcessed,
                  render: (count: number) => <Text hasTabularNumbers>{count > 0 ? formatNumber(count) : '—'}</Text>,
                },
                {
                  title: 'Status',
                  dataIndex: 'health',
                  key: 'health',
                  align: 'center',
                  width: 100,
                  sorter: (a: any, b: any) => a.health.status.localeCompare(b.health.status),
                  render: (health: any) => (
                    <Text className={`dashboard-metric-tone dashboard-metric-tone--${health.status.toLowerCase()}`}>
                      {health.status}
                    </Text>
                  ),
                },
              ]}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: `${spacing[9]} 0` }}>
              <GatewayIcon name="WarningOutlined" className="console-empty-state-icon" />
              <Text as="div" display="block" type="supporting" color="secondary" className="console-margin-top-2">
                {noDataHint}
              </Text>
            </div>
          )}
        </Card>
      </section>

      {/* Execution Duration Trend */}
      <section className={`${DASHBOARD_PANEL_CLASS} console-margin-top-4`}>
        <Card
          variant="borderless"
          title={
            <DashboardSectionTitle
              title="Execution Duration Trend"
              subtitle={`Average job execution times over time (${timeLabel})`}
            />
          }
          styles={{ body: { padding: spacing[5] } }}
        >
          {analyticsLoading ? (
            <DashboardLoadingState title="Loading run duration" />
          ) : durationTrendData.length > 0 ? (
            <LineChart
              data={durationTrendData}
              lines={[
                { dataKey: 'avgResponseTime', name: 'Avg Duration (ms)', color: themeColors.info.text, strokeWidth: 2 },
              ]}
              xAxisKey="date"
              height={260}
              showLegend={true}
              smooth={true}
            />
          ) : (
            <DashboardEmptyState message={noDataHint} />
          )}
        </Card>
      </section>

      {/* Reliability Tracking */}
      <section className="dashboard-tab-grid">
        <Card
          className={DASHBOARD_PANEL_CLASS}
          variant="borderless"
          title={
            <DashboardSectionTitle
              title="Execution Reliability"
              subtitle={`Success vs failure by day (${timeLabel})`}
            />
          }
          styles={{ body: { padding: spacing[4] } }}
        >
          {analyticsLoading ? (
            <DashboardLoadingState title="Loading job reliability" />
          ) : reliabilityChartData.length > 0 ? (
            <ComposedChart
              data={reliabilityChartData}
              bars={[
                { dataKey: 'successful', name: 'Successful', color: themeColors.success.text, stackId: 'a' },
                { dataKey: 'failed', name: 'Failed', color: themeColors.error.text, stackId: 'a' },
              ]}
              lines={[
                { dataKey: 'successRate', name: 'Success Rate %', color: themeColors.primary.default, strokeWidth: 2 },
              ]}
              xAxisKey="date"
              height={300}
              showLegend={true}
              barSize={24}
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
          title={<DashboardSectionTitle title="Failure Analysis" subtitle="Error patterns and retry metrics" />}
          styles={{ body: { padding: spacing[4] } }}
        >
          {errorsLoading ? (
            <DashboardLoadingState title="Loading job failures" />
          ) : (
            <>
              <Space
                direction="vertical"
                size={spacingToNumber(spacing[3])}
                style={{ width: '100%', marginBottom: spacing[4] }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: `${spacing[3]} ${spacing[4]}`,
                    background: token.colorBgTextHover,
                    borderRadius: token.borderRadius,
                  }}
                >
                  <Text color="secondary">Failed Jobs</Text>
                  <Text type="large" weight="semibold" hasTabularNumbers style={{ color: themeColors.error.text }}>
                    {failureAnalysis.failedJobsCount}
                  </Text>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: `${spacing[3]} ${spacing[4]}`,
                    background: token.colorBgTextHover,
                    borderRadius: token.borderRadius,
                  }}
                >
                  <Text color="secondary">Retry Attempts</Text>
                  <Text type="large" weight="semibold" hasTabularNumbers style={{ color: themeColors.warning.text }}>
                    {failureAnalysis.retriedErrors}
                  </Text>
                </div>
              </Space>

              {failureAnalysis.topFailureReasons.length > 0 && (
                <div>
                  <Text
                    as="div"
                    type="supporting"
                    color="secondary"
                    weight="semibold"
                    className="console-margin-bottom-2"
                  >
                    Top Failure Reasons
                  </Text>
                  <List
                    size="small"
                    dataSource={failureAnalysis.topFailureReasons}
                    renderItem={(error: any) => (
                      <List.Item
                        style={{ padding: `${spacing[2]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}
                      >
                        <Space className="console-width-full-between">
                          <Text type="supporting" maxLines={1} className="ui-extracted-0ace823dbe">
                            {error.category || error.message}
                          </Text>
                          <Text type="supporting" color="secondary" hasTabularNumbers>
                            {formatNumber(error.count)}
                          </Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      </section>

      {/* Data Processing Metrics */}
      {recordsProcessedTrend.length > 0 && (
        <section className="dashboard-tab-grid">
          <Card
            className={DASHBOARD_PANEL_CLASS}
            variant="borderless"
            title={
              <DashboardSectionTitle
                title="Records Processed"
                subtitle={`Total records fetched per day (${timeLabel})`}
              />
            }
            styles={{ body: { padding: spacing[5] } }}
          >
            {analyticsLoading ? (
              <DashboardLoadingState title="Loading processed records" />
            ) : (
              <BarChart
                data={recordsProcessedTrend}
                bars={[{ dataKey: 'total', name: 'Records', color: themeColors.primary.default }]}
                xAxisKey="date"
                height={280}
                showLegend={false}
                barSize={24}
                yAxisTickFormatter={(value) => formatNumber(value)}
                hiddenLegends={hiddenLegends}
                onLegendClick={onLegendClick}
              />
            )}
          </Card>

          <Card
            className={DASHBOARD_PANEL_CLASS}
            variant="borderless"
            title={<DashboardSectionTitle title="Data Source Performance" subtitle="Query times and timeout rates" />}
            styles={{ body: { padding: 'var(--spacing-0)' } }}
          >
            {analyticsLoading ? (
              <div style={{ padding: spacing[4] }}>
                <DashboardLoadingState title="Loading data-source performance" />
              </div>
            ) : dataSourcePerformance.length > 0 ? (
              <ModernTable<any>
                size="small"
                dataSource={dataSourcePerformance}
                enableResize={false}
                stickyHeader={false}
                pagination={false}
                rowKey="dataSource"
                columns={[
                  {
                    title: 'Data Source',
                    dataIndex: 'dataSource',
                    key: 'dataSource',
                    width: 180,
                    ellipsis: true,
                    render: (name: string) => <Text weight="medium">{name}</Text>,
                  },
                  {
                    title: 'Avg Query Time',
                    dataIndex: 'avgQueryTime',
                    key: 'avgQueryTime',
                    align: 'right',
                    width: 140,
                    render: (time: number) => <Text type="code">{formatDuration(time)}</Text>,
                  },
                  {
                    title: 'Max Query Time',
                    dataIndex: 'maxQueryTime',
                    key: 'maxQueryTime',
                    align: 'right',
                    width: 140,
                    render: (time: number) => (
                      <Text type="code" color="secondary">
                        {formatDuration(time)}
                      </Text>
                    ),
                  },
                  {
                    title: 'Timeout Rate',
                    dataIndex: 'timeoutRate',
                    key: 'timeoutRate',
                    align: 'right',
                    width: 120,
                    render: (rate: string) => {
                      const numRate = parseFloat(rate);
                      return numRate > 0 ? (
                        <Text className="dashboard-metric-tone dashboard-metric-tone--error" hasTabularNumbers>
                          {rate}%
                        </Text>
                      ) : (
                        <Text type="supporting" color="secondary">
                          0%
                        </Text>
                      );
                    },
                  },
                  {
                    title: 'Total Records',
                    dataIndex: 'totalRecords',
                    key: 'totalRecords',
                    align: 'right',
                    width: 130,
                    render: (count: number) => (
                      <Text weight="semibold" hasTabularNumbers>
                        {formatNumber(count)}
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
      )}
    </>
  );
};
