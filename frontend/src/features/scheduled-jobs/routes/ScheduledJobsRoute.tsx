import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { buildUrlWithOrgId, useNavigateWithParams } from '../../../utils/navigation';
import { Card, Space, Tooltip, message, Modal, Select, Divider, Grid } from '@/components/common/LegacyAntdControls';
import { Text } from '../../../components/common/LegacyTypography';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { ModernTable } from '../../../components/common/ModernTable';
import { ListActions, SearchInput } from '../../../components/common/ListControls';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { cssVar, useDesignTokens, withAlpha } from '../../../design-system/utils';
import { getAllScheduledJobs, deleteScheduledJob, executeScheduledJob } from '../../../services/api';
import { formatDateTime, formatDuration } from '../../../utils/format';
import { markMorphSource } from '../../../design-system/view-transition';
import { prefetchDetailRoute } from '../../../app/route-prefetch';
import { Button } from '../../../components/common/LegacyButton';

interface ScheduledJobsRouteProps {
  hideHeader?: boolean;
  isActive?: boolean;
}

export const ScheduledJobsRoute = ({ hideHeader = false, isActive = true }: ScheduledJobsRouteProps = {}) => {
  const navigate = useNavigateWithParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const orgId = searchParams.get('orgId');

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'paused' | undefined>();

  // Fetch scheduled jobs
  const {
    data: jobs = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['scheduled-jobs', orgId],
    queryFn: () => getAllScheduledJobs(orgId!),
    enabled: isActive,
    staleTime: 30_000, // backend batch-fetches last execution per job — avoid redundant N+1 round trips
    placeholderData: (prev: any) => prev,
  });

  // Filter jobs
  const filteredJobs = useMemo(() => {
    let filtered = jobs;

    // Apply status filter
    if (statusFilter === 'active') {
      filtered = filtered.filter((job: any) => job.isActive);
    } else if (statusFilter === 'paused') {
      filtered = filtered.filter((job: any) => !job.isActive);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (job: any) =>
          job.name.toLowerCase().includes(query) ||
          job.type?.toLowerCase().includes(query) ||
          job.targetUrl?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [jobs, searchQuery, statusFilter]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => deleteScheduledJob(jobId, orgId!),
    onSuccess: () => {
      message.success('Scheduled job deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
      setSelectedJobId(null);
    },
    onError: () => {
      message.error('Failed to delete scheduled job');
    },
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: (jobId: string) => executeScheduledJob(jobId, orgId!),
    onSuccess: () => {
      message.success('Job execution triggered');
      queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] });
    },
    onError: () => {
      message.error('Failed to trigger job execution');
    },
  });

  const handleDelete = (jobId: string) => {
    Modal.confirm({
      title: 'Delete Scheduled Job',
      content: 'Are you sure you want to delete this scheduled job? This action cannot be undone.',
      okText: 'Delete',
      okType: 'danger',
      onOk: () => deleteMutation.mutate(jobId),
    });
  };

  const handleExecute = (jobId: string) => {
    setSelectedJobId(jobId);
    executeMutation.mutate(jobId);
  };

  const columns = [
    {
      title: 'Job Name',
      dataIndex: 'name',
      key: 'name',
      sorter: (a: any, b: any) => a.name.localeCompare(b.name),
      render: (name: string, record: any) => (
        <Space direction="vertical" size="small">
          <Link
            to={buildUrlWithOrgId(`/scheduled-jobs/${record._id}`)}
            state={{ title: name }}
            onClick={(event) => markMorphSource(event.currentTarget)}
            onMouseEnter={() => prefetchDetailRoute('scheduledJob')}
            onFocus={() => prefetchDetailRoute('scheduledJob')}
            className="console-text-accent console-type-control console-font-weight-semibold"
          >
            {name}
          </Link>
          {record.type && <Text type="secondary">{record.type === 'SCRIPT_JOB' ? 'Script job' : record.type}</Text>}
        </Space>
      ),
    },
    {
      title: 'Schedule',
      dataIndex: 'schedule',
      key: 'schedule',
      render: (schedule: any) => (
        <Space direction="vertical" size="small">
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[1] }}>
            <GatewayIcon name="ClockCircleOutlined" className="console-text-accent" />
            <Text className="ui-extracted-021192a8dd">
              {schedule.type === 'CRON' ? schedule.expression : `Every ${schedule.intervalMs / 1000}s`}
            </Text>
          </div>
          {schedule.timezone && (
            <Text type="secondary" className="console-type-caption">
              {schedule.timezone}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Data Source',
      dataIndex: 'dataSource',
      key: 'dataSource',
      render: (dataSource: any, record: any) => {
        if (record.direction === 'SCRIPT_JOB' || !dataSource) {
          return <Text type="secondary">User script</Text>;
        }
        return <Text type="secondary">{dataSource.type === 'MONGODB' ? 'MongoDB' : dataSource.type}</Text>;
      },
    },
    {
      title: 'Target',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      ellipsis: true,
      render: (url: string, record: any) => {
        if (record.direction === 'SCRIPT_JOB' || !url) {
          return (
            <Text type="secondary" className="console-type-caption">
              —
            </Text>
          );
        }
        return (
          <Tooltip title={url}>
            <Text type="secondary" className="console-type-caption">
              {url}
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: 'Last Execution',
      dataIndex: 'lastExecution',
      key: 'lastExecution',
      sorter: (a: any, b: any) => {
        const aTime = a.lastExecution?.startedAt ? new Date(a.lastExecution.startedAt).getTime() : 0;
        const bTime = b.lastExecution?.startedAt ? new Date(b.lastExecution.startedAt).getTime() : 0;
        return aTime - bTime;
      },
      render: (lastExecution: any) => {
        if (!lastExecution) {
          return (
            <Text type="secondary" className="console-type-caption">
              Never executed
            </Text>
          );
        }

        const statusIcon =
          lastExecution.status === 'SUCCESS' ? (
            <GatewayIcon name="CheckCircleOutlined" className="console-text-success" />
          ) : lastExecution.status === 'FAILED' ? (
            <GatewayIcon name="CloseCircleOutlined" className="console-text-error" />
          ) : (
            <GatewayIcon name="SyncOutlined" spin className="console-text-accent" />
          );

        return (
          <Space direction="vertical" size="small">
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[1] }}>
              {statusIcon}
              <StatusBadge
                label={
                  lastExecution.status === 'SUCCESS'
                    ? 'Succeeded'
                    : lastExecution.status === 'FAILED'
                      ? 'Failed'
                      : 'Running'
                }
                variant={
                  lastExecution.status === 'SUCCESS' ? 'success' : lastExecution.status === 'FAILED' ? 'error' : 'info'
                }
                size="small"
              />
              <Text type="secondary" className="console-type-caption">
                {formatDateTime(lastExecution.startedAt)}
              </Text>
            </div>
            {lastExecution.recordsFetched !== undefined && (
              <Text type="secondary" className="console-type-caption">
                {lastExecution.recordsFetched} records • {formatDuration(lastExecution.durationMs)}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      filters: [
        { text: 'Active', value: true },
        { text: 'Paused', value: false },
      ],
      onFilter: (value: any, record: any) => record.isActive === value,
      render: (isActive: boolean) => (
        <StatusBadge label={isActive ? 'Active' : 'Paused'} variant={isActive ? 'success' : 'neutral'} size="small" />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title="View/Edit">
            <Button
              type="text"
              size="small"
              aria-label={`Edit ${record.name}`}
              icon={<GatewayIcon name="EditOutlined" />}
              onClick={() => navigate(`/scheduled-jobs/${record._id}`)}
            />
          </Tooltip>
          <Tooltip title="Execute Now">
            <Button
              type="text"
              size="small"
              aria-label={`Execute ${record.name} now`}
              icon={<GatewayIcon name="PlayCircleOutlined" />}
              onClick={() => handleExecute(record._id)}
              loading={executeMutation.isPending && selectedJobId === record._id}
              disabled={!record.isActive}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              type="text"
              size="small"
              danger
              aria-label={`Delete ${record.name}`}
              icon={<GatewayIcon name="DeleteOutlined" />}
              onClick={() => {
                setSelectedJobId(record._id);
                handleDelete(record._id);
              }}
              loading={deleteMutation.isPending && selectedJobId === record._id}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <PageTemplate
      as={hideHeader ? 'div' : 'main'}
      className="scheduled-jobs-template"
      header={
        !hideHeader ? (
          <PageHeader
            title="Scheduled Jobs"
            description="Time-driven batch integrations that run on cron schedules or intervals"
            breadcrumb={[{ label: 'Configuration', path: '/integrations' }, { label: 'Scheduled Jobs' }]}
            compact
            actions={
              <Button
                type="primary"
                size="middle"
                icon={<GatewayIcon name="PlusOutlined" />}
                onClick={() => navigate('/scheduled-jobs/new')}
              >
                Create Scheduled Job
              </Button>
            }
          />
        ) : undefined
      }
    >
      <Card size="small">
        {/* Compact Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: spacing[2],
            padding: spacing[2],
            borderBottom: `1px solid ${cssVar.border.default}`,
            background: withAlpha(cssVar.bg.subtle, 0.4),
            alignItems: 'center',
          }}
        >
          {/* Scope counts are metadata, not status indicators. */}
          <Space size="small">
            <Text type="secondary">{jobs.length} total</Text>
            <Text type="secondary">{jobs.filter((j: any) => j.isActive).length} active</Text>
          </Space>

          <Divider type="vertical" className="console-divider-6-reset" />

          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            isNarrow={isNarrow}
            label="Search scheduled jobs"
          />

          {/* Status Filter */}
          <Select
            aria-label="Filter scheduled jobs by status"
            placeholder="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            className="ui-extracted-77a50c14cf"
            size="small"
            allowClear
            options={[
              { label: 'Active', value: 'active' },
              { label: 'Paused', value: 'paused' },
            ]}
          />

          <ListActions
            onReset={() => {
              setSearchQuery('');
              setStatusFilter(undefined);
            }}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] })}
            refreshLabel="Refresh scheduled jobs"
          />
        </div>

        <ModernTable
          columns={columns}
          dataSource={filteredJobs}
          loading={isLoading}
          rowKey="_id"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `${total} scheduled jobs`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
          emptyState={{
            icon: (
              <GatewayIcon name="ClockCircleOutlined" style={{ width: 64, height: 64, color: cssVar.text.muted }} />
            ),
            title: 'No scheduled jobs yet',
            description: 'Create your first scheduled job to start running batch integrations on a schedule',
            action: (
              <Button
                type="primary"
                icon={<GatewayIcon name="PlusOutlined" />}
                onClick={() => navigate('/scheduled-jobs/new')}
              >
                Create Scheduled Job
              </Button>
            ),
          }}
        />
      </Card>
    </PageTemplate>
  );
};
