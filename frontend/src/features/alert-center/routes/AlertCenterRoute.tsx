import { useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Grid,
  Row,
  Select,
  Space,
  Statistic,
  Dropdown,
  Collapse,
} from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { FilterBar } from '../../../components/common/FilterBar';
import { SearchInput } from '../../../components/common/ListControls';
import { ModernTable } from '../../../components/common/ModernTable';
import {
  exportAlertCenterLogsToCsv,
  exportAlertCenterLogsToJson,
  getAlertCenterLogs,
  getAlertCenterStatsSummary,
  getAlertCenterStatus,
  getTenantInfo,
  getUIConfig,
} from '../../../services/api';
import type { AlertCenterLog } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { createExportProgress } from '../../../utils/export-progress';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';
import { StatePanel } from '../../../components/common/StatePanel';
import { Button } from '../../../components/common/LegacyButton';
import { StatusBadge } from '../../../components/common/StatusBadge';

const alertStatusCopy: Record<string, { label: string; status: string }> = {
  SENT: { label: 'Delivered', status: 'SUCCESS' },
  FAILED: { label: 'Failed', status: 'FAILED' },
  SKIPPED: { label: 'Skipped', status: 'SKIPPED' },
  RESOLVED: { label: 'Resolved', status: 'SUCCESS' },
};

const AlertStatus = ({ status }: { status?: string }) => {
  const normalizedStatus = String(status || '').toUpperCase();
  const copy = alertStatusCopy[normalizedStatus];
  return (
    <StatusBadge status={copy?.status || normalizedStatus} label={copy?.label || status || 'Unknown'} size="small" />
  );
};

const STATUS_OPTIONS = [
  { value: 'SENT', label: 'Delivered' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'SKIPPED', label: 'Skipped' },
  { value: 'RESOLVED', label: 'Resolved' },
];

const CHANNEL_OPTIONS = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'SYSTEM', label: 'System' },
];

const TYPE_LABELS: Record<string, string> = {
  DELIVERY_FAILURE_REPORT: 'Delivery Failure Report',
  EVENT_SOURCE_DOWN: 'Event Source Down',
  EVENT_SOURCE_RECOVERED: 'Event Source Recovered',
  INTEGRATION_DELIVERY_FAILING: 'Integration Deliveries Failing',
  INTEGRATION_DELIVERY_RECOVERED: 'Integration Deliveries Recovered',
};

const { RangePicker } = DatePicker;

export const AlertCenterRoute = () => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const [searchParams, setSearchParams] = useSearchParams();

  // Use a ref to read searchParams without subscribing to its changes,
  // preventing circular re-renders between URL and state.
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  // Initialize filter state from URL params using lazy useState initializers.
  // Default statusFilter to 'FAILED' when no status param is present in the URL.
  const [statusFilter, setStatusFilter] = useState<string | undefined>(() => searchParams.get('status') || 'FAILED');
  const [channelFilter, setChannelFilter] = useState<string | undefined>(
    () => searchParams.get('channel') || undefined
  );
  const [typeFilter, setTypeFilter] = useState<string | undefined>(() => searchParams.get('type') || undefined);
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [dateRange, setDateRange] = useState<[string, string] | null>(() => {
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    return startDate && endDate ? [startDate, endDate] : null;
  });
  const [exportLoading, setExportLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AlertCenterLog | null>(null);
  const [payloadExpanded, setPayloadExpanded] = useState(false);
  const [providerResponseExpanded, setProviderResponseExpanded] = useState(false);

  // Pagination with auto-reset on filter changes
  // NOTE: Backend doesn't support server-side pagination yet (no page/offset params)
  // This uses client-side pagination on loaded records
  const { getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 25,
    resetDeps: [statusFilter, channelFilter, typeFilter, search, dateRange],
  });

  // Single direction sync: state -> URL only.
  // Uses searchParamsRef to read current URL without subscribing to searchParams changes.
  useEffect(() => {
    const params = new URLSearchParams(searchParamsRef.current);

    if (statusFilter) params.set('status', statusFilter);
    else params.delete('status');

    if (channelFilter) params.set('channel', channelFilter);
    else params.delete('channel');

    if (typeFilter) params.set('type', typeFilter);
    else params.delete('type');

    if (search) params.set('search', search);
    else params.delete('search');

    if (dateRange?.[0] && dateRange?.[1]) {
      params.set('startDate', dateRange[0]);
      params.set('endDate', dateRange[1]);
    } else {
      params.delete('startDate');
      params.delete('endDate');
    }

    if (params.toString() !== searchParamsRef.current.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [statusFilter, channelFilter, typeFilter, search, dateRange, setSearchParams]);

  const {
    data: logs = [],
    isFetching,
    refetch,
  } = useQuery<AlertCenterLog[]>({
    queryKey: ['alert-center', statusFilter, channelFilter, typeFilter, search, dateRange],
    queryFn: () =>
      getAlertCenterLogs({
        status: statusFilter || undefined,
        channel: channelFilter || undefined,
        type: typeFilter || undefined,
        search: search || undefined,
        startDate: dateRange?.[0],
        endDate: dateRange?.[1],
        // TODO: Backend should support server-side pagination (page/offset params)
        limit: 100,
      }),
    staleTime: 30_000, // treat data as fresh for 30s — prevents re-fetch on every sidebar navigation
  });
  const { data: alertStatus, isFetching: alertStatusLoading } = useQuery({
    queryKey: ['alert-center-status'],
    queryFn: getAlertCenterStatus,
    staleTime: 60 * 1000,
  });
  const { data: uiConfig } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000,
  });
  const { data: tenantInfo } = useQuery({
    queryKey: ['tenant-info'],
    queryFn: getTenantInfo,
    staleTime: 5 * 60 * 1000,
  });

  // Note: explicit refetch-on-navigate removed — React Query already re-fetches
  // when staleTime expires. Forcing a refetch on every location.key change caused
  // a 100-row network call on every sidebar click, even with fresh data.

  // Stats are fetched from a dedicated endpoint that ignores statusFilter,
  // so the filter card counts remain correct regardless of active status filter.
  const { data: stats = { total: 0, sent: 0, failed: 0, skipped: 0 } } = useQuery({
    queryKey: ['alert-center-stats', channelFilter, typeFilter, search, dateRange],
    queryFn: () =>
      getAlertCenterStatsSummary({
        channel: channelFilter || undefined,
        type: typeFilter || undefined,
        search: search || undefined,
        startDate: dateRange?.[0],
        endDate: dateRange?.[1],
      }),
    staleTime: 30 * 1000,
  });

  const typeOptions = useMemo(() => {
    const values = Array.from(new Set(logs.map((log) => log.type).filter(Boolean)));
    const merged = values.length ? values : Object.keys(TYPE_LABELS);
    return merged.map((value) => ({ value, label: TYPE_LABELS[value] || value }));
  }, [logs]);

  const formatRecipients = (recipients?: string[]) => {
    if (!recipients || recipients.length === 0) return '—';
    if (recipients.length === 1) return recipients[0];
    return `${recipients[0]} +${recipients.length - 1}`;
  };

  const jsonColors = {
    key: cssVar.text.secondary,
    string: colors.success[700],
    number: colors.info[700],
    boolean: colors.warning[700],
    null: cssVar.text.muted,
  };

  const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const formatJsonForDisplay = (value: unknown) => {
    const json = JSON.stringify(value, null, 2) || '';
    const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const highlighted = escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"\\s*:)|("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*")|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?/g,
      (match) => {
        if (match.startsWith('"') && match.endsWith(':')) {
          return `<span style=\"color: ${jsonColors.key}; font-weight: 600;\">${match}</span>`;
        }
        if (match.startsWith('"')) {
          return `<span style=\"color: ${jsonColors.string};\">${match}</span>`;
        }
        if (match === 'true' || match === 'false') {
          return `<span style=\"color: ${jsonColors.boolean}; font-weight: 600;\">${match}</span>`;
        }
        if (match === 'null') {
          return `<span style=\"color: ${jsonColors.null};\">${match}</span>`;
        }
        return `<span style=\"color: ${jsonColors.number};\">${match}</span>`;
      }
    );
    return highlighted;
  };

  const formatTextOrJsonForDisplay = (value?: string | null) => {
    if (!value) return '';
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return formatJsonForDisplay(parsed);
      } catch (err) {
        return escapeHtml(value);
      }
    }
    return escapeHtml(value);
  };

  const handleClearFilters = () => {
    setStatusFilter(undefined);
    setChannelFilter(undefined);
    setTypeFilter(undefined);
    setSearch('');
    setDateRange(null);
  };

  const copyToClipboard = async (text: string, label: string) => {
    const copied = await copyTextToClipboard(text);
    if (copied) {
      msgApi.success(`${label} copied to clipboard`);
    } else {
      msgApi.error('Failed to copy to clipboard');
    }
  };

  const handleRefresh = async () => {
    try {
      await refetch();
      msgApi.success('Alert logs refreshed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh logs';
      msgApi.error(errorMessage);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (exportLoading) return;
    setExportLoading(true);
    const { onProgress, finish } = createExportProgress(msgApi, `Export ${format.toUpperCase()}`);
    try {
      const filters = {
        status: statusFilter || undefined,
        channel: channelFilter || undefined,
        type: typeFilter || undefined,
        search: search || undefined,
        startDate: dateRange?.[0],
        endDate: dateRange?.[1],
      };
      if (format === 'csv') {
        await exportAlertCenterLogsToCsv(filters, { onProgress });
      } else {
        await exportAlertCenterLogsToJson(filters, { onProgress });
      }
      finish('Export complete');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      finish(errorMessage, true);
    } finally {
      setExportLoading(false);
    }
  };

  const columns = [
    {
      title: 'Time',
      dataIndex: 'createdAt',
      width: 160,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (value: string) => (value ? <AlertStatus status={value} /> : '—'),
    },
    {
      title: 'Subject',
      dataIndex: 'subject',
      render: (value: string) => (
        <Text maxLines={1} className="console-display-block alert-center-subject-cell">
          {value || '—'}
        </Text>
      ),
    },
    {
      title: 'Recipients',
      dataIndex: 'recipients',
      width: 220,
      render: (value: string[]) => (
        <Text maxLines={1} className="console-display-block alert-center-recipient-cell">
          {formatRecipients(value)}
        </Text>
      ),
    },
    {
      title: 'Failures',
      dataIndex: 'totalFailures',
      width: 100,
      align: 'right' as const,
      render: (value: number) => (typeof value === 'number' ? value : '—'),
    },
    {
      title: 'Details',
      dataIndex: 'id',
      width: 100,
      fixed: 'right' as const,
      render: (_: string, record: AlertCenterLog) => (
        <Button
          type="link"
          icon={<GatewayIcon name="EyeOutlined" />}
          onClick={() => {
            setSelectedLog(record);
            setPayloadExpanded(!!record.payload);
            setProviderResponseExpanded(!!record.providerResponse);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  const cardStyle = {
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${cssVar.border.default}`,
    background: cssVar.bg.surface,
  } as const;

  return (
    <PageTemplate
      title="Alert Center"
      description="Monitor outbound alerting activity across channels."
      compact
      actions={
        <Space size={spacingToNumber(spacing[2])} wrap>
          <Dropdown
            disabled={exportLoading}
            menu={{
              items: [
                {
                  key: 'csv',
                  label: 'Export CSV',
                  icon: <GatewayIcon name="DownloadOutlined" />,
                  onClick: () => handleExport('csv'),
                },
                {
                  key: 'json',
                  label: 'Export JSON',
                  icon: <GatewayIcon name="DownloadOutlined" />,
                  onClick: () => handleExport('json'),
                },
              ],
            }}
          >
            <Button icon={<GatewayIcon name="DownloadOutlined" />} disabled={exportLoading} size="small">
              Export logs
            </Button>
          </Dropdown>
          <Button
            icon={<GatewayIcon name="ReloadOutlined" />}
            onClick={handleRefresh}
            loading={isFetching}
            size="small"
          >
            Refresh
          </Button>
          <Button icon={<GatewayIcon name="ClearOutlined" />} onClick={handleClearFilters} size="small">
            Clear Filters
          </Button>
        </Space>
      }
    >
      <Card
        style={{ ...cardStyle, marginBottom: spacing[2], padding: `${spacing['1.5']} ${spacing[3]}` }}
        styles={{ body: { padding: 'var(--spacing-0)' } }}
      >
        <div className="alert-center-summary">
          <dl className="alert-center-metrics" aria-label="Alert totals">
            <div>
              <dt>Total alerts</dt>
              <dd>{stats.total}</dd>
            </div>
            <div>
              <dt>Delivered</dt>
              <dd>{stats.sent}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{stats.failed}</dd>
            </div>
            <div>
              <dt>Skipped</dt>
              <dd>{stats.skipped}</dd>
            </div>
          </dl>
          <dl className="alert-center-metadata" aria-label="Alert configuration status">
            <div>
              <dt>Next run</dt>
              <dd>
                {alertStatus?.nextRunAt
                  ? formatDateTime(alertStatus.nextRunAt)
                  : alertStatus?.enabled
                    ? '—'
                    : 'Disabled'}
              </dd>
            </div>
            <div>
              <dt>Last run</dt>
              <dd>{alertStatus?.lastRunLog?.status ? <AlertStatus status={alertStatus.lastRunLog.status} /> : '—'}</dd>
            </div>
            <div>
              <dt>Last run failures</dt>
              <dd>
                {typeof alertStatus?.lastRunLog?.totalFailures === 'number'
                  ? alertStatus.lastRunLog.totalFailures
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>
                {uiConfig?.notifications?.failureEmailReports?.email || tenantInfo?.tenantEmail || 'Not configured'}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          isNarrow={isNarrow}
          label="Search alert logs"
          placeholder="Search subject, recipient, or error"
          width={280}
        />
        <Select
          allowClear
          placeholder="Status"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value || undefined)}
          options={STATUS_OPTIONS}
          className="alert-center-short-filter"
          size="small"
        />
        <Select
          allowClear
          placeholder="Channel"
          value={channelFilter}
          onChange={(value) => setChannelFilter(value || undefined)}
          options={CHANNEL_OPTIONS}
          className="alert-center-short-filter"
          size="small"
        />
        <Select
          allowClear
          placeholder="Type"
          value={typeFilter}
          onChange={(value) => setTypeFilter(value || undefined)}
          options={typeOptions}
          className="alert-center-wide-filter"
          size="small"
        />
        <RangePicker
          className="alert-center-wide-filter"
          size="small"
          presets={[
            {
              label: 'Last 24h',
              value: [dayjs().subtract(1, 'day'), dayjs()],
            },
            {
              label: 'Last 7d',
              value: [dayjs().subtract(7, 'day'), dayjs()],
            },
            {
              label: 'Last 30d',
              value: [dayjs().subtract(30, 'day'), dayjs()],
            },
          ]}
          value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : null}
          onChange={(_, dateStrings) => {
            if (dateStrings[0] && dateStrings[1]) {
              setDateRange([dateStrings[0], dateStrings[1]]);
            } else {
              setDateRange(null);
            }
          }}
        />
      </FilterBar>

      <div className="full-bleed-table">
        <Card style={cardStyle}>
          <ModernTable<AlertCenterLog>
            rowKey="id"
            dataSource={logs}
            columns={columns}
            loading={isFetching}
            pagination={getPaginationConfig(logs.length)}
            scroll={{ x: 900 }}
            size="small"
          />
        </Card>
      </div>

      <Drawer
        open={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title="Alert Details"
        width={isNarrow ? '100%' : 720}
        destroyOnClose
      >
        {selectedLog ? (
          <div className="alert-center-detail-stack">
            <Descriptions column={1} size="small" labelStyle={{ width: 160, color: cssVar.text.secondary }}>
              <Descriptions.Item label="Status">
                <AlertStatus status={selectedLog.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Channel">{selectedLog.channel || '—'}</Descriptions.Item>
              <Descriptions.Item label="Type">
                {TYPE_LABELS[selectedLog.type] || selectedLog.type || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Subject">{selectedLog.subject || '—'}</Descriptions.Item>
              <Descriptions.Item label="Recipients">
                {(selectedLog.recipients || []).join(', ') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Total Failures">
                {typeof selectedLog.totalFailures === 'number' ? selectedLog.totalFailures : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Window">
                {selectedLog.windowStart && selectedLog.windowEnd
                  ? `${formatDateTime(selectedLog.windowStart)} → ${formatDateTime(selectedLog.windowEnd)}`
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Created At">{formatDateTime(selectedLog.createdAt)}</Descriptions.Item>
              {selectedLog.providerUrl && (
                <Descriptions.Item label="Provider URL">
                  <Text type="code" className="console-word-break-all">
                    {selectedLog.providerUrl}
                  </Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            <Divider />

            {selectedLog.errorMessage && (
              <div>
                <div className="console-flex-between-center">
                  <Text weight="semibold">Error Message</Text>
                  <Button size="small" onClick={() => copyToClipboard(selectedLog.errorMessage || '', 'Error message')}>
                    Copy
                  </Button>
                </div>
                <div className="alert-center-error-detail">
                  <Text className="alert-center-code-content">{selectedLog.errorMessage}</Text>
                </div>
              </div>
            )}

            {selectedLog.errorStack && (
              <div>
                <div className="console-flex-between-center">
                  <Text weight="semibold">Error Stack</Text>
                  <Button size="small" onClick={() => copyToClipboard(selectedLog.errorStack || '', 'Error stack')}>
                    Copy
                  </Button>
                </div>
                <div className="alert-center-detail-surface alert-center-detail-surface--spaced">
                  <Text type="code" className="alert-center-code-content">
                    {selectedLog.errorStack}
                  </Text>
                </div>
              </div>
            )}

            {selectedLog.payload && (
              <Collapse
                size="small"
                ghost
                activeKey={payloadExpanded ? ['payload'] : []}
                onChange={(keys) => setPayloadExpanded(Array.isArray(keys) && keys.includes('payload'))}
                expandIcon={() => null}
                items={[
                  {
                    key: 'payload',
                    label: 'Payload',
                    extra: (
                      <Button
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyToClipboard(JSON.stringify(selectedLog.payload, null, 2), 'Payload');
                        }}
                      >
                        Copy JSON
                      </Button>
                    ),
                    children: (
                      <div className="alert-center-detail-surface">
                        <pre className="clamped-code-block alert-center-code-block">
                          <code
                            className="clamped-code-inline console-display-block"
                            dangerouslySetInnerHTML={{ __html: formatJsonForDisplay(selectedLog.payload) }}
                          />
                        </pre>
                      </div>
                    ),
                  },
                ]}
              />
            )}

            {selectedLog.providerResponse && (
              <Collapse
                size="small"
                ghost
                activeKey={providerResponseExpanded ? ['providerResponse'] : []}
                onChange={(keys) =>
                  setProviderResponseExpanded(Array.isArray(keys) && keys.includes('providerResponse'))
                }
                expandIcon={() => null}
                items={[
                  {
                    key: 'providerResponse',
                    label: (
                      <Space size={spacingToNumber(spacing[2])}>
                        <span>Provider Response</span>
                        <Text type="supporting" color="secondary">
                          HTTP {selectedLog.providerResponse.status}
                        </Text>
                      </Space>
                    ),
                    extra: (
                      <Button
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyToClipboard(selectedLog.providerResponse?.body || '', 'Provider response');
                        }}
                      >
                        Copy
                      </Button>
                    ),
                    children: (
                      <div className="alert-center-detail-surface">
                        <pre className="clamped-code-block alert-center-code-block">
                          <code
                            className="clamped-code-inline console-display-block"
                            dangerouslySetInnerHTML={{
                              __html: formatTextOrJsonForDisplay(selectedLog.providerResponse.body) || '(empty)',
                            }}
                          />
                        </pre>
                      </div>
                    ),
                  },
                ]}
              />
            )}

            {!selectedLog.errorMessage &&
              !selectedLog.errorStack &&
              !selectedLog.payload &&
              !selectedLog.providerResponse && (
                <div className="alert-center-empty-detail">
                  <Text type="supporting" color="secondary">
                    No additional details available for this alert.
                  </Text>
                </div>
              )}
          </div>
        ) : (
          <StatePanel glyph="connecting" tone="busy" title="Loading alert details" />
        )}
      </Drawer>
    </PageTemplate>
  );
};
