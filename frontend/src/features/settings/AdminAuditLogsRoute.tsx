import { useMemo, useState } from 'react';
import { Card, DatePicker, Input, Select, Space, message } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Heading } from '@astryxdesign/core/Heading';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../app/auth-context';
import { PageHeader } from '../../components/common/PageHeader';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import {
  exportAdminAuditLogs,
  exportAdminAuditTrend,
  listAdminAuditLogs,
  type AdminAuditLog,
} from '../../services/api';
import { createExportProgress } from '../../utils/export-progress';
import { ModernTable } from '../../components/common/ModernTable';
import { StatePanel } from '../../components/common/StatePanel';
import { Button } from '../../components/common/LegacyButton';

const { RangePicker } = DatePicker;

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const buildSummary = (record: AdminAuditLog) => {
  if (record.matched !== null || record.modified !== null) {
    return `Matched ${record.matched ?? 0}, Updated ${record.modified ?? 0}`;
  }
  if (record.integrations !== null || record.deleted !== null) {
    return `Integrations ${record.integrations ?? 0}, Deleted ${record.deleted ?? 0}`;
  }
  if (record.count !== null) {
    return `Count ${record.count}`;
  }
  return '—';
};

export const AdminAuditLogsRoute = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';
  const { spacing, token, borderRadius } = useDesignTokens();
  const [messageApi, contextHolder] = message.useMessage();
  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [adminIdFilter, setAdminIdFilter] = useState('');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<[string | null, string | null] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [bucketDays, setBucketDays] = useState(7);

  const filterPayload = useMemo(
    () => ({
      action: actionFilter,
      role: roleFilter,
      adminId: adminIdFilter || undefined,
      search: search || undefined,
      startDate: dateRange?.[0] || undefined,
      endDate: dateRange?.[1] || undefined,
      days: bucketDays,
      page,
      limit: pageSize,
    }),
    [actionFilter, roleFilter, adminIdFilter, search, dateRange, bucketDays, page, pageSize]
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['adminAuditLogs', filterPayload],
    queryFn: () => listAdminAuditLogs(filterPayload),
    enabled: isAdmin,
    staleTime: 5 * 1000,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const summary = data?.summary;
  const trendData = summary?.dailyCounts || [];
  const trendMax = Math.max(1, ...trendData.map((item) => item.count || 0));
  const actionBreakdown = summary?.actionBreakdown || [];
  const actionMax = Math.max(1, ...actionBreakdown.map((item) => item.count || 0));

  const columns = [
    {
      title: 'Timestamp',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatDate(value),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      render: (value: string) => <Text type="code">{value}</Text>,
    },
    {
      title: 'Admin',
      key: 'admin',
      render: (_: any, record: AdminAuditLog) => (
        <Space direction="vertical" size={0}>
          <Text>{record.adminEmail || '—'}</Text>
          <Text type="supporting" color="secondary">
            {record.adminId || '—'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'adminRole',
      key: 'adminRole',
      render: (value: string) => value || '—',
    },
    {
      title: 'Summary',
      key: 'summary',
      render: (_: any, record: AdminAuditLog) => buildSummary(record),
    },
  ];

  return (
    <div>
      {contextHolder}
      <PageHeader title="Admin Audit Logs" description="Track admin changes and bulk operations." />

      {!isAdmin ? (
        <StatePanel
          title="Admin access required"
          description="You need an admin account to view audit logs."
          size="compact"
        />
      ) : (
        <>
          <Card className="panel admin-audit-summary-panel">
            <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
              <Text weight="semibold">Summary</Text>
              <Space wrap>
                <Card size="small" className="admin-audit-total-card">
                  <Text type="supporting" color="secondary">
                    Total Events
                  </Text>
                  <Heading level={3} className="console-margin-none">
                    {summary?.total ?? total}
                  </Heading>
                </Card>
                <Card size="small" className="admin-audit-trend-card">
                  <Space align="center" className="console-width-full-between">
                    <Text type="supporting" color="secondary">
                      Trend
                    </Text>
                    <Select
                      value={bucketDays}
                      onChange={(value) => {
                        setBucketDays(value);
                        setPage(1);
                      }}
                      options={[
                        { label: 'Last 7 days', value: 7 },
                        { label: 'Last 30 days', value: 30 },
                        { label: 'Last 90 days', value: 90 },
                      ]}
                      size="small"
                      className="admin-audit-trend-range"
                    />
                  </Space>
                  <div className="admin-audit-trend-bars">
                    {trendData.length === 0 && (
                      <Text type="supporting" color="secondary">
                        No data
                      </Text>
                    )}
                    {trendData.map((item) => (
                      <div key={item.date} className="admin-audit-trend-day">
                        <div
                          style={{
                            width: 16,
                            height: Math.max(6, Math.round((item.count / trendMax) * 64)),
                            borderRadius: 4,
                            background: token.colorPrimary,
                          }}
                        />
                        <Text type="supporting" color="secondary">
                          {bucketDays > 14 ? item.date.slice(5) : item.date.slice(5)}
                        </Text>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="small"
                    className="console-margin-top-3"
                    onClick={async () => {
                      const { onProgress, finish } = createExportProgress(messageApi, 'Export Trend CSV');
                      try {
                        await exportAdminAuditTrend(
                          {
                            action: actionFilter,
                            role: roleFilter,
                            adminId: adminIdFilter || undefined,
                            search: search || undefined,
                            startDate: dateRange?.[0] || undefined,
                            endDate: dateRange?.[1] || undefined,
                            days: bucketDays,
                          },
                          { onProgress }
                        );
                        finish('Trend export complete');
                      } catch (error: any) {
                        finish(error?.message || 'Trend export failed', true);
                      }
                    }}
                  >
                    Export Trend CSV
                  </Button>
                </Card>
                <Card size="small" className="admin-audit-breakdown-card">
                  <Text type="supporting" color="secondary">
                    Top Actions
                  </Text>
                  <Space direction="vertical" size={6} className="console-margin-top-2 console-width-full">
                    {actionBreakdown.length === 0 && (
                      <Text type="supporting" color="secondary">
                        No data
                      </Text>
                    )}
                    {actionBreakdown.map((item) => (
                      <div key={item.action} className="console-flex-center-gap-2">
                        <Text className="admin-audit-action-label" maxLines={1}>
                          {item.action}
                        </Text>
                        <div className="admin-audit-breakdown-track">
                          <div
                            style={{
                              height: 8,
                              width: `${Math.round((item.count / actionMax) * 100)}%`,
                              background: token.colorPrimaryHover,
                              borderRadius: borderRadius.full,
                            }}
                          />
                        </div>
                        <Text hasTabularNumbers>{item.count}</Text>
                      </div>
                    ))}
                  </Space>
                </Card>
                <Card size="small" className="admin-audit-admins-card">
                  <Text type="supporting" color="secondary">
                    Top Admins
                  </Text>
                  <Space direction="vertical" size={4} className="console-margin-top-2">
                    {(summary?.topAdmins || []).length === 0 && (
                      <Text type="supporting" color="secondary">
                        No data
                      </Text>
                    )}
                    {(summary?.topAdmins || []).map((item) => (
                      <Space key={item.adminEmail} size="small">
                        <Text type="code">{item.adminEmail}</Text>
                        <Text hasTabularNumbers>{item.count}</Text>
                      </Space>
                    ))}
                  </Space>
                </Card>
              </Space>
            </Space>
          </Card>

          <Card className="panel console-card-radius">
            <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
              <Space wrap>
                <Select
                  allowClear
                  placeholder="Action"
                  value={actionFilter}
                  onChange={(value) => {
                    setActionFilter(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'RATE_LIMITS_BULK_APPLY', value: 'RATE_LIMITS_BULK_APPLY' },
                    { label: 'RATE_LIMITS_BULK_RESET', value: 'RATE_LIMITS_BULK_RESET' },
                    { label: 'RATE_LIMITS_EXPORT', value: 'RATE_LIMITS_EXPORT' },
                  ]}
                  className="admin-audit-action-filter"
                />
                <Select
                  allowClear
                  placeholder="Role"
                  value={roleFilter}
                  onChange={(value) => {
                    setRoleFilter(value);
                    setPage(1);
                  }}
                  options={[
                    { label: 'ADMIN', value: 'ADMIN' },
                    { label: 'ORG_ADMIN', value: 'ORG_ADMIN' },
                  ]}
                  className="admin-audit-role-filter"
                />
                <Input
                  placeholder="Admin ID"
                  value={adminIdFilter}
                  onChange={(event) => {
                    setAdminIdFilter(event.target.value);
                    setPage(1);
                  }}
                  className="admin-audit-admin-filter"
                />
                <Input.Search
                  placeholder="Search action/admin"
                  allowClear
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onSearch={() => {
                    setPage(1);
                    refetch();
                  }}
                  className="admin-audit-search-filter"
                />
                <RangePicker
                  onChange={(values) => {
                    if (!values || values.length !== 2) {
                      setDateRange(null);
                      return;
                    }
                    setDateRange([values[0]?.toISOString() || null, values[1]?.toISOString() || null]);
                  }}
                />
                <Button onClick={() => refetch()}>Refresh</Button>
                <Button
                  onClick={async () => {
                    const { onProgress, finish } = createExportProgress(messageApi, 'Export CSV');
                    try {
                      await exportAdminAuditLogs(
                        {
                          action: actionFilter,
                          role: roleFilter,
                          adminId: adminIdFilter || undefined,
                          search: search || undefined,
                          startDate: dateRange?.[0] || undefined,
                          endDate: dateRange?.[1] || undefined,
                        },
                        { onProgress }
                      );
                      finish('Export complete');
                    } catch (error: any) {
                      finish(error?.message || 'Export failed', true);
                    }
                  }}
                >
                  Export CSV
                </Button>
              </Space>

              <ModernTable
                rowKey="id"
                columns={columns}
                dataSource={items}
                loading={isLoading}
                expandable={{
                  expandedRowRender: (record) => (
                    <Space direction="vertical" size={8} className="console-width-full">
                      <Text type="supporting" color="secondary">
                        Filters:
                      </Text>
                      <pre className="clamped-code-block console-code-reset-wrap">
                        {JSON.stringify(record.filters || {}, null, 2)}
                      </pre>
                      <Text type="supporting" color="secondary">
                        Rate Limits:
                      </Text>
                      <pre className="clamped-code-block console-code-reset-wrap">
                        {JSON.stringify(record.rateLimits || {}, null, 2)}
                      </pre>
                    </Space>
                  ),
                }}
                pagination={{
                  current: page,
                  pageSize,
                  total,
                  showSizeChanger: true,
                  onChange: (nextPage, nextPageSize) => {
                    setPage(nextPage);
                    setPageSize(nextPageSize || pageSize);
                  },
                }}
              />
            </Space>
          </Card>
        </>
      )}
    </div>
  );
};
