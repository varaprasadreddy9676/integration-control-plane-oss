import { useEffect, useState } from 'react';
import { Card, Space, DatePicker, Input, Select, Statistic, Row, Col, Drawer, Descriptions } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import {
  getUserActivities,
  getUserActivityStats,
  getActivityEvents,
  getActivityCategories,
  UserActivity,
  UserActivityStats,
} from '../../services/api';
import { PageHeader } from '../../components/common/PageHeader';
import { PageTemplate } from '../../components/common/PageTemplate';
import { FilterBar } from '../../components/common/FilterBar';
import { StatusBadge } from '../../components/common/StatusBadge';
import { ModernTable } from '../../components/common/ModernTable';
import { Button } from '../../components/common/LegacyButton';
import { InlineNotice as Notice } from '../../components/common';

const { RangePicker } = DatePicker;
const defaultActivityRange = (): [Dayjs, Dayjs] => [dayjs().subtract(30, 'days'), dayjs()];

export function UserActivityRoute() {
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(defaultActivityRange);
  const [customDateRange, setCustomDateRange] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [userIdInput, setUserIdInput] = useState('');
  const [searchText, setSearchText] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<string | undefined>();
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedActivity, setSelectedActivity] = useState<UserActivity | null>(null);
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = searchInput.trim();
      const userId = userIdInput.trim() || undefined;
      setSearchText((current) => (current === search ? current : search));
      setSelectedUserId((current) => (current === userId ? current : userId));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, userIdInput]);

  // Fetch activities
  const {
    data: activitiesData,
    isLoading: activitiesLoading,
    error: activitiesError,
    refetch,
  } = useQuery({
    queryKey: [
      'user-activities',
      dateRange,
      searchText,
      selectedEvent,
      selectedCategory,
      selectedUserId,
      page,
      pageSize,
    ],
    queryFn: async () => {
      return await getUserActivities({
        startDate: dateRange[0].toISOString(),
        endDate: dateRange[1].toISOString(),
        page,
        limit: pageSize,
        ...(searchText && { search: searchText }),
        ...(selectedEvent && { event: selectedEvent }),
        ...(selectedCategory && { category: selectedCategory }),
        ...(selectedUserId && { userId: selectedUserId }),
      });
    },
    staleTime: 30_000,
  });

  // Fetch statistics
  const { data: statsData } = useQuery({
    queryKey: ['user-activity-stats', dateRange, selectedUserId],
    queryFn: async () => {
      return await getUserActivityStats({
        startDate: dateRange[0].toISOString(),
        endDate: dateRange[1].toISOString(),
        ...(selectedUserId && { userId: selectedUserId }),
      });
    },
  });

  // Fetch available event types
  const { data: eventTypesData } = useQuery({
    queryKey: ['activity-events'],
    queryFn: getActivityEvents,
  });

  // Fetch available categories
  const { data: categoriesData } = useQuery({
    queryKey: ['activity-categories'],
    queryFn: getActivityCategories,
  });

  const activities: UserActivity[] = activitiesData?.activities || [];
  const total = activitiesData?.pagination?.total || 0;
  const stats: UserActivityStats | undefined = statsData;

  const handleViewDetails = (activity: UserActivity) => {
    setSelectedActivity(activity);
    setDetailDrawerOpen(true);
  };

  const getCategoryVariant = (category: string) => {
    const variants: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'blue' | 'orange' | 'red'> = {
      authentication: 'success',
      navigation: 'neutral',
      feature_usage: 'blue',
      data_operation: 'orange',
      administration: 'info',
      error: 'error',
    };
    return variants[category] || 'neutral';
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
          <Text color="secondary" className="console-type-caption">
            {dayjs(timestamp).format('HH:mm:ss')}
          </Text>
        </Space>
      ),
    },
    {
      title: 'User',
      key: 'user',
      width: 200,
      render: (record: UserActivity) => (
        <Space direction="vertical" size={0}>
          <Text weight="semibold">{record.userEmail}</Text>
          <Text color="secondary" className="console-type-caption">
            {record.userRole}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Event',
      dataIndex: 'event',
      key: 'event',
      width: 200,
      render: (event: string, record: UserActivity) => (
        <Space direction="vertical" size={0}>
          <Text>{event}</Text>
          <StatusBadge
            label={record.category.replace(/_/g, ' ')}
            variant={getCategoryVariant(record.category)}
            showIcon={false}
            size="small"
          />
        </Space>
      ),
    },
    {
      title: 'Page/Feature',
      key: 'location',
      width: 200,
      render: (record: UserActivity) => (
        <Space direction="vertical" size={0}>
          {record.page && <Text>{record.page}</Text>}
          {record.feature && (
            <Text color="secondary" className="console-type-caption">
              {record.feature}
            </Text>
          )}
          {!record.page && !record.feature && <Text color="secondary">-</Text>}
        </Space>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 150,
      render: (action: string | null) => action || <Text color="secondary">-</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'success',
      key: 'success',
      width: 100,
      render: (success: boolean) => <StatusBadge status={success ? 'SUCCESS' : 'FAILED'} size="small" />,
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      width: 100,
      render: (duration: number | null) => (duration ? <Text>{duration}ms</Text> : <Text color="secondary">-</Text>),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      fixed: 'right' as const,
      render: (record: UserActivity) => (
        <Button size="small" icon={<GatewayIcon name="EyeOutlined" />} onClick={() => handleViewDetails(record)}>
          Details
        </Button>
      ),
    },
  ];

  return (
    <PageTemplate
      header={
        <PageHeader
          title="User Activity"
          description="Audit user actions across the integration gateway"
          actions={
            <Button icon={<GatewayIcon name="ReloadOutlined" />} onClick={() => refetch()} loading={activitiesLoading}>
              Refresh
            </Button>
          }
        />
      }
    >
      <div className="activity-workspace">
        {stats && (
          <div className="activity-stats-strip" aria-label="Activity summary">
            <Row gutter={16}>
              <Col xs={12} md={6}>
                <Statistic
                  title="Activities in period"
                  value={stats.totalActivities}
                  prefix={<GatewayIcon name="ClockCircleOutlined" />}
                />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="Unique users"
                  value={stats.uniqueUsers}
                  prefix={<GatewayIcon name="UserOutlined" />}
                />
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="Most common event"
                  value={stats.eventsByType[0]?.event?.replace(/[._]+/g, ' ') || '—'}
                />
                <Text color="secondary">{stats.eventsByType[0]?.count || 0} occurrences</Text>
              </Col>
              <Col xs={12} md={6}>
                <Statistic
                  title="Most common category"
                  value={stats.activitiesByCategory[0]?.category?.replace(/_/g, ' ') || '—'}
                />
                <Text color="secondary">{stats.activitiesByCategory[0]?.count || 0} activities</Text>
              </Col>
            </Row>
          </div>
        )}

        <FilterBar
          rightSlot={
            customDateRange || searchInput || userIdInput || selectedEvent || selectedCategory || selectedUserId ? (
              <Button
                size="small"
                onClick={() => {
                  setDateRange(defaultActivityRange());
                  setCustomDateRange(false);
                  setSearchInput('');
                  setSearchText('');
                  setSelectedEvent(undefined);
                  setSelectedCategory(undefined);
                  setSelectedUserId(undefined);
                  setUserIdInput('');
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            ) : null
          }
        >
          <div className="activity-filter-grid">
            <label className="activity-filter-field">
              <span>Date range</span>
              <RangePicker
                aria-label="Activity date range"
                value={dateRange}
                onChange={(dates) => {
                  if (dates?.[0] && dates[1]) {
                    setDateRange([dates[0], dates[1]]);
                    setCustomDateRange(true);
                    setPage(1);
                  }
                }} className="console-width-full"
                format="MMM DD, YYYY"
              />
            </label>
            <label className="activity-filter-field">
              <span>Search</span>
              <Input
                aria-label="Search activity"
                placeholder="Email, event, page, or feature"
                prefix={<GatewayIcon name="SearchOutlined" />}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                allowClear
              />
            </label>
            <label className="activity-filter-field">
              <span>Event</span>
              <Select
                aria-label="Filter by event"
                placeholder="All events"
                value={selectedEvent}
                onChange={(value) => {
                  setSelectedEvent(value);
                  setPage(1);
                }}
                allowClear
                options={eventTypesData?.events?.map((event) => ({ label: event, value: event }))}
              />
            </label>
            <label className="activity-filter-field">
              <span>Category</span>
              <Select
                aria-label="Filter by category"
                placeholder="All categories"
                value={selectedCategory}
                onChange={(value) => {
                  setSelectedCategory(value);
                  setPage(1);
                }}
                allowClear
                options={categoriesData?.categories?.map((category) => ({
                  label: category.replace(/_/g, ' '),
                  value: category,
                }))}
              />
            </label>
            <label className="activity-filter-field">
              <span>User ID</span>
              <Input
                aria-label="Filter by user ID"
                placeholder="Exact user ID"
                value={userIdInput}
                onChange={(event) => setUserIdInput(event.target.value)}
                allowClear
              />
            </label>
          </div>
        </FilterBar>

        {activitiesError && (
          <Notice
            type="error"
            message="Could not load user activity"
            description={activitiesError instanceof Error ? activitiesError.message : 'An unexpected error occurred.'}
            action={
              <Button size="small" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        )}

        <section className="activity-table-section" aria-label="User activity events">
          <div className="activity-table-heading">
            <div>
              <Text weight="semibold">Activity events</Text>
              <Text color="secondary">{total.toLocaleString()} total</Text>
            </div>
          </div>
          <ModernTable
            columns={columns}
            dataSource={activities}
            rowKey="_id"
            loading={activitiesLoading}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (newPage, newPageSize) => {
                setPage(newPage);
                setPageSize(newPageSize);
              },
              showSizeChanger: true,
              showTotal: (count) => `Total ${count} activities`,
              pageSizeOptions: ['25', '50', '100', '200'],
            }}
            scroll={{ x: 1200 }}
            emptyState={{
              title: 'No activity matches these filters',
              description: 'Change the date range or clear a filter.',
            }}
          />
        </section>

        {/* Detail Drawer */}
        <Drawer
          title="Activity Details"
          placement="right"
          width={600}
          open={detailDrawerOpen}
          onClose={() => setDetailDrawerOpen(false)}
        >
          {selectedActivity && (
            <Space direction="vertical" size="large" className="console-width-full">
              <Card title="Event Information" size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Event">{selectedActivity.event}</Descriptions.Item>
                  <Descriptions.Item label="Category">
                    <StatusBadge
                      label={selectedActivity.category.replace(/_/g, ' ')}
                      variant={getCategoryVariant(selectedActivity.category)}
                      showIcon={false}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="Timestamp">
                    {dayjs(selectedActivity.timestamp).format('MMM DD, YYYY HH:mm:ss')}
                  </Descriptions.Item>
                  <Descriptions.Item label="Status">
                    <StatusBadge status={selectedActivity.success ? 'SUCCESS' : 'FAILED'} />
                  </Descriptions.Item>
                  {selectedActivity.errorMessage && (
                    <Descriptions.Item label="Error">{selectedActivity.errorMessage}</Descriptions.Item>
                  )}
                </Descriptions>
              </Card>

              <Card title="User Information" size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Email">{selectedActivity.userEmail}</Descriptions.Item>
                  <Descriptions.Item label="Role">{selectedActivity.userRole}</Descriptions.Item>
                  <Descriptions.Item label="User ID">{selectedActivity.userId}</Descriptions.Item>
                  <Descriptions.Item label="Organization ID">{selectedActivity.orgId}</Descriptions.Item>
                </Descriptions>
              </Card>

              <Card title="Location & Context" size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Page">{selectedActivity.page || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Feature">{selectedActivity.feature || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Action">{selectedActivity.action || '-'}</Descriptions.Item>
                  {selectedActivity.duration && (
                    <Descriptions.Item label="Duration">{selectedActivity.duration}ms</Descriptions.Item>
                  )}
                  <Descriptions.Item label="Session ID">{selectedActivity.sessionId || '-'}</Descriptions.Item>
                </Descriptions>
              </Card>

              <Card title="Technical Details" size="small">
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="IP Address">{selectedActivity.ipAddress || '-'}</Descriptions.Item>
                  <Descriptions.Item label="User Agent">
                    <Text maxLines={1} className="ui-extracted-cf2cebaa76">
                      {selectedActivity.userAgent || '-'}
                    </Text>
                  </Descriptions.Item>
                </Descriptions>
              </Card>

              {selectedActivity.changes && (
                <Card title="Changes" size="small">
                  <Space direction="vertical" className="console-width-full">
                    {selectedActivity.changes.before && (
                      <div>
                        <Text weight="semibold">Before:</Text>
                        <pre className="ui-extracted-ba9e913f21">
                          {JSON.stringify(selectedActivity.changes.before, null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedActivity.changes.after && (
                      <div>
                        <Text weight="semibold">After:</Text>
                        <pre className="ui-extracted-ba9e913f21">
                          {JSON.stringify(selectedActivity.changes.after, null, 2)}
                        </pre>
                      </div>
                    )}
                  </Space>
                </Card>
              )}

              {selectedActivity.metadata && Object.keys(selectedActivity.metadata).length > 0 && (
                <Card title="Metadata" size="small">
                  <pre className="console-type-caption">
                    {JSON.stringify(selectedActivity.metadata, null, 2)}
                  </pre>
                </Card>
              )}

              {selectedActivity.target && (
                <Card title="Target" size="small">
                  <pre className="console-type-caption">
                    {JSON.stringify(selectedActivity.target, null, 2)}
                  </pre>
                </Card>
              )}
            </Space>
          )}
        </Drawer>
      </div>
    </PageTemplate>
  );
}
