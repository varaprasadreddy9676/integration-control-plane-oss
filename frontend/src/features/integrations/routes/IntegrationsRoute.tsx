import { useMemo, useState } from 'react';
import {
  App,
  Dropdown,
  Modal,
  Select,
  Space,
  Card,
  Grid,
  Switch,
  Divider,
  Tooltip,
} from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useNavigateWithParams } from '../../../utils/navigation';
import { buildUrlWithOrgId } from '../../../utils/navigation';
import { useAuth } from '../../../app/auth-context';
import { ListActions, SearchInput } from '../../../components/common/ListControls';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { MetaTag } from '../../../components/common/MetaTag';
import { ModernTable } from '../../../components/common/ModernTable';
import { StatePanel } from '../../../components/common/StatePanel';
import {
  getIntegrations,
  deleteIntegration,
  testIntegration,
  bulkEnableIntegrations,
  bulkDisableIntegrations,
  bulkDeleteIntegrations,
  updateIntegration,
  duplicateIntegration,
  downloadIntegrationExport,
} from '../../../services/api';
import { createExportProgress } from '../../../utils/export-progress';
import { markMorphSource } from '../../../design-system/view-transition';
import { celebrateActivation } from '../../../design-system/delight';
import type { IntegrationConfig, IntegrationScope } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import { useDesignTokens, withAlpha, cssVar } from '../../../design-system/utils';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';
import { prefetchDetailRoute } from '../../../app/route-prefetch';
import { Button } from '../../../components/common/LegacyButton';

interface IntegrationsRouteProps {
  hideHeader?: boolean;
  isActive?: boolean;
}

export const IntegrationsRoute = ({ hideHeader = false, isActive = true }: IntegrationsRouteProps = {}) => {
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { spacing, token } = useDesignTokens();
  const { user } = useAuth();
  const isPortalSession = !!(user as any)?.isPortalSession;
  const colors = cssVar.legacy;
  const {
    data = [],
    refetch,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => getIntegrations(),
    enabled: isActive,
    staleTime: 60_000, // integrations change rarely — don't re-fetch on every mount
  });
  const [eventFilter, setEventFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | undefined>();
  const [scopeFilter, setScopeFilter] = useState<string | undefined>();
  const [providerFilter, setProviderFilter] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  // Pagination with auto-reset on filter changes
  const { getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 20,
    resetDeps: [eventFilter, statusFilter, scopeFilter, providerFilter, searchQuery],
  });

  // Real-time, event-triggered deliveries only. Scheduled/Script Jobs are cron-driven
  // batch work with their own dedicated "Scheduled Jobs" tab on this page — showing them
  // here too duplicates them and renders meaningless Event/Method columns for a job type
  // that has neither.
  const isOutbound = (item: any) => item.direction === 'OUTBOUND';

  const filtered = useMemo(() => {
    return data.filter((item: any) => {
      if (!isOutbound(item)) return false;

      if (eventFilter && item.eventType !== eventFilter) return false;
      if (statusFilter === 'active' && !item.isActive) return false;
      if (statusFilter === 'inactive' && item.isActive) return false;
      if (scopeFilter && item.scope !== scopeFilter) return false;
      if (providerFilter && item.provider !== providerFilter) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(query);
        const matchesUrl = item.targetUrl?.toLowerCase().includes(query);
        const matchesEventType = item.eventType?.toLowerCase().includes(query);
        const matchesProvider = item.provider?.toLowerCase().includes(query);
        if (!matchesName && !matchesUrl && !matchesEventType && !matchesProvider) return false;
      }

      return true;
    });
  }, [data, eventFilter, statusFilter, scopeFilter, providerFilter, searchQuery]);

  const eventOptions = useMemo(() => [...new Set(data.filter(isOutbound).map((item) => item.eventType))], [data]);

  const providerOptions = useMemo(() => {
    const outbound = data.filter(isOutbound);
    return [...new Set(outbound.map((item: any) => item.provider).filter(Boolean))].sort() as string[];
  }, [data]);

  const hasActiveFilters = !!(eventFilter || statusFilter || scopeFilter || providerFilter || searchQuery);
  const outboundData = useMemo(() => data.filter(isOutbound), [data]);

  const onDelete = async (record: IntegrationConfig) => {
    Modal.confirm({
      title: `Delete ${record.name}?`,
      content: 'This cannot be undone. Downstream systems will stop receiving this event.',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteIntegration(record.id);
          msgApi.success('Event rule deleted');
          refetch();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete event rule';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  const onTest = async (id: string) => {
    const hide = msgApi.loading('Sending test event...', 0);
    try {
      await testIntegration(id);
      hide();
      msgApi.success('Test event queued');
    } catch (error) {
      hide();
      const errorMessage = error instanceof Error ? error.message : 'Failed to send test event';
      msgApi.error(errorMessage);
    }
  };

  const onQuickToggle = async (record: IntegrationConfig, checked: boolean, origin?: Element | null) => {
    if (!checked) {
      modal.confirm({
        title: `Disable "${record.name}"?`,
        content: 'This integration will stop processing events immediately. You can re-enable it anytime.',
        okText: 'Yes, Disable',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await updateIntegration(record.id, { ...record, isActive: false });
            msgApi.success('Event rule disabled');
            refetch();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to update event rule';
            msgApi.error(errorMessage);
          }
        },
      });
      return;
    }

    try {
      await updateIntegration(record.id, { ...record, isActive: checked });
      celebrateActivation(origin ?? undefined);
      msgApi.success('Event rule enabled');
      refetch();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update event rule';
      msgApi.error(errorMessage);
    }
  };

  const onDuplicate = async (record: IntegrationConfig) => {
    try {
      const sameEventTypeIntegrations = data.filter((w) => w.eventType === record.eventType && w.id !== record.id);

      const proceedWithDuplicate = async () => {
        try {
          const newIntegration = await duplicateIntegration(record.id);
          msgApi.success('Event rule duplicated successfully');
          queryClient.invalidateQueries({ queryKey: ['integrations'] });
          navigate(`/integrations/${newIntegration.id}`);
        } catch (error) {
          msgApi.error('Failed to duplicate event rule');
          console.error('Duplicate error:', error);
        }
      };

      if (sameEventTypeIntegrations.length > 0) {
        modal.confirm({
          title: 'Duplicate event rule for same event type?',
          content: `You already have ${sameEventTypeIntegrations.length} integration(s) configured for "${record.eventType}". Are you sure you want to create another one for the same event type?`,
          okText: 'Yes, Duplicate',
          onOk: proceedWithDuplicate,
        });
      } else {
        await proceedWithDuplicate();
      }
    } catch (error) {
      msgApi.error('An error occurred while duplicating');
      console.error('Duplicate check error:', error);
    }
  };

  const handleBulkEnable = async () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select event rules to enable');
      return;
    }

    try {
      const result = await bulkEnableIntegrations(selectedRowKeys as string[]);
      if (result.updatedCount > 0) celebrateActivation();
      msgApi.success(result.message || `Enabled ${result.updatedCount} event rule(s)`);

      if (result.failedIds && result.failedIds.length > 0) {
        msgApi.warning(`Failed to enable ${result.failedIds.length} event rule(s)`);
      }

      setSelectedRowKeys([]);
      refetch();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to enable event rules';
      msgApi.error(errorMessage);
    }
  };

  const handleBulkDisable = async () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select event rules to disable');
      return;
    }

    modal.confirm({
      title: `Disable ${selectedRowKeys.length} event rule(s)?`,
      content: 'Selected event rules will stop processing events immediately. This may affect production systems.',
      okText: 'Yes, Disable All',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await bulkDisableIntegrations(selectedRowKeys as string[]);
          msgApi.success(result.message || `Disabled ${result.updatedCount} event rule(s)`);

          if (result.failedIds && result.failedIds.length > 0) {
            msgApi.warning(`Failed to disable ${result.failedIds.length} event rule(s)`);
          }

          setSelectedRowKeys([]);
          refetch();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to disable event rules';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  const handleBulkDelete = async () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select event rules to delete');
      return;
    }

    modal.confirm({
      title: `Delete ${selectedRowKeys.length} event rule(s)?`,
      content: 'This action cannot be undone. Downstream systems will stop receiving these events.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await bulkDeleteIntegrations(selectedRowKeys as string[]);
          msgApi.success(result.message || `Deleted ${result.deletedCount} event rule(s)`);

          if (result.failedIds && result.failedIds.length > 0) {
            msgApi.warning(`Failed to delete ${result.failedIds.length} event rule(s)`);
          }

          setSelectedRowKeys([]);
          refetch();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete event rules';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  const handleExport = async (exportType: 'all' | 'selected' | 'filtered') => {
    if (exportLoading) return;
    try {
      let integrationIds: string[] | undefined;
      let exportCount = 0;

      switch (exportType) {
        case 'all':
          exportCount = data.length;
          break;
        case 'selected':
          if (selectedRowKeys.length === 0) {
            msgApi.warning('Please select event rules to export');
            return;
          }
          integrationIds = selectedRowKeys.map(String);
          exportCount = integrationIds.length;
          break;
        case 'filtered':
          integrationIds = filtered.map((integration) => integration.id);
          exportCount = integrationIds.length;
          break;
      }

      if (exportCount === 0) {
        msgApi.warning('No event rules to export');
        return;
      }

      setExportLoading(true);
      const { onProgress, finish } = createExportProgress(msgApi, 'Export JSON');
      await downloadIntegrationExport({ format: 'json', includeInactive: true, integrationIds }, { onProgress });
      finish(`Exported ${exportCount} event rule(s)`);
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'Failed to export event rules');
    } finally {
      setExportLoading(false);
    }
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
    getCheckboxProps: (record: IntegrationConfig) => ({
      disabled: record.isInherited,
      name: record.name,
    }),
  };

  return (
    <div>
      {/* Bulk Action Bar */}
      {selectedRowKeys.length > 0 && (
        <div
          style={{
            borderBottom: `1px solid ${colors.primary[300]}`,
            background: withAlpha(colors.primary[50], 0.6),
            padding: `${spacing[2]} ${spacing[3]}`,
            marginBottom: spacing[2],
          }}
        >
          <div className="console-flex-between-center">
            <Space size="small">
              <Text color="accent" weight="semibold">
                {selectedRowKeys.length} selected
              </Text>
            </Space>
            <Space size="small">
              {!isPortalSession && (
                <Button size="small" icon={<GatewayIcon name="CheckOutlined" />} onClick={handleBulkEnable}>
                  Enable
                </Button>
              )}
              {!isPortalSession && (
                <Button size="small" icon={<GatewayIcon name="StopOutlined" />} onClick={handleBulkDisable}>
                  Disable
                </Button>
              )}
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'selected',
                      label: 'Export selected',
                      icon: <GatewayIcon name="DownloadOutlined" />,
                      onClick: () => handleExport('selected'),
                    },
                    {
                      key: 'filtered',
                      label: 'Export filtered results',
                      icon: <GatewayIcon name="DownloadOutlined" />,
                      onClick: () => handleExport('filtered'),
                    },
                    {
                      key: 'all',
                      label: 'Export all',
                      icon: <GatewayIcon name="DownloadOutlined" />,
                      onClick: () => handleExport('all'),
                    },
                  ],
                }}
              >
                <Button size="small" icon={<GatewayIcon name="DownloadOutlined" />} loading={exportLoading}>
                  Export
                </Button>
              </Dropdown>
              {!isPortalSession && (
                <Button size="small" danger icon={<GatewayIcon name="DeleteOutlined" />} onClick={handleBulkDelete}>
                  Delete
                </Button>
              )}
            </Space>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing[2],
          padding: `${spacing[2]} ${spacing[3]}`,
          borderBottom: `1px solid ${token.colorBorder}`,
          background: cssVar.bg.surface,
          alignItems: 'center',
          marginBottom: spacing[2],
        }}
      >
        {/* Count Tags */}
        <Space size="small">
          <MetaTag variant="neutral" size="small">
            {`${outboundData.length} total`}
          </MetaTag>
          <Tooltip title="Rules inherited from a parent org unit, rather than created directly here">
            <MetaTag variant="method" size="small">
              {outboundData.filter((w: any) => w.isInherited).length} inherited
            </MetaTag>
          </Tooltip>
        </Space>

        <Divider type="vertical" className="console-divider-6-reset" />

        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          isNarrow={isNarrow}
          label="Search outbound integrations"
        />

        {/* Filters */}
        <Select
          placeholder="Event"
          allowClear
          style={{ width: isNarrow ? '100%' : 140 }}
          size="small"
          value={eventFilter}
          onChange={(value) => setEventFilter(value)}
          options={eventOptions.map((event) => ({ value: event, label: event }))}
        />
        <Select
          placeholder="Status"
          allowClear
          style={{ width: isNarrow ? '100%' : 110 }}
          size="small"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as 'active' | 'inactive' | undefined)}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
        <Select
          placeholder="Scope"
          allowClear
          style={{ width: isNarrow ? '100%' : 140 }}
          size="small"
          value={scopeFilter}
          onChange={(value) => setScopeFilter(value)}
          options={[
            { value: 'ENTITY_ONLY', label: 'Entity only' },
            { value: 'INCLUDE_CHILDREN', label: 'Include children' },
          ]}
        />
        <Select
          placeholder="Provider"
          allowClear
          style={{ width: isNarrow ? '100%' : 150 }}
          size="small"
          value={providerFilter}
          onChange={(value) => setProviderFilter(value)}
          options={providerOptions.map((p) => ({ value: p, label: p }))}
        />

        <ListActions
          onReset={() => {
            setEventFilter(undefined);
            setStatusFilter(undefined);
            setScopeFilter(undefined);
            setProviderFilter(undefined);
            setSearchQuery('');
          }}
          onRefresh={() => refetch()}
          refreshLabel="Refresh outbound integrations"
        >
          <Button icon={<GatewayIcon name="AppstoreOutlined" />} size="small" onClick={() => navigate('/templates')}>
            Templates
          </Button>
        </ListActions>
      </div>

      {/* Error state */}
      {error && !isLoading && (
        <div style={{ padding: `${spacing[8]} ${spacing[4]}` }}>
          <StatePanel
            glyph="disrupted"
            tone="critical"
            size="compact"
            title="Failed to load event rules"
            description="Check your connection and try again."
            footnote={error instanceof Error ? error.message : 'An unexpected error occurred.'}
            actions={
              <Button size="small" icon={<GatewayIcon name="ReloadOutlined" />} onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      )}

      {/* Empty states */}
      {!isLoading && !error && outboundData.length === 0 && (
        <StatePanel
          size="regular"
          glyph="searching"
          title="No event rules yet"
          description="Create a rule or start from a template."
          actions={
            !isPortalSession ? (
              <Space>
                <Button
                  type="primary"
                  icon={<GatewayIcon name="PlusOutlined" />}
                  onClick={() => navigate('/integrations/new')}
                >
                  Create Event Rule
                </Button>
                <Button icon={<GatewayIcon name="AppstoreOutlined" />} onClick={() => navigate('/templates')}>
                  Browse Templates
                </Button>
              </Space>
            ) : undefined
          }
        />
      )}

      {!isLoading && outboundData.length > 0 && filtered.length === 0 && hasActiveFilters && (
        <StatePanel
          size="compact"
          glyph="searching"
          title="No matching event rules"
          description="Clear filters to see all rules."
          actions={
            <Button
              icon={<GatewayIcon name="FilterOutlined" />}
              onClick={() => {
                setEventFilter(undefined);
                setStatusFilter(undefined);
                setScopeFilter(undefined);
                setProviderFilter(undefined);
                setSearchQuery('');
              }}
            >
              Clear all filters
            </Button>
          }
        />
      )}

      {/* Table */}
      {(isLoading || filtered.length > 0) && (
        <div
          style={{
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 8,
            background: cssVar.bg.surface,
          }}
        >
          <ModernTable<IntegrationConfig>
            loading={isLoading}
            dataSource={filtered}
            rowKey="id"
            size="middle"
            enableResize={true}
            stickyHeader={true}
            rowSelection={rowSelection}
            pagination={{
              ...getPaginationConfig(filtered.length),
              showTotal: (total) => `${total} event ${total === 1 ? 'rule' : 'rules'}`,
            }}
            columns={[
              {
                title: 'Event Rule',
                dataIndex: 'name',
                key: 'name',
                width: 260,
                ellipsis: true,
                sorter: (a, b) => a.name.localeCompare(b.name),
                render: (_: unknown, record) => (
                  <Space direction="vertical" size={2}>
                    <div className="console-flex-center-gap-2">
                      <Link
                        to={buildUrlWithOrgId(`/integrations/${record.id}`)}
                        state={{ title: record.name }}
                        style={{ color: token.colorLink, textDecoration: 'none' }}
                        onClick={(event) => {
                          markMorphSource(event.currentTarget);
                        }}
                        onMouseEnter={() => prefetchDetailRoute('integration')}
                        onFocus={() => prefetchDetailRoute('integration')}
                      >
                        <Text as="span" color="accent" weight="semibold" maxLines={1}>
                          {record.name}
                        </Text>
                      </Link>
                      {record.isInherited && <StatusBadge status="INHERITED" size="small" />}
                    </div>
                    <Space size={6}>
                      <MetaTag variant="event" size="small">
                        {record.eventType}
                      </MetaTag>
                      <MetaTag variant="method" size="small">
                        {(record.httpMethod || 'POST').toUpperCase()}
                      </MetaTag>
                    </Space>
                  </Space>
                ),
              },
              {
                title: 'Scope',
                dataIndex: 'scope',
                key: 'scope',
                width: 145,
                sorter: (a, b) => a.scope.localeCompare(b.scope),
                filters: [
                  { text: 'Include children', value: 'INCLUDE_CHILDREN' },
                  { text: 'Entity only', value: 'ENTITY_ONLY' },
                ],
                onFilter: (value, record) => record.scope === value,
                render: (scope: IntegrationScope, record) => (
                  <Space direction="vertical" size={4}>
                    <MetaTag variant="neutral" size="default">
                      {scope === 'INCLUDE_CHILDREN' ? 'Include children' : 'Entity only'}
                    </MetaTag>
                    {record.excludedOrgUnits && record.excludedOrgUnits.length > 0 && (
                      <Text type="supporting" color="secondary">
                        {record.excludedOrgUnits.length} excluded
                      </Text>
                    )}
                  </Space>
                ),
              },
              {
                title: 'Endpoint',
                dataIndex: 'targetUrl',
                key: 'targetUrl',
                width: 245,
                ellipsis: true,
                render: (url: string) => (
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {url}
                  </Text>
                ),
              },
              {
                title: 'Status',
                dataIndex: 'isActive',
                key: 'isActive',
                width: 90,
                align: 'center',
                filters: [
                  { text: 'Active', value: true },
                  { text: 'Inactive', value: false },
                ],
                onFilter: (value, record) => record.isActive === value,
                sorter: (a, b) => Number(a.isActive) - Number(b.isActive),
                render: (_: unknown, record) => (
                  <Switch
                    checked={record.isActive}
                    onChange={(checked, event) => onQuickToggle(record, checked, event.currentTarget as Element)}
                    size="small"
                    disabled={record.isInherited || isPortalSession}
                  />
                ),
              },
              {
                title: 'Last Updated',
                dataIndex: 'updatedAt',
                key: 'updatedAt',
                width: 145,
                sorter: (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
                defaultSortOrder: 'descend',
                render: (date: string) => (
                  <Text type="supporting" color="secondary">
                    {formatDateTime(date)}
                  </Text>
                ),
              },
              {
                title: '',
                key: 'actions',
                width: 48,
                align: 'center',
                render: (_: unknown, record) => (
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        ...(!isPortalSession
                          ? [
                              {
                                key: 'edit',
                                label: 'Edit',
                                icon: <GatewayIcon name="EditOutlined" />,
                                onClick: () => navigate(`/integrations/${record.id}`),
                              },
                              {
                                key: 'duplicate',
                                label: 'Duplicate',
                                icon: <GatewayIcon name="CopyOutlined" />,
                                onClick: () => onDuplicate(record),
                                disabled: record.isInherited,
                              },
                            ]
                          : []),
                        {
                          key: 'test',
                          label: 'Send test event',
                          icon: <GatewayIcon name="ThunderboltOutlined" />,
                          onClick: () => onTest(record.id),
                          disabled: !record.isActive,
                        },
                        ...(!isPortalSession
                          ? [
                              {
                                type: 'divider' as const,
                              },
                              {
                                key: 'delete',
                                label: 'Delete',
                                danger: true,
                                icon: <GatewayIcon name="DeleteOutlined" />,
                                onClick: () => onDelete(record),
                                disabled: record.isInherited,
                              },
                            ]
                          : []),
                      ],
                    }}
                  >
                    <Button
                      type="text"
                      size="small"
                      aria-label={`Open actions for ${record.name}`}
                      icon={<GatewayIcon name="MoreOutlined" />}
                    />
                  </Dropdown>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
};
