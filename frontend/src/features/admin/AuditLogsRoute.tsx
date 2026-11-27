import { useEffect, useState } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import {
  Form,
  Input,
  Select,
  Space,
  DatePicker,
  Row,
  Col,
  Statistic,
  Modal,
  Descriptions,
  Divider,
  message,
} from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/PageHeader';
import { PageTemplate } from '../../components/common/PageTemplate';
import { FilterBar } from '../../components/common/FilterBar';
import { MetaTag } from '../../components/common/MetaTag';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { Metric, MetricStrip, Panel } from '../../design-system/primitives';
import {
  getAdminAuditActionTypes,
  getAdminAuditLogs,
  getAdminAuditResourceTypes,
  getAdminAuditStats,
  exportAuditLogs,
} from '../../services/api';
import dayjs from 'dayjs';
import { ModernTable } from '../../components/common/ModernTable';
import { createExportProgress } from '../../utils/export-progress';
import { Button } from '../../components/common/LegacyButton';

const { Text } = Typography;
const { RangePicker } = DatePicker;

const safeStr = (val: unknown): string => {
  if (val == null) return '-';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
};

interface AuditLog {
  _id: string;
  timestamp: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  orgId?: number;
  changes?: {
    before?: any;
    after?: any;
  };
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

interface AuditStats {
  totalLogs: number;
  failedActions: number;
  successRate: string;
  actionsByType: Array<{ action: string; count: number }>;
  topUsers: Array<{ userId: string; userEmail: string; count: number }>;
}

export const AuditLogsRoute = () => {
  const { spacing, token } = useDesignTokens();
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState({
    startDate: undefined as string | undefined,
    endDate: undefined as string | undefined,
    action: undefined as string | undefined,
    resourceType: undefined as string | undefined,
    success: undefined as boolean | undefined,
    search: undefined as string | undefined,
    page: 1,
    limit: 50,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = searchInput.trim() || undefined;
      setFilters((current) => (current.search === search ? current : { ...current, search, page: 1 }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Fetch audit logs
  const {
    data: logsData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: async () => {
      return await getAdminAuditLogs({
        startDate: filters.startDate,
        endDate: filters.endDate,
        action: filters.action,
        resourceType: filters.resourceType,
        success: filters.success,
        search: searchInput.trim() || undefined,
        page: filters.page,
        limit: filters.limit,
      });
    },
    staleTime: 30_000,
  });

  // Fetch audit stats
  const { data: stats } = useQuery({
    queryKey: ['audit-stats', filters.startDate, filters.endDate],
    queryFn: async () => {
      return await getAdminAuditStats({
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
    },
    staleTime: 30_000,
  });

  const { data: actionTypes = [] } = useQuery({
    queryKey: ['admin-audit-action-types'],
    queryFn: getAdminAuditActionTypes,
    staleTime: 5 * 60_000,
  });

  const { data: resourceTypes = [] } = useQuery({
    queryKey: ['admin-audit-resource-types'],
    queryFn: getAdminAuditResourceTypes,
    staleTime: 5 * 60_000,
  });

  const handleExport = async (format: 'json' | 'csv') => {
    const { onProgress, finish } = createExportProgress(message, `Export ${format.toUpperCase()}`);
    try {
      await exportAuditLogs(
        {
          format,
          startDate: filters.startDate,
          endDate: filters.endDate,
          action: filters.action,
          resourceType: filters.resourceType,
          success: filters.success,
          search: searchInput.trim() || undefined,
        },
        { onProgress }
      );
      finish('Export complete');
    } catch (error) {
      finish('Export failed', true);
    }
  };

  const getActionVariant = (action: string) => {
    const normalized = action.toLowerCase();
    if (normalized.includes('create')) return 'success' as const;
    if (normalized.includes('update')) return 'blue' as const;
    if (normalized.includes('delete') || normalized.includes('failed')) return 'error' as const;
    if (normalized.includes('login')) return 'info' as const;
    return 'neutral' as const;
  };

  const columns = [
    {
      title: 'Timestamp',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (timestamp: string) => (
        <Space direction="vertical" size={0}>
          <Text>{dayjs(timestamp).format('MMM DD, YYYY')}</Text>
          <Text type="secondary" className="console-type-caption">
            {dayjs(timestamp).format('HH:mm:ss')}
          </Text>
        </Space>
      ),
      sorter: (a: AuditLog, b: AuditLog) => dayjs(a.timestamp).unix() - dayjs(b.timestamp).unix(),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 150,
      render: (action: string) => (
        <StatusBadge
          label={action.replace(/_/g, ' ').toUpperCase()}
          variant={getActionVariant(action)}
          showIcon={false}
          size="small"
        />
      ),
    },
    {
      title: 'Resource',
      dataIndex: 'resourceType',
      key: 'resourceType',
      width: 120,
      render: (type: unknown, record: AuditLog) => (
        <Space direction="vertical" size={0}>
          <Text strong className="ui-extracted-058475f4e6">
            {safeStr(type)}
          </Text>
          {record.resourceId && (
            <Text type="secondary" className="console-type-caption">
              ID: {safeStr(record.resourceId)}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'User',
      dataIndex: 'userEmail',
      key: 'userEmail',
      width: 200,
      render: (email: unknown, record: AuditLog) => (
        <Space direction="vertical" size={0}>
          <Text>{email == null ? 'System' : safeStr(email)}</Text>
          {record.userRole && <MetaTag size="small">{safeStr(record.userRole)}</MetaTag>}
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'success',
      key: 'success',
      width: 100,
      align: 'center' as const,
      render: (success: boolean) => <StatusBadge status={success ? 'SUCCESS' : 'FAILED'} size="small" />,
    },
    {
      title: 'IP Address',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 130,
      render: (ip: unknown) => <Text type="secondary">{safeStr(ip)}</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 80,
      align: 'center' as const,
      render: (_: any, record: AuditLog) => (
        <Button size="small" icon={<GatewayIcon name="EyeOutlined" />} onClick={() => setSelectedLog(record)}>
          Details
        </Button>
      ),
    },
  ];

  return (
    <PageTemplate
      header={
        <PageHeader
          title="Audit Logs"
          description="Track all system activities and user actions"
          actions={
            <Space wrap>
              <Button icon={<GatewayIcon name="ReloadOutlined" />} onClick={() => refetch()}>
                Refresh
              </Button>
              <Button icon={<GatewayIcon name="DownloadOutlined" />} onClick={() => handleExport('json')}>
                Export JSON
              </Button>
              <Button icon={<GatewayIcon name="DownloadOutlined" />} onClick={() => handleExport('csv')}>
                Export CSV
              </Button>
            </Space>
          }
        />
      }
    >
      <div className="audit-workspace">
        {/* Statistics */}
        {stats && (
          <MetricStrip className="ds-metrics--four audit-stats-strip" aria-label="Audit summary">
            <Metric label="Total events" value={stats.totalLogs.toLocaleString()} />
            <Metric label="Success rate" value={`${stats.successRate}%`} />
            <Metric
              label="Failed actions"
              value={stats.failedActions.toLocaleString()}
              tone={stats.failedActions > 0 ? 'bad' : 'neutral'}
            />
            <Metric label="Action types" value={stats.actionsByType.length} />
          </MetricStrip>
        )}

        {/* Filters */}
        <FilterBar
          rightSlot={
            filters.startDate ||
            filters.endDate ||
            filters.action ||
            filters.resourceType ||
            filters.success !== undefined ||
            searchInput ? (
              <Button
                size="small"
                onClick={() => {
                  setSearchInput('');
                  setFilters({
                    startDate: undefined,
                    endDate: undefined,
                    action: undefined,
                    resourceType: undefined,
                    success: undefined,
                    search: undefined,
                    page: 1,
                    limit: filters.limit,
                  });
                }}
              >
                Clear filters
              </Button>
            ) : null
          }
        >
          <Form className="audit-filter-grid" layout="vertical">
            <Form.Item label="Date range">
              <RangePicker
                value={[
                  filters.startDate ? dayjs(filters.startDate) : null,
                  filters.endDate ? dayjs(filters.endDate) : null,
                ]}
                onChange={(dates) => {
                  setFilters({
                    ...filters,
                    startDate: dates?.[0]?.format('YYYY-MM-DD'),
                    endDate: dates?.[1]?.format('YYYY-MM-DD'),
                    page: 1,
                  });
                }}
                className="console-width-full"
              />
            </Form.Item>
            <Form.Item label="Search">
              <Input
                placeholder="Search user, action, resource..."
                prefix={<GatewayIcon name="SearchOutlined" />}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                allowClear
              />
            </Form.Item>
            <Form.Item label="Action">
              <Select
                aria-label="Action"
                placeholder="All actions"
                value={filters.action}
                onChange={(value) => setFilters({ ...filters, action: value, page: 1 })}
                allowClear
                options={actionTypes.map((action) => ({ value: action, label: action.replace(/_/g, ' ') }))}
              />
            </Form.Item>
            <Form.Item label="Resource">
              <Select
                aria-label="Resource"
                placeholder="All resources"
                value={filters.resourceType}
                onChange={(value) => setFilters({ ...filters, resourceType: value, page: 1 })}
                allowClear
                options={resourceTypes.map((resource) => ({ value: resource, label: resource }))}
              />
            </Form.Item>
            <Form.Item label="Status">
              <Select
                aria-label="Status"
                placeholder="All statuses"
                value={filters.success}
                onChange={(value) => setFilters({ ...filters, success: value, page: 1 })}
                allowClear
              >
                <Select.Option value={true}>Success Only</Select.Option>
                <Select.Option value={false}>Failed Only</Select.Option>
              </Select>
            </Form.Item>
          </Form>
        </FilterBar>

        {/* Audit Logs Table */}
        <section className="audit-table-section" aria-label="Audit events">
          <div className="audit-table-heading">
            <div>
              <Text strong>Audit events</Text>
              {logsData && <Text type="secondary">{logsData.pagination.total.toLocaleString()} total</Text>}
            </div>
            {logsData && (
              <Text type="secondary">
                Page {logsData.pagination.page} of {logsData.pagination.totalPages}
              </Text>
            )}
          </div>
          <ModernTable
            columns={columns}
            dataSource={logsData?.logs || []}
            rowKey="_id"
            loading={isLoading}
            pagination={{
              current: filters.page,
              pageSize: filters.limit,
              total: logsData?.pagination.total || 0,
              showSizeChanger: true,
              showTotal: (total) => `Total ${total} events`,
              onChange: (page, pageSize) => {
                setFilters({ ...filters, page, limit: pageSize });
              },
            }}
            size="small"
            scroll={{ x: 1200 }}
            emptyState={{
              title: 'No audit events match these filters',
              description: 'Change or clear a filter to see more activity.',
            }}
          />
        </section>
      </div>

      {/* Detail Modal */}
      <Modal
        title="Audit Log Details"
        open={!!selectedLog}
        onCancel={() => setSelectedLog(null)}
        footer={[
          <Button key="close" onClick={() => setSelectedLog(null)}>
            Close
          </Button>,
        ]}
        width={800}
      >
        {selectedLog && (
          <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Timestamp" span={2}>
                {dayjs(selectedLog.timestamp).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="Action">
                <StatusBadge
                  label={selectedLog.action.replace(/_/g, ' ').toUpperCase()}
                  variant={getActionVariant(selectedLog.action)}
                  showIcon={false}
                />
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusBadge status={selectedLog.success ? 'SUCCESS' : 'FAILED'} />
              </Descriptions.Item>
              <Descriptions.Item label="Resource Type">{safeStr(selectedLog.resourceType)}</Descriptions.Item>
              <Descriptions.Item label="Resource ID">{safeStr(selectedLog.resourceId)}</Descriptions.Item>
              <Descriptions.Item label="User Email">{safeStr(selectedLog.userEmail) || 'System'}</Descriptions.Item>
              <Descriptions.Item label="User Role">{safeStr(selectedLog.userRole)}</Descriptions.Item>
              <Descriptions.Item label="Organization ID">{safeStr(selectedLog.orgId)}</Descriptions.Item>
              <Descriptions.Item label="User ID">{safeStr(selectedLog.userId)}</Descriptions.Item>
              <Descriptions.Item label="IP Address">{safeStr(selectedLog.ipAddress)}</Descriptions.Item>
              <Descriptions.Item label="User Agent" span={2}>
                {safeStr(selectedLog.userAgent)}
              </Descriptions.Item>
              {selectedLog.errorMessage && (
                <Descriptions.Item label="Error Message" span={2}>
                  <Text type="danger">{safeStr(selectedLog.errorMessage)}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {selectedLog.changes && (
              <>
                <Divider>Changes</Divider>
                <Row gutter={16}>
                  <Col span={12}>
                    <Panel title="Before">
                      <pre className="console-code-scroll-caption">
                        {JSON.stringify(selectedLog.changes.before ?? null, null, 2)}
                      </pre>
                    </Panel>
                  </Col>
                  <Col span={12}>
                    <Panel title="After">
                      <pre className="console-code-scroll-caption">
                        {JSON.stringify(selectedLog.changes.after ?? null, null, 2)}
                      </pre>
                    </Panel>
                  </Col>
                </Row>
              </>
            )}

            {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
              <>
                <Divider>Metadata</Divider>
                <pre className="console-code-scroll-caption">{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
              </>
            )}
          </Space>
        )}
      </Modal>
    </PageTemplate>
  );
};
