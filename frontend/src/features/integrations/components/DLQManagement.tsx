import { useState, useEffect } from 'react';
import {
  App,
  Dropdown,
  Space,
  Modal,
  Input,
  Select,
  Card,
  Grid,
  Popconfirm,
  Drawer,
  Descriptions,
  Tooltip,
  type MenuProps,
} from '@/components/common/LegacyAntdControls';
import { Text } from '../../../components/common/LegacyTypography';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import {
  listDLQEntries,
  getDLQEntry,
  getDLQStats,
  retryDLQEntry,
  abandonDLQEntry,
  deleteDLQEntry,
  bulkRetryDLQ,
  bulkAbandonDLQ,
  bulkDeleteDLQ,
  DLQEntry,
} from '../../../services/api';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { TraceViewer } from './TraceViewer';
import { ModernTable } from '../../../components/common/ModernTable';
import { FilterBar } from '../../../components/common/FilterBar';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { StatePanel } from '../../../components/common/StatePanel';
import { ListActions } from '../../../components/common/ListControls';
import type { Breakpoint } from '@/components/common/LegacyAntdControls';
import { Button } from '../../../components/common/LegacyButton';

const { TextArea } = Input;

interface DLQManagementProps {
  integrationConfigId?: string;
}

export const DLQManagement = ({ integrationConfigId }: DLQManagementProps) => {
  const { message: messageApi, modal } = App.useApp();
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const screens = Grid.useBreakpoint();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<DLQEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [selectedEntry, setSelectedEntry] = useState<DLQEntry | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceViewerOpen, setTraceViewerOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [abandonNotes, setAbandonNotes] = useState('');
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);

  // Filters
  const [filters, setFilters] = useState({
    status: undefined as 'pending' | 'retrying' | 'resolved' | 'abandoned' | undefined,
    errorCategory: undefined as string | undefined,
    direction: 'OUTBOUND' as 'OUTBOUND' | 'INBOUND' | 'SCHEDULED' | undefined,
    limit: 50,
    offset: 0,
  });

  useEffect(() => {
    setSelectedRowKeys([]);
    loadData();
  }, [integrationConfigId, filters]);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [entriesRes, statsRes] = await Promise.all([
        listDLQEntries({
          ...filters,
          integrationConfigId,
        }),
        getDLQStats({ integrationConfigId }),
      ]);

      setEntries(entriesRes.data);
      setTotal(entriesRes.pagination.total);
      setStats(statsRes);
    } catch (error: any) {
      setLoadError(error?.message || 'The dead letter queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (dlqId: string) => {
    try {
      await retryDLQEntry(dlqId);
      messageApi.success('Retry initiated successfully');
      loadData();
    } catch (error: any) {
      messageApi.error('Failed to retry: ' + error.message);
    }
  };

  const handleAbandon = async (dlqId: string, notes?: string) => {
    try {
      await abandonDLQEntry(dlqId, notes);
      messageApi.success('Entry abandoned successfully');
      setAbandonNotes('');
      loadData();
    } catch (error: any) {
      messageApi.error('Failed to abandon: ' + error.message);
    }
  };

  const handleDelete = async (dlqId: string) => {
    try {
      await deleteDLQEntry(dlqId);
      messageApi.success('Entry deleted successfully');
      loadData();
    } catch (error: any) {
      messageApi.error('Failed to delete: ' + error.message);
    }
  };

  const confirmAbandon = (entry: DLQEntry) => {
    modal.confirm({
      title: 'Abandon this entry?',
      content: 'This action cannot be undone.',
      okText: 'Abandon',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => handleAbandon(entry.dlqId),
    });
  };

  const confirmDelete = (entry: DLQEntry) => {
    setDeleteEntryId(entry.dlqId);
  };

  const handleBulkRetry = async () => {
    try {
      const dlqIds = selectedRowKeys as string[];
      const result = await bulkRetryDLQ(dlqIds);
      messageApi.success(`Initiated retry for ${result.success.length} entries`);
      if (result.failed.length > 0) {
        messageApi.warning(`${result.failed.length} entries failed to retry`);
      }
      setSelectedRowKeys([]);
      loadData();
    } catch (error: any) {
      messageApi.error('Bulk retry failed: ' + error.message);
    }
  };

  const handleBulkAbandon = async () => {
    modal.confirm({
      title: 'Abandon Multiple Entries',
      content: (
        <div>
          <p>Are you sure you want to abandon {selectedRowKeys.length} entries?</p>
          <TextArea
            placeholder="Enter reason for abandonment (optional)"
            rows={3}
            onChange={(e) => setAbandonNotes(e.target.value)}
          />
        </div>
      ),
      onOk: async () => {
        try {
          const dlqIds = selectedRowKeys as string[];
          const result = await bulkAbandonDLQ(dlqIds, abandonNotes);
          const successCount = result?.success?.length ?? 0;
          const failedCount = result?.failed?.length ?? 0;
          messageApi.success(`Abandoned ${successCount} entries`);
          if (failedCount > 0) {
            messageApi.warning(`${failedCount} entries failed to abandon`);
          }
          setSelectedRowKeys([]);
          setAbandonNotes('');
          loadData();
        } catch (error: any) {
          messageApi.error('Bulk abandon failed: ' + error.message);
        }
      },
    });
  };

  const handleBulkDelete = async () => {
    modal.confirm({
      title: 'Delete Multiple Entries',
      content: (
        <div>
          <p>Are you sure you want to delete {selectedRowKeys.length} entries?</p>
          <Text type="secondary">This action cannot be undone.</Text>
        </div>
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const dlqIds = selectedRowKeys as string[];
          const result = await bulkDeleteDLQ(dlqIds);
          const successCount = result?.success?.length ?? 0;
          const failedCount = result?.failed?.length ?? 0;
          messageApi.success(`Deleted ${successCount} entries`);
          if (failedCount > 0) {
            messageApi.warning(`${failedCount} entries failed to delete`);
          }
          setSelectedRowKeys([]);
          loadData();
        } catch (error: any) {
          messageApi.error('Bulk delete failed: ' + error.message);
        }
      },
    });
  };

  const viewDetails = async (dlqId: string) => {
    try {
      const entry = await getDLQEntry(dlqId);
      setSelectedEntry(entry);
      setDetailsDrawerOpen(true);
    } catch (error: any) {
      messageApi.error('Failed to load details: ' + error.message);
    }
  };

  const getStatusTag = (status: string) => (
    <StatusBadge status={status === 'resolved' ? 'SUCCESS' : status.toUpperCase()} size="small" />
  );

  const getResolutionTag = (entry: DLQEntry) => {
    return getStatusTag(entry.status);
  };

  const getResolutionSummary = (entry: DLQEntry) => {
    if (entry.status === 'resolved') {
      if (entry.resolutionMethod === 'auto_retry') return 'Succeeded after retry';
      if (entry.resolutionMethod === 'manual_retry') return 'Succeeded after manual retry';
      if (entry.resolutionMethod === 'fixed') return 'Resolved after fix';
      return 'Resolved';
    }
    if (entry.status === 'abandoned') {
      if (entry.resolutionMethod === 'max_retries_exceeded') return 'Abandoned after max retries';
      if (entry.resolutionMethod === 'manual_abandon') return 'Abandoned manually';
      return 'Abandoned';
    }
    if (entry.status === 'retrying') return 'Retry in progress';
    return 'Pending retry';
  };

  const columns = [
    {
      title: 'DLQ ID',
      dataIndex: 'dlqId',
      key: 'dlqId',
      width: 130,
      render: (id: string) => (
        <Text
          code
          copyable
          className="ui-extracted-ca70eb2124"
          ellipsis={{ tooltip: id }}
        >
          {id.substring(0, 16)}...
        </Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => getStatusTag(status),
    },
    {
      title: 'Direction',
      dataIndex: 'direction',
      key: 'direction',
      width: 100,
      render: (direction: string) => (
        <Text type="secondary">
          {direction === 'OUTBOUND' ? 'Outbound' : direction === 'INBOUND' ? 'Inbound' : 'Scheduled'}
        </Text>
      ),
    },
    {
      title: 'Error Category',
      dataIndex: ['error', 'category'],
      key: 'errorCategory',
      width: 128,
      render: (category: string) => <Text code>{category.replace(/_/g, ' ')}</Text>,
    },
    {
      title: 'Error Message',
      dataIndex: ['error', 'message'],
      key: 'errorMessage',
      ellipsis: true,
      width: 230,
      render: (message: string) => (
        <Tooltip title={message}>
          <Text type="danger" className="console-type-caption">
            {message}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Retry Count',
      dataIndex: 'retryCount',
      key: 'retryCount',
      width: 82,
      render: (count: number, record: DLQEntry) => (
        <Text>
          {count} / {record.maxRetries}
        </Text>
      ),
    },
    {
      title: 'Next Retry',
      dataIndex: 'nextRetryAt',
      key: 'nextRetryAt',
      width: 140,
      responsive: ['xxl'] as Breakpoint[],
      render: (nextRetryAt: string | null, record: DLQEntry) => {
        if (record.status !== 'pending') return '-';
        if (!nextRetryAt) return '-';
        const date = new Date(nextRetryAt);
        return (
          <Text type="secondary" className="console-type-caption">
            {date.toLocaleString()}
          </Text>
        );
      },
    },
    {
      title: 'Failed At',
      dataIndex: 'failedAt',
      key: 'failedAt',
      width: 140,
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 88,
      render: (_: unknown, record: DLQEntry) => {
        const terminal = record.status === 'resolved' || record.status === 'abandoned';
        const items: MenuProps['items'] = [
          { key: 'retry', label: 'Retry', icon: <GatewayIcon name="ReloadOutlined" />, disabled: terminal },
          {
            key: 'abandon',
            label: 'Abandon',
            icon: <GatewayIcon name="StopOutlined" />,
            danger: true,
            disabled: terminal,
          },
          { type: 'divider' },
          { key: 'delete', label: 'Delete', icon: <GatewayIcon name="DeleteOutlined" />, danger: true },
        ];

        return (
          <Space size="small" className="dlq-row-actions">
            <Tooltip title="View details">
              <Button
                size="small"
                aria-label={`View details for ${record.dlqId}`}
                icon={<GatewayIcon name="EyeOutlined" />}
                onClick={() => viewDetails(record.dlqId)}
              />
            </Tooltip>
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items,
                onClick: ({ key }) => {
                  if (key === 'retry') void handleRetry(record.dlqId);
                  if (key === 'abandon') confirmAbandon(record);
                  if (key === 'delete') confirmDelete(record);
                },
              }}
            >
              <Tooltip title="More actions">
                <Button
                  size="small"
                  aria-label={`More actions for ${record.dlqId}`}
                  icon={<GatewayIcon name="MoreOutlined" />}
                />
              </Tooltip>
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: setSelectedRowKeys,
    getCheckboxProps: (record: DLQEntry) => ({
      disabled: record.status === 'resolved' || record.status === 'abandoned',
    }),
  };

  const hasActiveFilters = Boolean(filters.status || filters.errorCategory || filters.direction);

  return (
    <div className="dlq-management">
      {stats && (
        <div className="dlq-summary-grid" aria-label="Dead letter queue totals">
          {[
            { label: 'Pending', value: stats.statusBreakdown?.pending || 0, status: 'pending' },
            { label: 'Retrying', value: stats.statusBreakdown?.retrying || 0, status: 'retrying' },
            { label: 'Resolved', value: stats.statusBreakdown?.resolved || 0, status: 'resolved' },
            { label: 'Abandoned', value: stats.statusBreakdown?.abandoned || 0, status: 'abandoned' },
          ].map((item) => (
            <div key={item.status} className="dlq-summary-item">
              <span className="dlq-summary-label">{item.label}</span>
              <strong className="dlq-summary-value">{item.value}</strong>
            </div>
          ))}
        </div>
      )}

      <FilterBar
        rightSlot={
          <>
            {selectedRowKeys.length > 0 && (
              <div className="dlq-bulk-actions" aria-label={`${selectedRowKeys.length} entries selected`}>
                <Button
                  type="primary"
                  icon={<GatewayIcon name="ReloadOutlined" />}
                  onClick={handleBulkRetry}
                  size="small"
                >
                  Retry ({selectedRowKeys.length})
                </Button>
                <Button danger icon={<GatewayIcon name="StopOutlined" />} onClick={handleBulkAbandon} size="small">
                  Abandon ({selectedRowKeys.length})
                </Button>
                <Button danger icon={<GatewayIcon name="DeleteOutlined" />} onClick={handleBulkDelete} size="small">
                  Delete ({selectedRowKeys.length})
                </Button>
              </div>
            )}
            <ListActions
              onReset={() =>
                setFilters({ status: undefined, errorCategory: undefined, direction: undefined, limit: 50, offset: 0 })
              }
              onRefresh={loadData}
              refreshLabel="Refresh dead letter queue"
            />
          </>
        }
      >
        <Select
          aria-label="Direction"
          placeholder="All directions"
          className="ui-extracted-ea667f835f"
          allowClear
          value={filters.direction}
          onChange={(direction) => setFilters({ ...filters, direction, offset: 0 })}
          options={[
            { value: 'OUTBOUND', label: 'Outbound' },
            { value: 'INBOUND', label: 'Inbound' },
            { value: 'SCHEDULED', label: 'Scheduled' },
          ]}
          size="middle"
        />
        <Select
          aria-label="Status"
          placeholder="All statuses"
          className="ui-extracted-ea667f835f"
          allowClear
          value={filters.status}
          onChange={(status) => setFilters({ ...filters, status, offset: 0 })}
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'retrying', label: 'Retrying' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'abandoned', label: 'Abandoned' },
          ]}
          size="middle"
        />
        <Select
          aria-label="Error category"
          placeholder="All error categories"
          className="ui-extracted-ed88572ce3"
          allowClear
          value={filters.errorCategory}
          onChange={(errorCategory) => setFilters({ ...filters, errorCategory, offset: 0 })}
          options={[
            'TIMEOUT',
            'NETWORK',
            'SERVER_ERROR',
            'RATE_LIMIT',
            'CLIENT_ERROR',
            'AUTH_ERROR',
            'DATA_ERROR',
            'VALIDATION_ERROR',
            'UNKNOWN',
          ].map((value) => ({ value, label: value.replace(/_/g, ' ') }))}
          size="middle"
        />
      </FilterBar>

      <div className="dlq-table-section">
        <div className="dlq-table-heading">
          <Text weight="semibold">Delivery failures</Text>
          <Text type="supporting" color="secondary">
            {total.toLocaleString()} entries
          </Text>
        </div>
        {entries.length === 0 && !loading ? (
          <StatePanel
            glyph="searching"
            size="compact"
            title={
              loadError
                ? 'Entries are temporarily unavailable'
                : hasActiveFilters
                  ? 'No entries match these filters'
                  : 'No failed deliveries'
            }
            description={
              loadError
                ? 'Retry the request to restore the delivery queue.'
                : hasActiveFilters
                  ? 'Clear one or more filters to see other failures.'
                  : 'New failures will appear here for investigation and recovery.'
            }
            actions={
              loadError ? (
                <Button onClick={loadData}>Retry</Button>
              ) : hasActiveFilters ? (
                <Button
                  onClick={() =>
                    setFilters({
                      status: undefined,
                      errorCategory: undefined,
                      direction: undefined,
                      limit: 50,
                      offset: 0,
                    })
                  }
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="full-bleed-table">
            <ModernTable
              rowSelection={rowSelection}
              columns={columns}
              dataSource={entries}
              rowKey="dlqId"
              loading={loading}
              size="small"
              tableLayout="fixed"
              pagination={{
                current: Math.floor(filters.offset / filters.limit) + 1,
                pageSize: filters.limit,
                total,
                showSizeChanger: true,
                showTotal: (count) => `Showing ${entries.length} of ${count} entries`,
                onChange: (page, pageSize) => {
                  setFilters({
                    ...filters,
                    offset: (page - 1) * pageSize,
                    limit: pageSize,
                  });
                },
              }}
              scroll={{ x: 1040 }}
            />
          </div>
        )}
      </div>

      {/* Details Drawer */}
      <Drawer
        title="DLQ Entry Details"
        placement="right"
        width={screens.md ? 700 : '100%'}
        open={detailsDrawerOpen}
        onClose={() => setDetailsDrawerOpen(false)}
      >
        {selectedEntry && (
          <Space direction="vertical" size={spacingToNumber(spacing[4])} className="console-width-full">
            <Space>
              {getResolutionTag(selectedEntry)}
              <Text type="secondary">{getResolutionSummary(selectedEntry)}</Text>
            </Space>

            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Outcome">
                <Space>
                  {getResolutionTag(selectedEntry)}
                  <Text type="secondary">{getResolutionSummary(selectedEntry)}</Text>
                </Space>
              </Descriptions.Item>
              {selectedEntry.resolutionMethod && (
                <Descriptions.Item label="Resolution Method">
                  <Text code>{selectedEntry.resolutionMethod.replace(/_/g, ' ')}</Text>
                </Descriptions.Item>
              )}
              {selectedEntry.resolvedAt && (
                <Descriptions.Item label="Resolved At">
                  {new Date(selectedEntry.resolvedAt).toLocaleString()}
                </Descriptions.Item>
              )}
              {selectedEntry.resolvedBy && (
                <Descriptions.Item label="Resolved By">{selectedEntry.resolvedBy}</Descriptions.Item>
              )}
              {selectedEntry.resolutionNotes && (
                <Descriptions.Item label="Resolution Notes">{selectedEntry.resolutionNotes}</Descriptions.Item>
              )}
              <Descriptions.Item label="DLQ ID">
                <Text code copyable>
                  {selectedEntry.dlqId}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Trace ID">
                <Space>
                  <Text code copyable>
                    {selectedEntry.traceId}
                  </Text>
                  <Button
                    size="small"
                    icon={<GatewayIcon name="EyeOutlined" />}
                    onClick={() => {
                      setSelectedTraceId(selectedEntry.traceId);
                      setTraceViewerOpen(true);
                    }}
                  >
                    View Trace
                  </Button>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Direction">{selectedEntry.direction}</Descriptions.Item>
              <Descriptions.Item label="Retry Count">
                {selectedEntry.retryCount} / {selectedEntry.maxRetries}
              </Descriptions.Item>
              <Descriptions.Item label="Retry Strategy">{selectedEntry.retryStrategy}</Descriptions.Item>
              {selectedEntry.nextRetryAt && (
                <Descriptions.Item label="Next Retry At">
                  {new Date(selectedEntry.nextRetryAt).toLocaleString()}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Failed At">
                {new Date(selectedEntry.failedAt).toLocaleString()}
              </Descriptions.Item>
            </Descriptions>

            <Card title="Error Details" size="small">
              <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
                <div>
                  <Text strong>Category: </Text>
                  <Text code>{selectedEntry.error.category.replace(/_/g, ' ')}</Text>
                </div>
                <div>
                  <Text strong>Code: </Text>
                  <Text code>{selectedEntry.error.code}</Text>
                </div>
                <div>
                  <Text strong>Message: </Text>
                  <Text type="danger">{selectedEntry.error.message}</Text>
                </div>
                {selectedEntry.error.statusCode && (
                  <div>
                    <Text strong>HTTP Status: </Text>
                    <Text code type={selectedEntry.error.statusCode >= 400 ? 'danger' : undefined}>
                      {selectedEntry.error.statusCode}
                    </Text>
                  </div>
                )}
                {selectedEntry.error.stack && (
                  <div>
                    <Text strong>Stack Trace:</Text>
                    <pre
                      className="clamped-code-block"
                      style={{
                        background: cssVar.table.codeBg,
                        color: cssVar.text.primary,
                        padding: spacing[2],
                        borderRadius: 4,
                        fontSize: 'var(--console-type-caption)',
                        maxHeight: 200,
                        overflow: 'auto',
                      }}
                    >
                      {selectedEntry.error.stack}
                    </pre>
                  </div>
                )}
              </Space>
            </Card>

            <Card title="Original Payload" size="small">
              <pre
                className="clamped-code-block"
                style={{
                  background: cssVar.table.codeBg,
                  padding: spacing[2],
                  borderRadius: 4,
                  fontSize: 'var(--console-type-caption)',
                  maxHeight: 400,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(selectedEntry.payload, null, 2)}
              </pre>
            </Card>

            {selectedEntry.status !== 'resolved' && selectedEntry.status !== 'abandoned' && (
              <Space>
                <Button
                  type="primary"
                  icon={<GatewayIcon name="ReloadOutlined" />}
                  onClick={() => handleRetry(selectedEntry.dlqId)}
                >
                  Retry Now
                </Button>
                <Popconfirm
                  title="Abandon this entry?"
                  description="This action cannot be undone"
                  onConfirm={() => handleAbandon(selectedEntry.dlqId)}
                  okText="Yes"
                  cancelText="No"
                >
                  <Button danger icon={<GatewayIcon name="StopOutlined" />}>
                    Abandon
                  </Button>
                </Popconfirm>
              </Space>
            )}
          </Space>
        )}
      </Drawer>

      <Modal
        title="Delete this entry?"
        open={deleteEntryId !== null}
        okText="Delete"
        okButtonProps={{ danger: true }}
        cancelText="Cancel"
        onCancel={() => setDeleteEntryId(null)}
        onOk={async () => {
          if (!deleteEntryId) return;
          const dlqId = deleteEntryId;
          setDeleteEntryId(null);
          await handleDelete(dlqId);
        }}
      >
        This action cannot be undone.
      </Modal>

      {/* Trace Viewer */}
      {selectedTraceId && (
        <TraceViewer
          traceId={selectedTraceId}
          open={traceViewerOpen}
          onClose={() => {
            setTraceViewerOpen(false);
            setSelectedTraceId(null);
          }}
        />
      )}
    </div>
  );
};
