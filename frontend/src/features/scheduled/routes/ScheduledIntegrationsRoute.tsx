import { useMemo, useState, useCallback, useRef } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import {
  App,
  Card,
  Input,
  Select,
  Space,
  Divider,
  Grid,
  Modal,
  DatePicker,
  Drawer,
  Form,
  Tooltip,
  Badge,
} from '@/components/common/LegacyAntdControls';
import { Tab, TabList } from '@astryxdesign/core';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { ModernTable } from '../../../components/common/ModernTable';
import { StatPillRow } from '../../../components/common/StatPillRow';
import { StatePanel } from '../../../components/common/StatePanel';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { InlineHint } from '../../../components/common/InlineHint';
import {
  getScheduledIntegrations,
  deleteScheduledIntegration,
  bulkDeleteScheduledIntegrations,
  getIntegrations,
  updateScheduledIntegration,
  getScheduledIntegrationStats,
  retryScheduledIntegration,
  exportScheduledIntegrationsToCsv,
} from '../../../services/api';
import { createExportProgress } from '../../../utils/export-progress';
import type { ScheduledIntegration } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { cssVar, useDesignTokens, withAlpha, spacingToNumber } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Button } from '../../../components/common/LegacyButton';

dayjs.extend(relativeTime);

const { Text, Paragraph } = Typography;

// ─── helpers ───────────────────────────────────────────────────────────────

const getStatusIcon = (status: ScheduledIntegration['status']) => {
  switch (status) {
    case 'PENDING':
      return <GatewayIcon name="ClockCircleOutlined" />;
    case 'OVERDUE':
      return <GatewayIcon name="ExclamationCircleOutlined" />;
    case 'SENT':
      return <GatewayIcon name="CheckCircleOutlined" />;
    case 'FAILED':
      return <GatewayIcon name="CloseCircleOutlined" />;
    case 'CANCELLED':
      return <GatewayIcon name="StopOutlined" />;
    default:
      return <GatewayIcon name="ClockCircleOutlined" />;
  }
};

const getStatusLabel = (status: ScheduledIntegration['status']) =>
  status === 'SENT' ? 'Delivered' : status.charAt(0) + status.slice(1).toLowerCase();

const getStatusVariant = (status: ScheduledIntegration['status']) => {
  switch (status) {
    case 'SENT':
      return 'success' as const;
    case 'FAILED':
      return 'error' as const;
    case 'OVERDUE':
      return 'warning' as const;
    case 'PENDING':
      return 'warning' as const;
    default:
      return 'neutral' as const;
  }
};

const statusExplanation = (record: ScheduledIntegration): string => {
  switch (record.status) {
    case 'PENDING':
      return `Waiting to fire at ${formatDateTime(record.scheduledFor)}.`;
    case 'OVERDUE':
      return `Was scheduled for ${formatDateTime(record.scheduledFor)} but has not fired yet. The worker may be busy or restarting.`;
    case 'SENT':
      return `Delivered successfully${record.deliveredAt ? ` at ${formatDateTime(record.deliveredAt)}` : ''}.`;
    case 'FAILED':
      return `Delivery failed${record.attemptCount ? ` after ${record.attemptCount} attempt(s)` : ''}.${record.errorMessage ? '' : ' No error detail available.'}`;
    case 'CANCELLED':
      return `Manually cancelled${record.cancellationInfo ? ' due to appointment change.' : '.'}`;
    default:
      return 'Unknown status.';
  }
};

// ─── detail drawer ─────────────────────────────────────────────────────────

interface DetailDrawerProps {
  record: ScheduledIntegration | null;
  onClose: () => void;
  onRetry: (record: ScheduledIntegration) => void;
  onCancel: (record: ScheduledIntegration) => void;
  onEditTime: (record: ScheduledIntegration) => void;
  navigateTo: (path: string) => void;
  colors: Record<string, Record<number, string>>;
}

const DetailDrawer = ({ record, onClose, onRetry, onCancel, onEditTime, navigateTo, colors }: DetailDrawerProps) => {
  const { spacing } = useDesignTokens();
  if (!record) return null;

  const canEdit = record.status === 'PENDING' || record.status === 'OVERDUE';
  const canCancel = record.status === 'PENDING' || record.status === 'OVERDUE';
  const canRetry = record.status === 'FAILED';

  return (
    <Drawer
      title={
        <Space>
          <StatusBadge
            status={record.status}
            label={getStatusLabel(record.status)}
            variant={getStatusVariant(record.status)}
            size="small"
          />
          <Text strong className="console-type-control">
            {record.integrationName || 'Scheduled Delivery'}
          </Text>
        </Space>
      }
      open={!!record}
      onClose={onClose}
      width={520}
      extra={
        <Space>
          {canEdit && (
            <Button size="small" icon={<GatewayIcon name="EditOutlined" />} onClick={() => onEditTime(record)}>
              Reschedule
            </Button>
          )}
          {canRetry && (
            <Button
              size="small"
              type="primary"
              icon={<GatewayIcon name="RetweetOutlined" />}
              onClick={() => onRetry(record)}
            >
              Retry
            </Button>
          )}
          {canCancel && (
            <Button size="small" danger icon={<GatewayIcon name="DeleteOutlined" />} onClick={() => onCancel(record)}>
              Cancel
            </Button>
          )}
        </Space>
      }
    >
      <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
        {/* Status explanation */}
        <InlineHint
          tone={
            record.status === 'FAILED'
              ? 'error'
              : record.status === 'OVERDUE'
                ? 'warning'
                : record.status === 'SENT'
                  ? 'success'
                  : 'info'
          }
        >
          {statusExplanation(record)}
        </InlineHint>

        {/* Error detail */}
        {record.errorMessage && (
          <div>
            <Text type="secondary" className="console-caption-block-margin-bottom-1">
              Error
            </Text>
            <div className="scheduled-error-detail">{record.errorMessage}</div>
            {record.attemptCount !== undefined && record.attemptCount > 1 && (
              <Text type="secondary" className="console-type-caption">
                Failed after {record.attemptCount} attempt(s)
              </Text>
            )}
          </div>
        )}

        {/* Retry history */}
        {record.retryReason && (
          <div>
            <Text type="secondary" className="console-caption-block-margin-bottom-1">
              Last Retry Reason
            </Text>
            <Text className="console-type-caption">{record.retryReason}</Text>
            {record.retriedAt && (
              <Text type="secondary" className="console-caption-block">
                Retried {dayjs(record.retriedAt).fromNow()}
              </Text>
            )}
          </div>
        )}

        <Divider className="console-margin-y-1" />

        {/* Timing */}
        <div className="scheduled-detail-timing-grid">
          <Text type="secondary" className="console-type-caption">
            Scheduled For
          </Text>
          <Text className="console-type-caption">
            {formatDateTime(record.scheduledFor)}
            <Text type="secondary" className="console-margin-left-1">
              ({dayjs(record.scheduledFor).fromNow()})
            </Text>
          </Text>

          <Text type="secondary" className="console-type-caption">
            Event Type
          </Text>
          <Text>{record.eventType}</Text>

          <Text type="secondary" className="console-type-caption">
            Target URL
          </Text>
          <Text className="console-type-caption console-word-break-all" ellipsis={{ tooltip: record.targetUrl }}>
            {record.targetUrl}
          </Text>

          {record.deliveredAt && (
            <>
              <Text type="secondary" className="console-type-caption">
                Delivered At
              </Text>
              <Text className="console-type-caption">{formatDateTime(record.deliveredAt)}</Text>
            </>
          )}

          <Text type="secondary" className="console-type-caption">
            Created
          </Text>
          <Text className="console-type-caption">{formatDateTime(record.createdAt)}</Text>
        </div>

        <Divider className="console-margin-y-1" />

        {/* Deep links */}
        <div>
          <Text type="secondary" className="console-caption-block-margin-bottom-1">
            Links
          </Text>
          <Space direction="vertical" size={4}>
            {record.integrationConfigId && (
              <Button
                type="link"
                size="small"
                icon={<GatewayIcon name="LinkOutlined" />}
                onClick={() => navigateTo(`/integrations/${record.integrationConfigId}`)}
                className="console-control-reset-padding"
              >
                View Source Integration
              </Button>
            )}
            {record.originalEventId && (
              <Button
                type="link"
                size="small"
                icon={<GatewayIcon name="LinkOutlined" />}
                onClick={() => navigateTo(`/logs?search=${record.originalEventId}`)}
                className="console-control-reset-padding"
              >
                Find Original Event (ID: {record.originalEventId})
              </Button>
            )}
            {record.deliveryLogId && (
              <Button
                type="link"
                size="small"
                icon={<GatewayIcon name="LinkOutlined" />}
                onClick={() => navigateTo(`/logs?search=${record.deliveryLogId}`)}
                className="console-control-reset-padding"
              >
                View Delivery Log
              </Button>
            )}
          </Space>
        </div>

        {/* Cancellation info */}
        {record.cancellationInfo && (
          <>
            <Divider className="console-margin-y-1" />
            <div>
              <Text type="secondary" className="console-caption-block-margin-bottom-1">
                Cancellation Info
              </Text>
              {record.cancellationInfo.entityId && (
                <Text className="console-caption-block">Entity ID: {record.cancellationInfo.entityId}</Text>
              )}
              {record.cancellationInfo.scheduledDateTime && (
                <Text className="console-caption-block">
                  Appointment time: {formatDateTime(record.cancellationInfo.scheduledDateTime)}
                </Text>
              )}
            </div>
          </>
        )}

        {/* Payload */}
        {record.payload && (
          <>
            <Divider className="console-margin-y-1" />
            <div>
              <Text type="secondary" className="console-caption-block-margin-bottom-1">
                Payload
              </Text>
              <div className="console-mono-caption">
                <pre className="clamped-code-block console-margin-none">{JSON.stringify(record.payload, null, 2)}</pre>
              </div>
            </div>
          </>
        )}
      </Space>
    </Drawer>
  );
};

// ─── main component ─────────────────────────────────────────────────────────

export const ScheduledIntegrationsRoute = () => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const { message: msgApi, modal } = App.useApp();
  const navigate = useNavigateWithParams();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [integrationFilter, setIntegrationFilter] = useState<string>();
  const [eventTypeFilter, setEventTypeFilter] = useState<string>();
  const [search, setSearch] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingScheduledFor, setEditingScheduledFor] = useState<dayjs.Dayjs | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'failures'>('all');

  // Drawer state
  const [drawerRecord, setDrawerRecord] = useState<ScheduledIntegration | null>(null);

  // Cancel reason modal state
  const [cancelTarget, setCancelTarget] = useState<ScheduledIntegration | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // Retry reason modal state
  const [retryTarget, setRetryTarget] = useState<ScheduledIntegration | null>(null);
  const [retryReason, setRetryReason] = useState('');

  const {
    data: scheduledIntegrations = [],
    refetch: refetchScheduled,
    isFetching: scheduledFetching,
  } = useQuery<ScheduledIntegration[]>({
    queryKey: ['scheduled-integrations', statusFilter, integrationFilter, eventTypeFilter],
    queryFn: () =>
      getScheduledIntegrations({
        status: statusFilter,
        integrationConfigId: integrationFilter,
        eventType: eventTypeFilter,
        limit: 500,
      }),
    staleTime: 30_000,
  });

  const { data: stats = { total: 0, pending: 0, overdue: 0, sent: 0, failed: 0, cancelled: 0 } } = useQuery({
    queryKey: ['scheduled-integrations-stats', integrationFilter, eventTypeFilter],
    queryFn: () =>
      getScheduledIntegrationStats({
        integrationConfigId: integrationFilter,
        eventType: eventTypeFilter,
      }),
    staleTime: 30_000,
  });

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => getIntegrations(),
    staleTime: 60_000,
  });

  const retryMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => retryScheduledIntegration(id, reason),
    onSuccess: () => {
      msgApi.success('Queued for retry — will fire in ~30 seconds');
      void queryClient.invalidateQueries({ queryKey: ['scheduled-integrations'] });
      void queryClient.invalidateQueries({ queryKey: ['scheduled-integrations-stats'] });
      setRetryTarget(null);
      setRetryReason('');
      setDrawerRecord(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to retry';
      msgApi.error(msg);
    },
  });

  const filtered = useMemo(() => {
    let result = scheduledIntegrations;

    if (activeTab === 'failures') {
      result = result.filter((sw) => sw.status === 'FAILED' || sw.status === 'OVERDUE');
    } else if (statusFilter !== 'CANCELLED') {
      result = result.filter((sw) => sw.status !== 'CANCELLED');
    }

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter((sw) => {
        const searchableFields = [
          sw.integrationName,
          sw.__KEEP_integrationName__,
          sw.eventType,
          sw.targetUrl,
          sw.status,
          sw.originalEventId,
          sw.errorMessage,
          sw.id,
          sw.payload ? JSON.stringify(sw.payload) : '',
          sw.recurringConfig ? JSON.stringify(sw.recurringConfig) : '',
          sw.cancellationInfo ? JSON.stringify(sw.cancellationInfo) : '',
        ];
        return searchableFields.filter(Boolean).some((field) => String(field).toLowerCase().includes(searchLower));
      });
    }

    return result;
  }, [scheduledIntegrations, search, statusFilter, activeTab]);

  // Failure groups for failures tab header
  const failureCount = useMemo(
    () => scheduledIntegrations.filter((sw) => sw.status === 'FAILED' || sw.status === 'OVERDUE').length,
    [scheduledIntegrations]
  );

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    scheduledIntegrations.forEach((sw) => types.add(sw.eventType));
    return Array.from(types).sort();
  }, [scheduledIntegrations]);

  const handleEditScheduledFor = useCallback((record: ScheduledIntegration) => {
    setEditingRowId(record.id);
    setEditingScheduledFor(dayjs(record.scheduledFor));
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingRowId(null);
    setEditingScheduledFor(null);
  }, []);

  const handleSaveScheduledFor = useCallback(
    async (recordId: string) => {
      if (!editingScheduledFor) {
        msgApi.error('Please select a valid date and time');
        return;
      }
      const normalizedDate = editingScheduledFor.second(0).millisecond(0);
      const diffMs = normalizedDate.valueOf() - Date.now();
      const diffLabel =
        diffMs < 0 ? 'in the past (will be OVERDUE immediately)' : `in ${dayjs(normalizedDate).fromNow(true)}`;

      modal.confirm({
        title: 'Confirm Reschedule',
        content: (
          <Space direction="vertical" size={4}>
            <Text>
              New time: <Text strong>{normalizedDate.format('YYYY-MM-DD HH:mm')}</Text>
            </Text>
            <Text type={diffMs < 0 ? 'danger' : 'secondary'}>Fires {diffLabel}</Text>
          </Space>
        ),
        okText: 'Reschedule',
        cancelText: 'Keep Current',
        onOk: async () => {
          try {
            await updateScheduledIntegration(recordId, { scheduledFor: normalizedDate.toISOString() });
            msgApi.success('Scheduled time updated');
            setEditingRowId(null);
            setEditingScheduledFor(null);
            refetchScheduled();
          } catch (error) {
            msgApi.error(error instanceof Error ? error.message : 'Failed to update');
          }
        },
      });
    },
    [editingScheduledFor, modal, msgApi, refetchScheduled]
  );

  const openCancelModal = useCallback((record: ScheduledIntegration) => {
    setCancelTarget(record);
    setCancelReason('');
  }, []);

  const handleCancelConfirm = useCallback(async () => {
    if (!cancelTarget) return;
    try {
      await deleteScheduledIntegration(cancelTarget.id, cancelReason.trim() || undefined);
      msgApi.success('Scheduled event cancelled');
      setCancelTarget(null);
      setCancelReason('');
      setDrawerRecord(null);
      refetchScheduled();
      void queryClient.invalidateQueries({ queryKey: ['scheduled-integrations-stats'] });
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'Failed to cancel');
    }
  }, [cancelTarget, cancelReason, msgApi, refetchScheduled, queryClient]);

  const openRetryModal = useCallback((record: ScheduledIntegration) => {
    setRetryTarget(record);
    setRetryReason('');
  }, []);

  const handleRetryConfirm = useCallback(() => {
    if (!retryTarget || retryReason.trim().length < 3) return;
    retryMutation.mutate({ id: retryTarget.id, reason: retryReason.trim() });
  }, [retryTarget, retryReason, retryMutation]);

  const handleBulkDelete = useCallback(() => {
    modal.confirm({
      title: 'Bulk Cancel Scheduled Events',
      content: `Cancel ${selectedRowKeys.length} scheduled event(s)? This cannot be undone.`,
      okText: 'Cancel Events',
      okType: 'danger',
      cancelText: 'Keep',
      onOk: async () => {
        try {
          const result = await bulkDeleteScheduledIntegrations(selectedRowKeys as string[]);
          msgApi.success(`Cancelled ${result.deletedCount} event(s)`);
          if (result.failedIds.length > 0) {
            msgApi.warning(`Failed to cancel ${result.failedIds.length} event(s)`);
          }
          setSelectedRowKeys([]);
          refetchScheduled();
          void queryClient.invalidateQueries({ queryKey: ['scheduled-integrations-stats'] });
        } catch (error) {
          msgApi.error(error instanceof Error ? error.message : 'Failed to cancel events');
        }
      },
    });
  }, [modal, msgApi, selectedRowKeys, refetchScheduled, queryClient]);

  const handleQuickStatusFilter = (status: string) => {
    setStatusFilter(statusFilter === status ? undefined : status);
  };

  const handleExportCsv = async () => {
    if (exportLoading) return;
    setExportLoading(true);
    try {
      const { onProgress, finish } = createExportProgress(msgApi, 'Export CSV');
      await exportScheduledIntegrationsToCsv(
        {
          status: statusFilter || undefined,
          integrationConfigId: integrationFilter || undefined,
          eventType: eventTypeFilter || undefined,
        },
        { onProgress }
      );
      finish('Export complete');
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        title: 'Scheduled For',
        dataIndex: 'scheduledFor',
        key: 'scheduledFor',
        width: 280,
        sorter: (a: ScheduledIntegration, b: ScheduledIntegration) =>
          new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime(),
        defaultSortOrder: 'ascend' as const,
        render: (scheduledFor: string, record: ScheduledIntegration) => {
          const isEditing = editingRowId === record.id;
          const canEdit = record.status === 'PENDING' || record.status === 'OVERDUE';
          if (isEditing) {
            return (
              <Space size="small">
                <DatePicker
                  showTime={{ format: 'HH:mm', defaultValue: dayjs('00:00', 'HH:mm') }}
                  value={editingScheduledFor}
                  onChange={(date) => setEditingScheduledFor(date)}
                  format="YYYY-MM-DD HH:mm"
                  size="small"
                  className="scheduled-date-editor"
                  onClick={(e) => e.stopPropagation()}
                  showNow={false}
                />
                <Button
                  type="primary"
                  size="small"
                  icon={<GatewayIcon name="SaveOutlined" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveScheduledFor(record.id);
                  }}
                />
                <Button
                  size="small"
                  icon={<GatewayIcon name="CloseOutlined" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancelEdit();
                  }}
                />
              </Space>
            );
          }
          return (
            <Space size={4}>
              <Text className="console-white-space-nowrap">{formatDateTime(scheduledFor)}</Text>
              <Text type="secondary" className="console-type-caption console-white-space-nowrap">
                {dayjs(scheduledFor).fromNow()}
              </Text>
              {canEdit && (
                <Button
                  type="text"
                  size="small"
                  icon={<GatewayIcon name="EditOutlined" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditScheduledFor(record);
                  }}
                  className="scheduled-inline-edit-button"
                />
              )}
            </Space>
          );
        },
      },
      {
        title: 'Integration',
        dataIndex: 'integrationName',
        key: 'integrationName',
        width: 220,
        ellipsis: true,
        render: (name: string, record: ScheduledIntegration) => (
          <Button
            type="link"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/integrations/${record.integrationConfigId}`);
            }}
            className="scheduled-integration-link"
          >
            {name}
          </Button>
        ),
      },
      {
        title: 'Event Type',
        dataIndex: 'eventType',
        key: 'eventType',
        width: 180,
        render: (eventType: string) => <Text>{eventType}</Text>,
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (status: ScheduledIntegration['status'], record: ScheduledIntegration) => (
          <Space size={4}>
            <StatusBadge
              status={status}
              label={getStatusLabel(status)}
              variant={getStatusVariant(status)}
              size="small"
            />
            {record.errorMessage && (
              <Tooltip title={record.errorMessage}>
                <GatewayIcon size="xsm" name="InfoCircleOutlined" className="console-text-error" />
              </Tooltip>
            )}
          </Space>
        ),
      },
      {
        title: 'Actions',
        key: 'actions',
        width: 130,
        fixed: 'right' as const,
        render: (_: unknown, record: ScheduledIntegration) => (
          <Space size={4}>
            {record.status === 'FAILED' && (
              <Button
                type="text"
                size="small"
                icon={<GatewayIcon name="RetweetOutlined" />}
                onClick={(e) => {
                  e.stopPropagation();
                  openRetryModal(record);
                }}
                className="console-text-info"
              >
                Retry
              </Button>
            )}
            {(record.status === 'PENDING' || record.status === 'OVERDUE') && (
              <Button
                type="text"
                danger
                size="small"
                icon={<GatewayIcon name="DeleteOutlined" />}
                onClick={(e) => {
                  e.stopPropagation();
                  openCancelModal(record);
                }}
              >
                Cancel
              </Button>
            )}
          </Space>
        ),
      },
    ],
    [
      editingRowId,
      editingScheduledFor,
      colors,
      navigate,
      handleEditScheduledFor,
      handleCancelEdit,
      handleSaveScheduledFor,
      openCancelModal,
      openRetryModal,
    ]
  );

  return (
    <PageTemplate
      className="scheduled-deliveries-template"
      header={
        <PageHeader
          title="Delayed Deliveries"
          description={`Individual deliveries held until a specific future time by a real-time event (e.g. an appointment reminder). For recurring cron-based batch jobs, see Scheduled Jobs. ${filtered.length} shown${failureCount > 0 ? `, ${failureCount} need attention` : ''}. Click any row to inspect details.`}
          compact
          actions={
            <Space>
              <Button
                icon={<GatewayIcon name="DownloadOutlined" />}
                onClick={handleExportCsv}
                loading={exportLoading}
                disabled={scheduledFetching}
                size="small"
              >
                Export
              </Button>
              <Button
                icon={<GatewayIcon name="ReloadOutlined" />}
                loading={scheduledFetching}
                onClick={() => refetchScheduled()}
                size="small"
              >
                Refresh
              </Button>
            </Space>
          }
        />
      }
    >
      {/* Stats strip */}
      {scheduledFetching ? (
        <StatePanel glyph="connecting" tone="busy" title="Loading scheduled deliveries" size="compact" />
      ) : (
        <div className="console-margin-bottom-2">
          <StatPillRow
            activeFilter={statusFilter}
            onFilterChange={(filter) => {
              setActiveTab('all');
              filter ? handleQuickStatusFilter(filter) : setStatusFilter(undefined);
            }}
            items={[
              {
                title: 'Total',
                value: stats.total,
                icon: <GatewayIcon name="DatabaseOutlined" />,
                tone: cssVar.text.secondary,
                filterValue: null,
              },
              {
                title: 'Pending',
                value: stats.pending,
                icon: getStatusIcon('PENDING'),
                tone: colors.info[600],
                filterValue: 'PENDING',
              },
              {
                title: 'Overdue',
                value: stats.overdue,
                icon: getStatusIcon('OVERDUE'),
                tone: colors.warning[600],
                filterValue: 'OVERDUE',
              },
              {
                title: 'Sent',
                value: stats.sent,
                icon: getStatusIcon('SENT'),
                tone: colors.success[600],
                filterValue: 'SENT',
              },
              {
                title: 'Failed',
                value: stats.failed,
                icon: getStatusIcon('FAILED'),
                tone: colors.error[600],
                filterValue: 'FAILED',
              },
              {
                title: 'Cancelled',
                value: stats.cancelled,
                icon: getStatusIcon('CANCELLED'),
                tone: colors.warning[600],
                filterValue: 'CANCELLED',
              },
            ]}
          />
        </div>
      )}

      {/* Filters */}
      <Card className="scheduled-panel scheduled-panel--spaced">
        <Space
          direction={isNarrow ? 'vertical' : 'horizontal'}
          size={spacingToNumber(spacing[2])}
          className="scheduled-filter-fields"
        >
          {scheduledFetching ? (
            <StatePanel glyph="connecting" tone="busy" title="Loading filters" size="compact" />
          ) : (
            <>
              <Select
                placeholder="Filter by status"
                allowClear
                value={statusFilter}
                onChange={(v) => {
                  setActiveTab('all');
                  setStatusFilter(v);
                }}
                className="scheduled-status-filter"
                size="small"
                options={[
                  { value: 'PENDING', label: 'Pending' },
                  { value: 'OVERDUE', label: 'Overdue' },
                  { value: 'SENT', label: 'Sent' },
                  { value: 'FAILED', label: 'Failed' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
              />
              <Select
                placeholder="Filter by integration"
                allowClear
                showSearch
                value={integrationFilter}
                onChange={setIntegrationFilter}
                className="scheduled-integration-filter"
                size="small"
                options={integrations.map((w) => ({ value: w.id, label: w.name }))}
              />
              <Select
                placeholder="Filter by event type"
                allowClear
                showSearch
                value={eventTypeFilter}
                onChange={setEventTypeFilter}
                className="scheduled-event-filter"
                size="small"
                options={eventTypes.map((et) => ({ value: et, label: et }))}
              />
              <Input.Search
                placeholder="Search name, event, URL, payload, error, ID…"
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="scheduled-search-filter"
                size="small"
              />
            </>
          )}
        </Space>
      </Card>

      {/* Bulk actions */}
      {selectedRowKeys.length > 0 && (
        <Card className="scheduled-panel scheduled-panel--spaced scheduled-selection-panel">
          <Space className="console-width-full-between-wrap">
            <Space>
              <Text strong>{selectedRowKeys.length} selected</Text>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>
                Clear
              </Button>
            </Space>
            <Button danger icon={<GatewayIcon name="DeleteOutlined" />} onClick={handleBulkDelete}>
              Bulk Cancel
            </Button>
          </Space>
        </Card>
      )}

      {/* Tabs: All vs Failures */}
      <TabList
        role="tablist"
        aria-label="Scheduled delivery views"
        value={activeTab}
        onChange={(value) => {
          setActiveTab(value as 'all' | 'failures');
          setStatusFilter(undefined);
        }}
        size="sm"
        hasDivider
      >
        <Tab
          id="scheduled-deliveries-all-tab"
          value="all"
          label="All Deliveries"
          panelId="scheduled-delivery-results-panel"
        />
        <Tab
          id="scheduled-deliveries-failures-tab"
          value="failures"
          label="Failures & Overdue"
          icon={
            <GatewayIcon
              name="FireOutlined"
              aria-hidden="true"
              className={failureCount > 0 ? 'console-text-error' : undefined}
            />
          }
          endContent={failureCount > 0 ? <Badge count={failureCount} size="small" /> : undefined}
          panelId="scheduled-delivery-results-panel"
        />
      </TabList>

      <div
        id="scheduled-delivery-results-panel"
        role="tabpanel"
        aria-labelledby={activeTab === 'all' ? 'scheduled-deliveries-all-tab' : 'scheduled-deliveries-failures-tab'}
        tabIndex={0}
      >
        {/* Empty state for failures tab */}
        {activeTab === 'failures' && filtered.length === 0 && !scheduledFetching && (
          <Card className="scheduled-panel">
            <div className="console-empty-centered">
              <GatewayIcon name="CheckCircleOutlined" className="console-icon-empty-success" />
              <Text type="secondary" className="console-display-block">
                No failed or overdue deliveries — all clear.
              </Text>
            </div>
          </Card>
        )}

        {/* Table */}
        {(activeTab === 'all' || filtered.length > 0) && (
          <div className="full-bleed-table">
            <ModernTable
              key={`${activeTab}-${statusFilter ?? 'all'}-${integrationFilter ?? 'all'}-${eventTypeFilter ?? 'all'}-${search}`}
              dataSource={filtered}
              rowKey="id"
              rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys) }}
              scroll={{ x: 950 }}
              loading={scheduledFetching}
              size="small"
              onRow={(record) => ({
                onClick: () => {
                  if (editingRowId !== record.id) {
                    setDrawerRecord(record);
                  }
                },
                style: { cursor: 'pointer' },
              })}
              pagination={{
                defaultPageSize: 20,
                showSizeChanger: true,
                pageSizeOptions: ['10', '20', '50', '100'],
                showTotal: (total) => `${total} deliveries`,
              }}
              columns={columns}
            />
          </div>
        )}
      </div>

      {/* Detail drawer */}
      <DetailDrawer
        record={drawerRecord}
        onClose={() => setDrawerRecord(null)}
        onRetry={(r) => {
          setDrawerRecord(null);
          openRetryModal(r);
        }}
        onCancel={(r) => {
          setDrawerRecord(null);
          openCancelModal(r);
        }}
        onEditTime={(r) => {
          setDrawerRecord(null);
          handleEditScheduledFor(r);
        }}
        navigateTo={navigate}
        colors={colors}
      />

      {/* Cancel with reason modal */}
      <Modal
        open={!!cancelTarget}
        title="Cancel Scheduled Delivery"
        okText="Cancel Delivery"
        okType="danger"
        cancelText="Keep Scheduled"
        onOk={handleCancelConfirm}
        onCancel={() => {
          setCancelTarget(null);
          setCancelReason('');
        }}
        okButtonProps={{ disabled: false }}
      >
        {cancelTarget && (
          <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
            <Text>
              Cancel <Text strong>{cancelTarget.integrationName}</Text> scheduled for{' '}
              <Text strong>{formatDateTime(cancelTarget.scheduledFor)}</Text>?
            </Text>
            <Form.Item label="Reason (optional)" className="console-margin-bottom-none">
              <Input.TextArea
                placeholder="e.g. Customer cancelled the order, duplicate delivery…"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={2}
                maxLength={300}
                showCount
              />
            </Form.Item>
          </Space>
        )}
      </Modal>

      {/* Retry with reason modal */}
      <Modal
        open={!!retryTarget}
        title="Retry Failed Delivery"
        okText="Retry Now"
        onOk={handleRetryConfirm}
        onCancel={() => {
          setRetryTarget(null);
          setRetryReason('');
        }}
        okButtonProps={{ disabled: retryReason.trim().length < 3, loading: retryMutation.isPending }}
      >
        {retryTarget && (
          <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
            <InlineHint>The delivery will be rescheduled to fire in about 30 seconds.</InlineHint>
            {retryTarget.errorMessage && (
              <div>
                <Text type="secondary" className="console-type-caption">
                  Previous error:
                </Text>
                <Paragraph
                  type="danger"
                  className="console-mono-caption console-margin-top-1 console-margin-bottom-0"
                  ellipsis={{ rows: 3, expandable: true }}
                >
                  {retryTarget.errorMessage}
                </Paragraph>
              </div>
            )}
            <Form.Item
              label="Reason (required)"
              required
              className="console-margin-bottom-none"
              help={
                retryReason.trim().length > 0 && retryReason.trim().length < 3
                  ? 'At least 3 characters required'
                  : undefined
              }
              validateStatus={retryReason.trim().length > 0 && retryReason.trim().length < 3 ? 'error' : undefined}
            >
              <Input.TextArea
                placeholder="e.g. Upstream API recovered, retrying after fix…"
                value={retryReason}
                onChange={(e) => setRetryReason(e.target.value)}
                rows={2}
                maxLength={300}
                showCount
                autoFocus
              />
            </Form.Item>
          </Space>
        )}
      </Modal>
    </PageTemplate>
  );
};
