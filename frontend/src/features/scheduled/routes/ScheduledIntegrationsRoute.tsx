import { useMemo, useState, useCallback, useRef } from 'react';
import {
  App,
  Button,
  Card,
  Input,
  Select,
  Space,
  Tag,
  Typography,
  Divider,
  Grid,
  Modal,
  Skeleton,
  DatePicker,
  Drawer,
  Tabs,
  Alert,
  Form,
  Tooltip,
  Badge,
} from 'antd';
import {
  ClockCircleOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SendOutlined,
  StopOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  RetweetOutlined,
  LinkOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  FireOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { ModernTable } from '../../../components/common/ModernTable';
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

dayjs.extend(relativeTime);

const { Text, Paragraph } = Typography;

// ─── helpers ───────────────────────────────────────────────────────────────

const getStatusIcon = (status: ScheduledIntegration['status']) => {
  switch (status) {
    case 'PENDING':
      return <ClockCircleOutlined />;
    case 'OVERDUE':
      return <ExclamationCircleOutlined />;
    case 'SENT':
      return <CheckCircleOutlined />;
    case 'FAILED':
      return <CloseCircleOutlined />;
    case 'CANCELLED':
      return <StopOutlined />;
    default:
      return <ClockCircleOutlined />;
  }
};

const getStatusColor = (status: ScheduledIntegration['status'], colors: Record<string, Record<number, string>>) => {
  switch (status) {
    case 'PENDING':
      return colors.info[600];
    case 'OVERDUE':
      return colors.warning[600];
    case 'SENT':
      return colors.success[600];
    case 'FAILED':
      return colors.error[600];
    case 'CANCELLED':
      return colors.warning[600];
    default:
      return cssVar.text.secondary;
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
  tagTone: (base: string) => React.CSSProperties;
  colors: Record<string, Record<number, string>>;
}

const DetailDrawer = ({
  record,
  onClose,
  onRetry,
  onCancel,
  onEditTime,
  navigateTo,
  tagTone,
  colors,
}: DetailDrawerProps) => {
  const { spacing, token } = useDesignTokens();
  if (!record) return null;

  const canEdit = record.status === 'PENDING' || record.status === 'OVERDUE';
  const canCancel = record.status === 'PENDING' || record.status === 'OVERDUE';
  const canRetry = record.status === 'FAILED';

  return (
    <Drawer
      title={
        <Space>
          <Tag icon={getStatusIcon(record.status)} style={tagTone(getStatusColor(record.status, colors))}>
            {record.status}
          </Tag>
          <Text strong style={{ fontSize: token.fontSize }}>
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
            <Button size="small" icon={<EditOutlined />} onClick={() => onEditTime(record)}>
              Reschedule
            </Button>
          )}
          {canRetry && (
            <Button size="small" type="primary" icon={<RetweetOutlined />} onClick={() => onRetry(record)}>
              Retry
            </Button>
          )}
          {canCancel && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onCancel(record)}>
              Cancel
            </Button>
          )}
        </Space>
      }
    >
      <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
        {/* Status explanation */}
        <Alert
          type={
            record.status === 'FAILED'
              ? 'error'
              : record.status === 'OVERDUE'
                ? 'warning'
                : record.status === 'SENT'
                  ? 'success'
                  : 'info'
          }
          message={statusExplanation(record)}
          showIcon
        />

        {/* Error detail */}
        {record.errorMessage && (
          <div>
            <Text type="secondary" style={{ fontSize: token.fontSizeSM, display: 'block', marginBottom: spacing[1] }}>
              Error
            </Text>
            <div
              style={{
                background: withAlpha(colors.error[600], 0.06),
                border: `1px solid ${withAlpha(colors.error[600], 0.2)}`,
                borderRadius: token.borderRadius,
                padding: spacing[2],
                fontFamily: 'monospace',
                fontSize: 12,
                color: colors.error[700],
                wordBreak: 'break-word',
              }}
            >
              {record.errorMessage}
            </div>
            {record.attemptCount !== undefined && record.attemptCount > 1 && (
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                Failed after {record.attemptCount} attempt(s)
              </Text>
            )}
          </div>
        )}

        {/* Retry history */}
        {record.retryReason && (
          <div>
            <Text type="secondary" style={{ fontSize: token.fontSizeSM, display: 'block', marginBottom: spacing[1] }}>
              Last Retry Reason
            </Text>
            <Text style={{ fontSize: token.fontSizeSM }}>{record.retryReason}</Text>
            {record.retriedAt && (
              <Text type="secondary" style={{ fontSize: token.fontSizeSM, display: 'block' }}>
                Retried {dayjs(record.retriedAt).fromNow()}
              </Text>
            )}
          </div>
        )}

        <Divider style={{ margin: `${spacing[1]} 0` }} />

        {/* Timing */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr',
            gap: `${spacing[1]} ${spacing[2]}`,
            alignItems: 'start',
          }}
        >
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Scheduled For
          </Text>
          <Text style={{ fontSize: token.fontSizeSM }}>
            {formatDateTime(record.scheduledFor)}
            <Text type="secondary" style={{ marginLeft: spacing[1] }}>
              ({dayjs(record.scheduledFor).fromNow()})
            </Text>
          </Text>

          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Event Type
          </Text>
          <Tag style={tagTone(colors.neutral[600])}>{record.eventType}</Tag>

          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Target URL
          </Text>
          <Text style={{ fontSize: token.fontSizeSM, wordBreak: 'break-all' }} ellipsis={{ tooltip: record.targetUrl }}>
            {record.targetUrl}
          </Text>

          {record.deliveredAt && (
            <>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                Delivered At
              </Text>
              <Text style={{ fontSize: token.fontSizeSM }}>{formatDateTime(record.deliveredAt)}</Text>
            </>
          )}

          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Created
          </Text>
          <Text style={{ fontSize: token.fontSizeSM }}>{formatDateTime(record.createdAt)}</Text>
        </div>

        <Divider style={{ margin: `${spacing[1]} 0` }} />

        {/* Deep links */}
        <div>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM, display: 'block', marginBottom: spacing[1] }}>
            Links
          </Text>
          <Space direction="vertical" size={4}>
            {record.integrationConfigId && (
              <Button
                type="link"
                size="small"
                icon={<LinkOutlined />}
                onClick={() => navigateTo(`/integrations/${record.integrationConfigId}`)}
                style={{ padding: 0, height: 'auto' }}
              >
                View Source Integration
              </Button>
            )}
            {record.originalEventId && (
              <Button
                type="link"
                size="small"
                icon={<LinkOutlined />}
                onClick={() => navigateTo(`/logs?search=${record.originalEventId}`)}
                style={{ padding: 0, height: 'auto' }}
              >
                Find Original Event (ID: {record.originalEventId})
              </Button>
            )}
            {record.deliveryLogId && (
              <Button
                type="link"
                size="small"
                icon={<LinkOutlined />}
                onClick={() => navigateTo(`/logs?search=${record.deliveryLogId}`)}
                style={{ padding: 0, height: 'auto' }}
              >
                View Delivery Log
              </Button>
            )}
          </Space>
        </div>

        {/* Cancellation info */}
        {record.cancellationInfo && (
          <>
            <Divider style={{ margin: `${spacing[1]} 0` }} />
            <div>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM, display: 'block', marginBottom: spacing[1] }}>
                Cancellation Info
              </Text>
              {record.cancellationInfo.entityId && (
                <Text style={{ fontSize: token.fontSizeSM, display: 'block' }}>
                  Entity ID: {record.cancellationInfo.entityId}
                </Text>
              )}
              {record.cancellationInfo.scheduledDateTime && (
                <Text style={{ fontSize: token.fontSizeSM, display: 'block' }}>
                  Appointment time: {formatDateTime(record.cancellationInfo.scheduledDateTime)}
                </Text>
              )}
            </div>
          </>
        )}

        {/* Payload */}
        {record.payload && (
          <>
            <Divider style={{ margin: `${spacing[1]} 0` }} />
            <div>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM, display: 'block', marginBottom: spacing[1] }}>
                Payload
              </Text>
              <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                <pre className="clamped-code-block" style={{ margin: 0 }}>
                  {JSON.stringify(record.payload, null, 2)}
                </pre>
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
  const { spacing, token, shadows, borderRadius } = useDesignTokens();
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

  const tagTone = useCallback(
    (base: string): React.CSSProperties => ({
      borderRadius: borderRadius.full,
      borderColor: withAlpha(base, 0.25),
      background: withAlpha(base, 0.1),
      color: base,
      fontWeight: 700,
      paddingInline: spacing[2],
      paddingBlock: spacing['0.5'],
      fontSize: token.fontSizeSM,
    }),
    [spacing, token.fontSizeSM, borderRadius.full]
  );

  const panelStyle = useMemo(
    () =>
      ({
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${cssVar.border.default}`,
        background: cssVar.bg.surface,
        boxShadow: shadows.xl,
      }) as const,
    [token.borderRadiusLG, shadows.xl]
  );

  const tableFullBleedStyle = useMemo(
    () =>
      isNarrow
        ? {}
        : {
            marginLeft: 0,
            marginRight: `-${spacing[5]}`,
            paddingRight: spacing[1],
          },
    [isNarrow, spacing]
  );

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
                  style={{ width: 190 }}
                  onClick={(e) => e.stopPropagation()}
                  showNow={false}
                />
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveScheduledFor(record.id);
                  }}
                />
                <Button
                  size="small"
                  icon={<CloseOutlined />}
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
              <Text style={{ whiteSpace: 'nowrap' }}>{formatDateTime(scheduledFor)}</Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM, whiteSpace: 'nowrap' }}>
                {dayjs(scheduledFor).fromNow()}
              </Text>
              {canEdit && (
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditScheduledFor(record);
                  }}
                  style={{ padding: '0 4px' }}
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
            style={{ padding: 0, height: 'auto', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
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
        render: (eventType: string) => <Tag style={tagTone(colors.neutral[600])}>{eventType}</Tag>,
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: (status: ScheduledIntegration['status'], record: ScheduledIntegration) => (
          <Space size={4}>
            <Tag icon={getStatusIcon(status)} style={tagTone(getStatusColor(status, colors))}>
              {status}
            </Tag>
            {record.errorMessage && (
              <Tooltip title={record.errorMessage}>
                <InfoCircleOutlined style={{ color: colors.error[500], fontSize: 12 }} />
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
                icon={<RetweetOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  openRetryModal(record);
                }}
                style={{ color: colors.info[600] }}
              >
                Retry
              </Button>
            )}
            {(record.status === 'PENDING' || record.status === 'OVERDUE') && (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
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
      token,
      tagTone,
      navigate,
      handleEditScheduledFor,
      handleCancelEdit,
      handleSaveScheduledFor,
      openCancelModal,
      openRetryModal,
    ]
  );

  return (
    <div>
      <PageHeader
        title="Delayed Deliveries"
        description="Individual deliveries held until a specific future time by a real-time event (e.g. an appointment reminder). For recurring cron-based batch jobs, see Scheduled Jobs. Click any row to inspect details."
        statusChips={[
          { label: `${filtered.length} shown` },
          ...(failureCount > 0 ? [{ label: `${failureCount} need attention`, color: colors.error[600] }] : []),
        ]}
        compact
        actions={
          <Space>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportCsv}
              loading={exportLoading}
              disabled={scheduledFetching}
              size="small"
            >
              Export
            </Button>
            <Button
              icon={<ReloadOutlined />}
              loading={scheduledFetching}
              onClick={() => refetchScheduled()}
              size="small"
            >
              Refresh
            </Button>
          </Space>
        }
      />

      {/* Stats strip */}
      {scheduledFetching ? (
        <Card style={{ ...panelStyle, marginBottom: spacingToNumber(spacing[2]) }}>
          <Skeleton active paragraph={{ rows: 1 }} />
        </Card>
      ) : (
        <Card
          style={{
            ...panelStyle,
            marginBottom: spacingToNumber(spacing[2]),
            padding: `${spacing['1.5']} ${spacing[3]}`,
          }}
          styles={{ body: { padding: 0 } }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing['1.5'], alignItems: 'center' }}>
            {[
              { title: 'Total', value: stats.total, tone: cssVar.text.secondary, filterValue: undefined },
              { title: 'Pending', value: stats.pending, tone: colors.info[600], filterValue: 'PENDING' },
              { title: 'Overdue', value: stats.overdue, tone: colors.warning[600], filterValue: 'OVERDUE' },
              { title: 'Sent', value: stats.sent, tone: colors.success[600], filterValue: 'SENT' },
              { title: 'Failed', value: stats.failed, tone: colors.error[600], filterValue: 'FAILED' },
              { title: 'Cancelled', value: stats.cancelled, tone: colors.warning[600], filterValue: 'CANCELLED' },
            ].map((item) => {
              const isActive = item.filterValue ? statusFilter === item.filterValue : !statusFilter;
              return (
                <Tag
                  key={item.title}
                  onClick={() => {
                    setActiveTab('all');
                    item.filterValue ? handleQuickStatusFilter(item.filterValue) : setStatusFilter(undefined);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveTab('all');
                      item.filterValue ? handleQuickStatusFilter(item.filterValue) : setStatusFilter(undefined);
                    }
                  }}
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 12,
                    padding: `${spacing['0.5']} ${spacing[2]}`,
                    borderColor: withAlpha(item.tone, isActive ? 0.55 : 0.25),
                    background: withAlpha(item.tone, isActive ? 0.12 : 0.06),
                    color: item.tone,
                    fontWeight: 700,
                    margin: 0,
                    cursor: 'pointer',
                  }}
                >
                  {item.title}: {item.value?.toLocaleString() ?? 0}
                </Tag>
              );
            })}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card style={{ ...panelStyle, marginBottom: spacingToNumber(spacing[2]) }}>
        <Space
          direction={isNarrow ? 'vertical' : 'horizontal'}
          size={spacingToNumber(spacing[2])}
          style={{ width: '100%', flexWrap: 'wrap' }}
        >
          {scheduledFetching ? (
            <>
              <Skeleton.Input active style={{ minWidth: 160 }} />
              <Skeleton.Input active style={{ minWidth: 200 }} />
              <Skeleton.Input active style={{ minWidth: 200 }} />
              <Skeleton.Input active style={{ minWidth: 250, flex: 1 }} />
            </>
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
                style={{ minWidth: 160 }}
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
                style={{ minWidth: 200 }}
                size="small"
                options={integrations.map((w) => ({ value: w.id, label: w.name }))}
              />
              <Select
                placeholder="Filter by event type"
                allowClear
                showSearch
                value={eventTypeFilter}
                onChange={setEventTypeFilter}
                style={{ minWidth: 200 }}
                size="small"
                options={eventTypes.map((et) => ({ value: et, label: et }))}
              />
              <Input.Search
                placeholder="Search name, event, URL, payload, error, ID…"
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: 250, flex: 1 }}
                size="small"
              />
            </>
          )}
        </Space>
      </Card>

      {/* Bulk actions */}
      {selectedRowKeys.length > 0 && (
        <Card
          style={{
            ...panelStyle,
            marginBottom: spacingToNumber(spacing[2]),
            background: withAlpha(colors.info[500], 0.05),
            borderColor: colors.info[300],
          }}
        >
          <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Space>
              <Text strong>{selectedRowKeys.length} selected</Text>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>
                Clear
              </Button>
            </Space>
            <Button danger icon={<DeleteOutlined />} onClick={handleBulkDelete}>
              Bulk Cancel
            </Button>
          </Space>
        </Card>
      )}

      {/* Tabs: All vs Failures */}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => {
          setActiveTab(k as 'all' | 'failures');
          setStatusFilter(undefined);
        }}
        size="small"
        style={{ marginBottom: spacingToNumber(spacing[1]) }}
        items={[
          { key: 'all', label: 'All Deliveries' },
          {
            key: 'failures',
            label: (
              <Space size={4}>
                <FireOutlined style={{ color: failureCount > 0 ? colors.error[500] : undefined }} />
                Failures & Overdue
                {failureCount > 0 && <Badge count={failureCount} size="small" />}
              </Space>
            ),
          },
        ]}
      />

      {/* Empty state for failures tab */}
      {activeTab === 'failures' && filtered.length === 0 && !scheduledFetching && (
        <Card style={panelStyle}>
          <div style={{ textAlign: 'center', padding: `${spacing[8]} 0` }}>
            <CheckCircleOutlined style={{ fontSize: 32, color: colors.success[500], marginBottom: spacing[2] }} />
            <Text type="secondary" style={{ display: 'block' }}>
              No failed or overdue deliveries — all clear.
            </Text>
          </div>
        </Card>
      )}

      {/* Table */}
      {(activeTab === 'all' || filtered.length > 0) && (
        <div className="full-bleed-table" style={tableFullBleedStyle}>
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
        tagTone={tagTone}
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
          <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
            <Text>
              Cancel <Text strong>{cancelTarget.integrationName}</Text> scheduled for{' '}
              <Text strong>{formatDateTime(cancelTarget.scheduledFor)}</Text>?
            </Text>
            <Form.Item label="Reason (optional)" style={{ marginBottom: 0 }}>
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
          <Space direction="vertical" size={spacingToNumber(spacing[2])} style={{ width: '100%' }}>
            <Alert type="info" showIcon message="The delivery will be rescheduled to fire in ~30 seconds." />
            {retryTarget.errorMessage && (
              <div>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  Previous error:
                </Text>
                <Paragraph
                  type="danger"
                  style={{ fontFamily: 'monospace', fontSize: 12, marginTop: spacing[1], marginBottom: 0 }}
                  ellipsis={{ rows: 3, expandable: true }}
                >
                  {retryTarget.errorMessage}
                </Paragraph>
              </div>
            )}
            <Form.Item
              label="Reason (required)"
              required
              style={{ marginBottom: 0 }}
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
    </div>
  );
};
