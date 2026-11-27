import { useEffect, useMemo, useState, type Key } from 'react';
import {
  App,
  Card,
  Divider,
  Dropdown,
  Grid,
  Input,
  Select,
  Space,
  Switch,
} from '@/components/common/LegacyAntdControls';
import { Tab, TabList } from '@astryxdesign/core';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { ModernTable } from '../../../components/common/ModernTable';
import { RefreshCountdown } from '../../../components/common/RefreshCountdown';
import {
  clearSystemLogs,
  exportSystemLogsToCsv,
  exportSystemLogsToJson,
  getSystemLogs,
  getSystemProcessLogTail,
  type ProcessLogTailResponse,
  type SystemLog,
} from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { createExportProgress } from '../../../utils/export-progress';
import { cssVar, spacingToNumber, useDesignTokens } from '../../../design-system/utils';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';
import { Button } from '../../../components/common/LegacyButton';
import { StatusBadge, type StatusBadgeVariant } from '../../../components/common/StatusBadge';
import { InlineHint } from '../../../components/common/InlineHint';
import { StatePanel } from '../../../components/common/StatePanel';
import { Metric, MetricStrip } from '../../../design-system/primitives';

type LogRecord = SystemLog & {
  meta?: Record<string, any>;
  errorCategory?: string | null;
  stream?: 'app' | 'access' | string;
};

type PollGroupRow = {
  pollId: string;
  logs: LogRecord[];
  firstTimestamp: string;
  lastTimestamp: string;
  hasError: boolean;
  hasWarn: boolean;
  eventsProcessed?: number;
  retriesProcessed?: number;
};

type ActiveTab = 'app' | 'access' | 'process';

type ProcessLogLine = {
  lineNumber: number;
  text: string;
};

const extractPollId = (message?: string): string | null => {
  if (!message) return null;
  const match = message.match(/\[POLL\s*#(\d+)\]/i);
  return match ? match[1] : null;
};

const formatDuration = (start: string, end: string) => {
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return '-';
  if (diffMs < 1000) return `${diffMs} ms`;
  const seconds = diffMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${mins}m ${rem.toFixed(0)}s`;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let size = value;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const filterLogsByStatus = (logs: LogRecord[], statusFilter: string) => {
  if (!logs) return [];
  if (!statusFilter) return logs;
  if (statusFilter === 'error') return logs.filter((log) => log.level === 'error');
  if (statusFilter === 'warn') return logs.filter((log) => log.level === 'warn');
  if (statusFilter === 'ok') return logs.filter((log) => !['error', 'warn'].includes(log.level));
  return logs;
};

export default function SystemLogsRoute() {
  const { spacing, token, borderRadius } = useDesignTokens();
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const [activeTab, setActiveTab] = useState<ActiveTab>('app');
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [processTail, setProcessTail] = useState<ProcessLogTailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [processLoading, setProcessLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [errorCategoryFilter, setErrorCategoryFilter] = useState<string>('');
  const [pollIdFilter, setPollIdFilter] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [serverStats, setServerStats] = useState<any>(null);
  const [serverPollStats, setServerPollStats] = useState<{
    total: number;
    withErrors: number;
    withWarnings: number;
    healthy: number;
  } | null>(null);
  const [processLineLimit, setProcessLineLimit] = useState<number>(200);

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [levelFilter, searchFilter, statusFilter, errorCategoryFilter, pollIdFilter, activeTab]);

  useEffect(() => {
    if (activeTab !== 'app') {
      setPollIdFilter('');
    }
  }, [activeTab]);

  const { getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 25,
    resetDeps: [activeTab, levelFilter, searchFilter, statusFilter, errorCategoryFilter, pollIdFilter],
  });

  // Use server-provided stats (unfiltered by levelFilter) so stat cards
  // stay correct regardless of the active level filter.
  const rawStats = useMemo(
    () => ({
      total: serverStats?.total ?? 0,
      error: serverStats?.error ?? 0,
      warn: serverStats?.warn ?? 0,
      info: serverStats?.info ?? 0,
      debug: serverStats?.debug ?? 0,
    }),
    [serverStats]
  );

  const pollGroups: PollGroupRow[] = useMemo(() => {
    const appLogs = logs.filter((log) => log.stream !== 'access');
    const groups: Record<string, PollGroupRow> = {};

    appLogs.forEach((log) => {
      const pollId = extractPollId(log.message) ?? 'NO_POLL';
      if (!groups[pollId]) {
        groups[pollId] = {
          pollId,
          logs: [],
          firstTimestamp: log.timestamp,
          lastTimestamp: log.timestamp,
          hasError: false,
          hasWarn: false,
          eventsProcessed: undefined,
          retriesProcessed: undefined,
        };
      }

      const group = groups[pollId];
      group.logs.push(log);
      if (log.timestamp < group.firstTimestamp) group.firstTimestamp = log.timestamp;
      if (log.timestamp > group.lastTimestamp) group.lastTimestamp = log.timestamp;
      if (log.level === 'error') group.hasError = true;
      if (log.level === 'warn') group.hasWarn = true;

      if (log.meta) {
        if (typeof log.meta.eventsProcessed === 'number') group.eventsProcessed = log.meta.eventsProcessed;
        if (typeof log.meta.retriesProcessed === 'number') group.retriesProcessed = log.meta.retriesProcessed;
      }
    });

    let filtered = Object.values(groups);
    if (statusFilter === 'error') filtered = filtered.filter((group) => group.hasError);
    if (statusFilter === 'warn') filtered = filtered.filter((group) => group.hasWarn && !group.hasError);
    if (statusFilter === 'ok') filtered = filtered.filter((group) => !group.hasError && !group.hasWarn);
    if (pollIdFilter) {
      filtered = filtered.filter((group) => group.pollId.toLowerCase().includes(pollIdFilter.toLowerCase()));
    }

    return filtered.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
  }, [logs, pollIdFilter, statusFilter]);

  // Use server-provided pollStats (unfiltered by levelFilter) so stat cards
  // stay correct regardless of the active level filter.
  const pollStats = useMemo(
    () => ({
      total: serverPollStats?.total ?? pollGroups.length,
      withErrors: serverPollStats?.withErrors ?? pollGroups.filter((group) => group.hasError).length,
      withWarnings:
        serverPollStats?.withWarnings ?? pollGroups.filter((group) => group.hasWarn && !group.hasError).length,
      healthy: serverPollStats?.healthy ?? pollGroups.filter((group) => !group.hasError && !group.hasWarn).length,
    }),
    [serverPollStats, pollGroups]
  );

  const accessLogs = useMemo(() => filterLogsByStatus(logs, statusFilter), [logs, statusFilter]);

  const errorCategoryOptions = useMemo(() => {
    if (!serverStats?.errorCategories) return [];

    const categoryLabels: Record<string, string> = {
      ui_error: 'UI Error',
      api_error: 'API Error',
      validation_error: 'Validation Error',
      business_logic: 'Business Logic',
      unhandled: 'Unhandled',
      browser_error: 'Browser Error',
      http_4xx: 'HTTP 4xx',
      http_5xx: 'HTTP 5xx',
      network: 'Network',
      transform: 'Transform',
      ratelimit: 'Rate Limit',
      database: 'Database',
      other: 'Other',
      unknown: 'Unknown',
    };

    return Object.entries(serverStats.errorCategories)
      .filter(([, count]) => Number(count) > 0)
      .map(([category, count]) => ({
        value: category,
        label: `${categoryLabels[category] || category} (${count})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [serverStats]);

  const levelPresentation: Record<string, { label: string; variant: StatusBadgeVariant }> = {
    error: { label: 'Error', variant: 'error' },
    warn: { label: 'Warning', variant: 'warning' },
    info: { label: 'Info', variant: 'info' },
    debug: { label: 'Debug', variant: 'neutral' },
  };
  const renderLevelBadge = (level: string) => {
    const presentation = levelPresentation[level] || levelPresentation.info;
    return <StatusBadge status={level} label={presentation.label} variant={presentation.variant} />;
  };

  const hasActiveFilters =
    activeTab === 'process'
      ? false
      : !!(levelFilter || searchFilter || statusFilter || errorCategoryFilter || (activeTab === 'app' && pollIdFilter));

  const fetchLogs = async ({ silent = false, manual = false }: { silent?: boolean; manual?: boolean } = {}) => {
    if (activeTab === 'process') return;
    if (!silent) setLoading(true);
    if (manual) setManualRefreshPending(true);

    try {
      const response = await getSystemLogs({
        limit: 200,
        level: levelFilter || undefined,
        search: searchFilter || undefined,
        errorCategory: errorCategoryFilter || undefined,
        pollId: activeTab === 'app' && pollIdFilter ? pollIdFilter : undefined,
        source: activeTab,
      });
      // Access Logs for orgs/runtimes with no access-log file yet can come back
      // without a `logs` array; `pollGroups`/`accessLogs` below run unconditionally
      // on every render and call .filter()/.length on this, which crashed the whole
      // page via the error boundary whenever it was undefined.
      setLogs((response.logs ?? []) as LogRecord[]);
      setServerStats(response.stats || null);
      setServerPollStats(response.pollStats || null);
      setLastRefresh(new Date());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch system logs';
      msgApi.error(errorMessage);
    } finally {
      if (!silent) setLoading(false);
      if (manual) setManualRefreshPending(false);
    }
  };

  const fetchProcessTail = async ({ silent = false, manual = false }: { silent?: boolean; manual?: boolean } = {}) => {
    if (!silent) setProcessLoading(true);
    if (manual) setManualRefreshPending(true);

    try {
      const response = await getSystemProcessLogTail({ lines: processLineLimit });
      setProcessTail(response);
      setLastRefresh(new Date());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch process output';
      msgApi.error(errorMessage);
    } finally {
      if (!silent) setProcessLoading(false);
      if (manual) setManualRefreshPending(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'process') {
      fetchLogs();
    }
  }, [activeTab, levelFilter, searchFilter, errorCategoryFilter, pollIdFilter]);

  useEffect(() => {
    if (activeTab === 'process') {
      fetchProcessTail();
    }
  }, [activeTab, processLineLimit]);

  useEffect(() => {
    if (!autoRefresh) return;

    // The countdown used to tick route-level state once a second, re-rendering
    // this whole screen — and its six filter inputs — every second. That is the
    // same defect that wiped in-progress typing in the delivery-log date
    // picker. <RefreshCountdown> owns the tick in a leaf, so a second passing
    // repaints one line of text instead of the page.
    const refreshSeconds = 5;
    const interval = setInterval(() => {
      if (activeTab === 'process') {
        fetchProcessTail({ silent: true });
      } else {
        fetchLogs({ silent: true });
        setSelectedRowKeys([]);
      }
    }, refreshSeconds * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [
    autoRefresh,
    activeTab,
    levelFilter,
    searchFilter,
    errorCategoryFilter,
    pollIdFilter,
    processLineLimit,
    lastRefresh,
  ]);

  const handleQuickStatusFilter = (status: 'error' | 'warn' | 'ok' | '') => {
    setStatusFilter((current) => (current === status ? '' : status));
    setSelectedRowKeys([]);
  };

  const handleClearFilters = () => {
    setLevelFilter('');
    setSearchFilter('');
    setStatusFilter('');
    setErrorCategoryFilter('');
    setPollIdFilter('');
    setSelectedRowKeys([]);
  };

  const handleExport = async (exportType: 'all' | 'selected' | 'filtered', format: 'csv' | 'json') => {
    if (exportLoading || activeTab === 'process') return;

    let onProgress: ReturnType<typeof createExportProgress>['onProgress'] | undefined;
    let finish: ReturnType<typeof createExportProgress>['finish'] | undefined;

    try {
      setExportLoading(true);
      const filters = {
        level: levelFilter || undefined,
        search: searchFilter || undefined,
        errorCategory: errorCategoryFilter || undefined,
        pollId: activeTab === 'app' && pollIdFilter ? pollIdFilter : undefined,
        source: activeTab,
      };

      if (exportType === 'selected' && activeTab === 'app') {
        if (selectedRowKeys.length === 0) {
          msgApi.warning('Please select poll cycles to export');
          return;
        }
        ({ onProgress, finish } = createExportProgress(msgApi, `Export ${format.toUpperCase()}`));
        const selectedPollIds = selectedRowKeys
          .map((key) => {
            const match = String(key).match(/^poll-(.+)-/);
            return match ? match[1] : null;
          })
          .filter(Boolean);
        const pollIdList = selectedPollIds.join(',');
        if (format === 'csv') {
          await exportSystemLogsToCsv({ ...filters, pollId: pollIdList }, { onProgress });
        } else {
          await exportSystemLogsToJson({ ...filters, pollId: pollIdList }, { onProgress });
        }
        finish(`Exported ${selectedRowKeys.length} poll cycle(s)`);
        return;
      }

      ({ onProgress, finish } = createExportProgress(msgApi, `Export ${format.toUpperCase()}`));
      if (format === 'csv') {
        await exportSystemLogsToCsv(exportType === 'all' ? { source: activeTab } : filters, { onProgress });
      } else {
        await exportSystemLogsToJson(exportType === 'all' ? { source: activeTab } : filters, { onProgress });
      }
      const count =
        activeTab === 'app'
          ? exportType === 'filtered' && hasActiveFilters
            ? pollGroups.length
            : logs.length
          : accessLogs.length;
      finish(`Exported ${count} log(s)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      if (finish) {
        finish(errorMessage, true);
      } else {
        msgApi.error(errorMessage);
      }
    } finally {
      setExportLoading(false);
    }
  };

  const handleClearAll = () => {
    modal.confirm({
      title: 'Clear current log files',
      content:
        'This archives and truncates the current app/access log files. Rotated historical files are not deleted. Continue?',
      okText: 'Clear Logs',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await clearSystemLogs();
          msgApi.success('Current log files cleared and archived');
          setSelectedRowKeys([]);
          if (activeTab === 'process') {
            await fetchProcessTail();
          } else {
            await fetchLogs();
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to clear logs';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  const handleDownloadPollCycle = async (group: PollGroupRow) => {
    const { onProgress, finish } = createExportProgress(msgApi, 'Download JSON');
    try {
      setExportLoading(true);
      await exportSystemLogsToJson({ pollId: group.pollId, source: 'app' }, { onProgress });
      finish(`Downloaded poll cycle ${group.pollId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to download poll cycle';
      finish(errorMessage, true);
    } finally {
      setExportLoading(false);
    }
  };

  const appColumns = [
    {
      title: 'Poll',
      dataIndex: 'pollId',
      key: 'pollId',
      width: 180,
      sorter: (a: PollGroupRow, b: PollGroupRow) => (a.pollId || '').localeCompare(b.pollId || ''),
      render: (pollId: string, record: PollGroupRow) => {
        const label = pollId === 'NO_POLL' ? 'Ungrouped logs' : `POLL #${pollId}`;
        return (
          <Space direction="vertical" size={2}>
            <Text type="code">{label}</Text>
            <Text type="supporting" color="secondary" className="console-caption-secondary">
              {(record.logs ?? []).length} step{(record.logs ?? []).length > 1 ? 's' : ''}
            </Text>
          </Space>
        );
      },
    },
    {
      title: 'Time window',
      key: 'timeWindow',
      width: 260,
      sorter: (a: PollGroupRow, b: PollGroupRow) =>
        new Date(a.firstTimestamp).getTime() - new Date(b.firstTimestamp).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (_: unknown, record: PollGroupRow) => (
        <Space direction="vertical" size={2}>
          <Text color="secondary" className="console-type-body">
            {formatDateTime(record.firstTimestamp)} → {formatDateTime(record.lastTimestamp)}
          </Text>
          <Text type="supporting" color="secondary" className="console-caption-secondary">
            Duration: {formatDuration(record.firstTimestamp, record.lastTimestamp)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Summary',
      key: 'summary',
      ellipsis: true,
      render: (_: unknown, record: PollGroupRow) => {
        const health = record.hasError
          ? { status: 'FAILED', label: 'Has errors', variant: 'error' as const }
          : record.hasWarn
            ? { status: 'WARNING', label: 'Warnings only', variant: 'warning' as const }
            : { status: 'HEALTHY', label: 'Healthy', variant: 'neutral' as const };
        const errors = (record.logs ?? []).filter((log) => log.level === 'error').length;
        const warnings = (record.logs ?? []).filter((log) => log.level === 'warn').length;
        return (
          <Space direction="vertical" size={2} className="console-width-full">
            <StatusBadge status={health.status} label={health.label} variant={health.variant} />
            <Text type="supporting" color="secondary">
              {errors} {errors === 1 ? 'error' : 'errors'} · {warnings} {warnings === 1 ? 'warning' : 'warnings'}
              {typeof record.eventsProcessed === 'number' ? ` · ${record.eventsProcessed} events` : ''}
              {typeof record.retriesProcessed === 'number' ? ` · ${record.retriesProcessed} retries` : ''}
            </Text>
          </Space>
        );
      },
    },
  ];

  const rawAccessColumns = [
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 210,
      sorter: (a: LogRecord, b: LogRecord) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (value: string) => <Text className="console-caption-secondary">{formatDateTime(value)}</Text>,
    },
    {
      title: 'Level',
      dataIndex: 'level',
      key: 'level',
      width: 120,
      render: (level: string) => renderLevelBadge(level),
    },
    {
      title: 'Request',
      key: 'request',
      render: (_: unknown, record: LogRecord) => (
        <Space direction="vertical" size={0}>
          <Text weight="semibold" className="console-text-primary">
            {record.meta?.method || 'REQUEST'} {record.meta?.url || record.message}
          </Text>
          <Text type="supporting" color="secondary" className="console-caption-secondary">
            stream: {record.stream || 'access'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 100,
      render: (_: unknown, record: LogRecord) => record.meta?.status ?? '—',
    },
    {
      title: 'Resp. Time',
      key: 'responseTimeMs',
      width: 120,
      render: (_: unknown, record: LogRecord) =>
        typeof record.meta?.responseTimeMs === 'number' ? `${record.meta.responseTimeMs} ms` : '—',
    },
  ];

  const renderExpandedRow = (group: PollGroupRow) => {
    const sorted = [...(group.logs ?? [])].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const startTime = new Date(sorted[0]?.timestamp).getTime();
    const getRelativeTime = (timestamp: string) => {
      const diffMs = new Date(timestamp).getTime() - startTime;
      if (diffMs < 1000) return `+${diffMs}ms`;
      return `+${(diffMs / 1000).toFixed(2)}s`;
    };

    return (
      <div
        className="system-log-expanded-row"
      >
        <Card
          variant="outlined"
          className="system-log-card"
          styles={{ body: { padding: spacing[4] } }}
        >
          <div className="system-log-timeline-heading">
            <Text weight="semibold" className="console-type-control console-text-primary">
              Poll Cycle Timeline
            </Text>
            <Space size={spacingToNumber(spacing[2])}>
              <Text type="supporting" color="secondary">
                {sorted.length} event{sorted.length > 1 ? 's' : ''} ·{' '}
                {formatDuration(group.firstTimestamp, group.lastTimestamp)} duration
              </Text>
              <Button
                size="small"
                icon={<GatewayIcon name="DownloadOutlined" />}
                onClick={() => handleDownloadPollCycle(group)}
                disabled={exportLoading}
                style={{ borderRadius: borderRadius.full }}
              >
                Download JSON
              </Button>
            </Space>
          </div>

          <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
            {sorted.map((entry, index) => {
              return (
                <Card
                  key={`${entry.timestamp}-${index}`}
                  variant="outlined"
                  className="system-log-entry-card"
                  data-level={['error', 'warn', 'debug'].includes(entry.level) ? entry.level : 'info'}
                  styles={{ body: { padding: spacing[3] } }}
                >
                  <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
                    <Space wrap>
                      {renderLevelBadge(entry.level)}
                      <Text type="code">{getRelativeTime(entry.timestamp)}</Text>
                      {entry.errorCategory && (
                        <Text type="supporting" color="secondary">
                          {entry.errorCategory}
                        </Text>
                      )}
                    </Space>
                    <Text className="system-log-message">
                      {entry.message}
                    </Text>
                    <Text type="supporting" color="secondary" className="console-caption-secondary">
                      {formatDateTime(entry.timestamp)}
                    </Text>
                    {entry.meta && Object.keys(entry.meta).length > 0 && (
                      <div
                        className="system-log-metadata"
                      >
                        <pre className="system-log-metadata__content">
                          {JSON.stringify(entry.meta, null, 2)}
                        </pre>
                      </div>
                    )}
                  </Space>
                </Card>
              );
            })}
          </Space>
        </Card>
      </div>
    );
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (nextRowKeys: Key[]) => setSelectedRowKeys(nextRowKeys),
    selections: [
      {
        key: 'all',
        text: 'Select all poll cycles',
        onSelect: () => setSelectedRowKeys(pollGroups.map((group) => `poll-${group.pollId}-${group.firstTimestamp}`)),
      },
      {
        key: 'errors',
        text: 'Select cycles with errors',
        onSelect: () =>
          setSelectedRowKeys(
            pollGroups.filter((group) => group.hasError).map((group) => `poll-${group.pollId}-${group.firstTimestamp}`)
          ),
      },
      {
        key: 'warnings',
        text: 'Select cycles with warnings',
        onSelect: () =>
          setSelectedRowKeys(
            pollGroups
              .filter((group) => group.hasWarn && !group.hasError)
              .map((group) => `poll-${group.pollId}-${group.firstTimestamp}`)
          ),
      },
      {
        key: 'none',
        text: 'Clear selection',
        onSelect: () => setSelectedRowKeys([]),
      },
    ],
  };

  const pageDescription =
    activeTab === 'app'
      ? 'Monitor application logs, worker activity, and scheduler cycles.'
      : activeTab === 'access'
        ? 'Inspect rotated access logs from the backend request stream.'
        : 'Tail the process bootstrap output from nohup.out.';

  return (
    <PageTemplate
      header={
        <div className="system-logs-header-grid" data-narrow={isNarrow}>
          <div className="system-logs-header-content">
            <PageHeader
              title="System logs"
              description={pageDescription}
              compact
              actions={
                activeTab === 'process' ? null : (
                  <Space size={spacingToNumber(spacing[2])}>
                    <Dropdown
                      trigger={['click']}
                      disabled={exportLoading}
                      menu={{
                        items: [
                          {
                            key: 'all-csv',
                            label: 'Export all logs (CSV)',
                            icon: <GatewayIcon name="DownloadOutlined" />,
                            onClick: () => handleExport('all', 'csv'),
                            disabled: exportLoading,
                          },
                          {
                            key: 'all-json',
                            label: 'Export all logs (JSON)',
                            icon: <GatewayIcon name="DownloadOutlined" />,
                            onClick: () => handleExport('all', 'json'),
                            disabled: exportLoading,
                          },
                          { type: 'divider' as const },
                          {
                            key: 'filtered-csv',
                            label: 'Export filtered logs (CSV)',
                            icon: <GatewayIcon name="DownloadOutlined" />,
                            onClick: () => handleExport('filtered', 'csv'),
                            disabled: !hasActiveFilters || exportLoading,
                          },
                          {
                            key: 'filtered-json',
                            label: 'Export filtered logs (JSON)',
                            icon: <GatewayIcon name="DownloadOutlined" />,
                            onClick: () => handleExport('filtered', 'json'),
                            disabled: !hasActiveFilters || exportLoading,
                          },
                          ...(activeTab === 'app'
                            ? [
                                { type: 'divider' as const },
                                {
                                  key: 'selected-csv',
                                  label: `Export selected cycles (${selectedRowKeys.length}) CSV`,
                                  icon: <GatewayIcon name="DownloadOutlined" />,
                                  onClick: () => handleExport('selected', 'csv'),
                                  disabled: selectedRowKeys.length === 0 || exportLoading,
                                },
                                {
                                  key: 'selected-json',
                                  label: `Export selected cycles (${selectedRowKeys.length}) JSON`,
                                  icon: <GatewayIcon name="DownloadOutlined" />,
                                  onClick: () => handleExport('selected', 'json'),
                                  disabled: selectedRowKeys.length === 0 || exportLoading,
                                },
                              ]
                            : []),
                        ],
                      }}
                    >
                      <Button icon={<GatewayIcon name="DownloadOutlined" />} disabled={exportLoading} size="small">
                        Export logs
                      </Button>
                    </Dropdown>
                    <Button
                      danger
                      icon={<GatewayIcon name="DeleteOutlined" />}
                      onClick={handleClearAll}
                      disabled={exportLoading || loading}
                      size="small"
                    >
                      Clear All
                    </Button>
                  </Space>
                )
              }
            />
          </div>
          <div className="system-logs-refresh-control" data-narrow={isNarrow}>
            {autoRefresh ? (
              <RefreshCountdown intervalMs={5000} lastRefreshAt={lastRefresh.getTime()} />
            ) : (
              <Text type="supporting" color="secondary" className="console-text-secondary">
                Auto-refresh off
              </Text>
            )}
            <Switch
              aria-label="Enable automatic system log refresh"
              checked={autoRefresh}
              onChange={() => setAutoRefresh(!autoRefresh)}
            />
            <Divider type="vertical" className="console-margin-none" />
            <Button
              type={autoRefresh ? 'primary' : 'default'}
              icon={<GatewayIcon name="ReloadOutlined" />}
              onClick={() => setAutoRefresh(!autoRefresh)}
              size="small"
            >
              {autoRefresh ? 'On' : 'Off'}
            </Button>
          </div>
        </div>
      }
    >
      <TabList
        role="tablist"
        aria-label="System log source"
        value={activeTab}
        onChange={(key) => setActiveTab(key as ActiveTab)}
        hasDivider
        className="console-margin-bottom-3"
      >
        <Tab value="app" label="Application Logs" />
        <Tab value="access" label="Access Logs" />
        <Tab value="process" label="Process Output" />
      </TabList>

      {activeTab === 'process' ? (
        <>
          <div className="system-logs-process-toolbar">
            <Select
              placeholder="Lines"
              aria-label="Process output line count"
              size="small"
              value={processLineLimit}
              onChange={(value) => setProcessLineLimit(value)}
              className="system-logs-line-limit"
              options={[
                { value: 100, label: 'Last 100 lines' },
                { value: 200, label: 'Last 200 lines' },
                { value: 500, label: 'Last 500 lines' },
              ]}
            />
            <div className="system-logs-process-actions">
              <Button
                icon={<GatewayIcon name="ReloadOutlined" />}
                onClick={() => fetchProcessTail({ manual: true, silent: true })}
                loading={manualRefreshPending}
                size="small"
              >
                {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>

          {processTail?.truncated && (
            <InlineHint tone="warning">
              Showing only the latest lines from nohup.out to keep the response fast.
            </InlineHint>
          )}

          <Card
            className="system-logs-process-card"
            variant="outlined"
            styles={{ body: { padding: spacing[4] } }}
          >
            <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
              <Space wrap size={spacingToNumber(spacing[2])}>
                <Text type="code">{processTail?.fileName || 'nohup.out'}</Text>
                <Text type="supporting" color="secondary">
                  {processTail?.returnedLines || 0} lines
                </Text>
                <Text type="supporting" color="secondary">
                  {formatBytes(processTail?.sizeBytes || 0)}
                </Text>
                <Text type="supporting" color="secondary">
                  {processTail?.updatedAt ? `Updated ${formatDateTime(processTail.updatedAt)}` : 'No process log found'}
                </Text>
              </Space>

              {!processTail?.fileExists ? (
                <StatePanel
                  glyph="searching"
                  size="compact"
                  title="No process output found"
                  description="The process output file does not exist at the configured path."
                />
              ) : (
                <div className="system-logs-process-output">
                  {(processTail.lines || []).map((line: ProcessLogLine) => (
                    <div
                      key={`${line.lineNumber}-${line.text.slice(0, 20)}`}
                      className="system-log-process-line"
                    >
                      <span className="system-log-line-number">{line.lineNumber}</span>
                      <span className="system-log-message">{line.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </Space>
          </Card>
        </>
      ) : (
        <>
          <section aria-label="Log summary">
            <MetricStrip className="ds-metrics--four system-logs-summary-grid">
              {(activeTab === 'app'
              ? [
                  {
                    label: 'Poll Cycles',
                    value: pollStats.total,
                    detail: `${rawStats.total} raw logs in window`,
                    filter: '' as const,
                  },
                  {
                    label: 'With Errors',
                    value: pollStats.withErrors,
                    detail: `${rawStats.error} error-level log lines`,
                    filter: 'error' as const,
                    tone: pollStats.withErrors > 0 ? ('bad' as const) : ('neutral' as const),
                  },
                  {
                    label: 'With Warnings',
                    value: pollStats.withWarnings,
                    detail: `${rawStats.warn} warning logs`,
                    filter: 'warn' as const,
                  },
                  {
                    label: 'Healthy',
                    value: pollStats.healthy,
                    detail: 'No issues',
                    filter: 'ok' as const,
                  },
                ]
              : [
                  {
                    label: 'Access Entries',
                    value: accessLogs.length,
                    detail: `${serverStats?.byStream?.access ?? accessLogs.length} in period`,
                    filter: '' as const,
                  },
                  {
                    label: '5xx / Errors',
                    value: rawStats.error,
                    detail: 'Server-side request failures',
                    filter: 'error' as const,
                    tone: rawStats.error > 0 ? ('bad' as const) : ('neutral' as const),
                  },
                  {
                    label: '4xx / Warnings',
                    value: rawStats.warn,
                    detail: 'Client/request warnings',
                    filter: 'warn' as const,
                  },
                  {
                    label: 'Informational',
                    value: rawStats.info,
                    detail: '2xx/3xx and normal traffic',
                    filter: 'ok' as const,
                  },
                ]
              ).map((item) => (
                <Metric
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  detail={item.detail}
                  tone={'tone' in item ? item.tone : 'neutral'}
                  onClick={item.filter ? () => handleQuickStatusFilter(item.filter) : undefined}
                  ariaLabel={item.filter ? `Filter logs by ${item.label}: ${item.value}` : undefined}
                />
              ))}
            </MetricStrip>
          </section>

          {activeTab === 'app' && selectedRowKeys.length > 0 && (
            <Card
              className="system-logs-selection-card"
            >
              <div
                className="system-logs-selection-content"
              >
                <div>
                  <Text weight="semibold" className="console-margin-right-2">
                    {selectedRowKeys.length} poll cycle(s) selected
                  </Text>
                  <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>
                    Clear selection
                  </Button>
                </div>
                <Button
                  size="small"
                  icon={<GatewayIcon name="DownloadOutlined" />}
                  onClick={() => handleExport('selected', 'json')}
                >
                  Export Selected (JSON)
                </Button>
              </div>
            </Card>
          )}

          <div className="system-logs-filter-toolbar">
            <Select
              placeholder="Status"
              aria-label="Filter logs by status"
              className="system-logs-filter-status"
              allowClear
              size="small"
              value={statusFilter || undefined}
              onChange={(value) => setStatusFilter(value || '')}
              options={[
                { value: 'error', label: activeTab === 'access' ? '5xx / Errors' : 'With Errors' },
                { value: 'warn', label: activeTab === 'access' ? '4xx / Warnings' : 'With Warnings' },
                { value: 'ok', label: activeTab === 'access' ? 'Informational' : 'Healthy' },
              ]}
            />
            <Select
              placeholder="Log Level"
              aria-label="Filter logs by level"
              className="system-logs-filter-level"
              allowClear
              size="small"
              value={levelFilter || undefined}
              onChange={(value) => setLevelFilter(value || '')}
              options={[
                { value: 'info', label: 'Info' },
                { value: 'warn', label: 'Warning' },
                { value: 'error', label: 'Error' },
                { value: 'debug', label: 'Debug' },
              ]}
            />
            <Select
              placeholder="Error Category"
              aria-label="Filter logs by error category"
              className="system-logs-filter-category"
              allowClear
              size="small"
              value={errorCategoryFilter || undefined}
              onChange={(value) => setErrorCategoryFilter(value || '')}
              options={errorCategoryOptions}
              loading={loading && errorCategoryOptions.length === 0}
              disabled={errorCategoryOptions.length === 0}
              notFoundContent={errorCategoryOptions.length === 0 ? 'No error categories' : 'No matches'}
            />
            {activeTab === 'app' && (
              <Input
                placeholder="Poll ID (e.g., 1252)"
                aria-label="Filter logs by poll ID"
                allowClear
                size="small"
                value={pollIdFilter}
                onChange={(event) => setPollIdFilter(event.target.value)}
                className="system-logs-filter-poll-id"
                prefix={<GatewayIcon name="SearchOutlined" className="console-text-muted" />}
              />
            )}
            <Input
              placeholder={activeTab === 'app' ? 'Search messages...' : 'Search URL, method, or message...'}
              aria-label={activeTab === 'app' ? 'Search log messages' : 'Search access log URL, method, or message'}
              allowClear
              size="small"
              value={searchFilter}
              onChange={(event) => setSearchFilter(event.target.value)}
              className="system-logs-filter-search"
              prefix={<GatewayIcon name="SearchOutlined" className="console-text-muted" />}
            />
            <div className="system-logs-filter-actions" data-narrow={isNarrow}>
              {hasActiveFilters && (
                <Button size="small" onClick={handleClearFilters} icon={<GatewayIcon name="ClearOutlined" />}>
                  Clear Filters
                </Button>
              )}
              <Button
                icon={<GatewayIcon name="ReloadOutlined" />}
                onClick={() => fetchLogs({ manual: true, silent: true })}
                loading={manualRefreshPending}
                size="small"
              >
                {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>

          <div className="full-bleed-table">
            <Card
              className="panel"
              style={{
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${cssVar.border.default}`,
                boxShadow: 'none',
              }}
              styles={{ body: { padding: 'var(--spacing-0)' } }}
            >
              {activeTab === 'app' ? (
                // Explicit `key` forces React to unmount/remount instead of
                // reconciling this into the ModernTable<LogRecord> below — without
                // it, both tables share the same JSX position and React treats a
                // tab switch as a prop update on one instance, not a swap. That let
                // AntD's Table keep an internal row from the previous columns/data
                // shape alive across the switch — the actual cause of both the
                // Access Logs crash and a leftover "POLL #undefined" row bleeding
                // into the Access Logs table after the crash was fixed.
                <ModernTable<PollGroupRow>
                  key="system-logs-app-table"
                  columns={appColumns}
                  dataSource={pollGroups}
                  rowKey={(record) => `poll-${record.pollId}-${record.firstTimestamp}`}
                  rowSelection={rowSelection}
                  loading={loading}
                  size="small"
                  enableResize={true}
                  stickyHeader={true}
                  pagination={{
                    ...getPaginationConfig(pollGroups.length),
                    showTotal: (total) => `${total} poll cycle${total === 1 ? '' : 's'}`,
                  }}
                  expandable={{
                    expandedRowRender: (record) => renderExpandedRow(record),
                    rowExpandable: (record) => (record.logs ?? []).length > 0,
                  }}
                  locale={{
                    emptyText: hasActiveFilters ? (
                      <StatePanel
                        glyph="searching"
                        size="compact"
                        title="No poll cycles match these filters"
                        description="Clear filters to see more results."
                        actions={
                          <Button onClick={handleClearFilters} icon={<GatewayIcon name="ClearOutlined" />}>
                            Clear filters
                          </Button>
                        }
                      />
                    ) : (
                      <StatePanel
                        glyph="searching"
                        size="compact"
                        title="No application logs found"
                        description="Worker, scheduler, and backend logs from the last 24 hours appear here."
                        actions={
                          <Button
                            onClick={() => fetchLogs({ manual: true, silent: true })}
                            icon={<GatewayIcon name="ReloadOutlined" />}
                          >
                            Refresh logs
                          </Button>
                        }
                      />
                    ),
                  }}
                />
              ) : (
                <ModernTable<LogRecord>
                  key="system-logs-access-table"
                  columns={rawAccessColumns}
                  dataSource={accessLogs}
                  rowKey={(record) => `${record.timestamp}-${record.message}`}
                  loading={loading}
                  size="small"
                  enableResize={true}
                  stickyHeader={true}
                  pagination={{
                    ...getPaginationConfig(accessLogs.length),
                    showTotal: (total) => `${total} access log${total === 1 ? '' : 's'}`,
                  }}
                  locale={{
                    emptyText: hasActiveFilters ? (
                      <StatePanel
                        glyph="searching"
                        size="compact"
                        title="No access logs match these filters"
                        description="Adjust or clear filters to widen the view."
                        actions={
                          <Button onClick={handleClearFilters} icon={<GatewayIcon name="ClearOutlined" />}>
                            Clear filters
                          </Button>
                        }
                      />
                    ) : (
                      <StatePanel
                        glyph="searching"
                        size="compact"
                        title="No access logs found"
                        description="Recent rotated access logs appear here."
                        actions={
                          <Button
                            onClick={() => fetchLogs({ manual: true, silent: true })}
                            icon={<GatewayIcon name="ReloadOutlined" />}
                          >
                            Refresh logs
                          </Button>
                        }
                      />
                    ),
                  }}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </PageTemplate>
  );
}
