/**
 * Flow Builder List Route
 *
 * Standalone list view for managing integrations via Flow Builder
 */

import React, { useState, useMemo } from 'react';
import { App, Space, Dropdown, Tooltip, Segmented } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { StatusBadge } from '../../../components/common/StatusBadge';
import type { MenuProps, TableColumnsType } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from "../../../components/common/Icon";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { deleteInboundIntegration, deleteIntegration, getAllIntegrations } from '../../../services/api';
import type { IntegrationMode } from '../state/flowTypes';
import { ModernTable } from '../../../components/common/ModernTable';
import { useNavigateWithParams } from '../../../utils/navigation';
import { useTenant } from '../../../app/tenant-context';
import { FilterBar } from '../../../components/common/FilterBar';
import { SearchInput } from '../../../components/common/ListControls';
import { StatePanel } from '../../../components/common/StatePanel';
import { Button } from '../../../components/common/LegacyButton';


interface IntegrationListItem {
  id: string;
  name: string;
  direction: 'INBOUND' | 'OUTBOUND';
  mode: IntegrationMode;
  isActive: boolean;
  orgId: number;
  targetUrl?: string;
  eventType?: string;
  deliveryMode?: 'IMMEDIATE' | 'SCHEDULED';
  updatedAt?: string;
}

export const FlowBuilderListRoute: React.FC = () => {
  const navigate = useNavigateWithParams();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { orgId } = useTenant();
  const [searchText, setSearchText] = useState('');
  const [selectedMode, setSelectedMode] = useState<'all' | IntegrationMode>('all');

  // Fetch all integrations
  const { data: integrations = [], isLoading } = useQuery({
    queryKey: ['integrations', 'flow-builder', orgId],
    enabled: orgId > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await getAllIntegrations(orgId);

      // Map to our interface
      return result.map((integration: any): IntegrationListItem => {
        const direction = integration.direction || 'OUTBOUND';
        const deliveryMode = integration.deliveryMode || 'IMMEDIATE';

        let mode: IntegrationMode;
        if (direction === 'INBOUND') {
          mode = 'INBOUND';
        } else if (deliveryMode === 'SCHEDULED') {
          mode = 'OUTBOUND_SCHEDULED';
        } else {
          mode = 'OUTBOUND_EVENT';
        }

        return {
          id: integration.id,
          name: integration.name,
          direction,
          mode,
          isActive: integration.isActive ?? true,
          orgId: integration.orgId || orgId,
          targetUrl: integration.targetUrl,
          eventType: integration.eventType,
          deliveryMode: integration.deliveryMode,
          updatedAt: integration.updatedAt,
        };
      });
    },
  });

  // Filter integrations
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((integration) => {
      const matchesSearch =
        searchText === '' ||
        integration.name.toLowerCase().includes(searchText.toLowerCase()) ||
        integration.targetUrl?.toLowerCase().includes(searchText.toLowerCase()) ||
        integration.eventType?.toLowerCase().includes(searchText.toLowerCase());

      const matchesMode = selectedMode === 'all' || integration.mode === selectedMode;

      return matchesSearch && matchesMode;
    });
  }, [integrations, searchText, selectedMode]);

  // Handle create new
  const handleCreateNew = (mode: IntegrationMode) => {
    navigate(`/flow-builder/new?mode=${mode}`);
  };

  // Handle edit
  const handleEdit = (integration: IntegrationListItem) => {
    navigate(`/flow-builder/${integration.id}?mode=${integration.mode}&orgId=${integration.orgId}`);
  };

  const deleteMutation = useMutation({
    mutationFn: async (integration: IntegrationListItem) => {
      if (integration.direction === 'INBOUND') {
        await deleteInboundIntegration(integration.id);
      } else {
        await deleteIntegration(integration.id);
      }
    },
    onSuccess: async (_result, integration) => {
      await queryClient.invalidateQueries({ queryKey: ['integrations'] });
      message.success(`Deleted ${integration.name}`);
    },
    onError: (error: Error) => {
      message.error(error.message || 'Failed to delete integration');
    },
  });

  const handleDelete = (integration: IntegrationListItem) => {
    modal.confirm({
      title: `Delete ${integration.name}?`,
      content: 'This permanently removes the integration and stops future deliveries. Delivery history is retained.',
      okText: 'Delete integration',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => deleteMutation.mutateAsync(integration),
    });
  };

  // Get mode icon
  const getModeIcon = (mode: IntegrationMode) => {
    switch (mode) {
      case 'INBOUND':
        return <GatewayIcon name="ApiOutlined" />;
      case 'OUTBOUND_EVENT':
        return <GatewayIcon name="ThunderboltOutlined" />;
      case 'OUTBOUND_SCHEDULED':
        return <GatewayIcon name="ClockCircleOutlined" />;
      default:
        return <GatewayIcon name="BlockOutlined" />;
    }
  };

  // Table columns
  const columns: TableColumnsType<IntegrationListItem> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: '25%',
      render: (name: string, record: IntegrationListItem) => (
        <Space direction="vertical" size={0}>
          <Text weight="semibold">{name}</Text>
          {record.eventType && (
            <Text type="supporting" color="secondary" size="sm">
              Event: {record.eventType}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      width: '20%',
      render: (mode: IntegrationMode) => (
        <Space size={6}>
          {getModeIcon(mode)}
          <Text type="supporting" color="secondary">{mode.replace('_', ' ')}</Text>
        </Space>
      ),
      filters: [
        { text: 'Inbound', value: 'INBOUND' },
        { text: 'Outbound Event', value: 'OUTBOUND_EVENT' },
        { text: 'Outbound Scheduled', value: 'OUTBOUND_SCHEDULED' },
      ],
      onFilter: (value, record) => record.mode === value,
    },
    {
      title: 'Target URL',
      dataIndex: 'targetUrl',
      key: 'targetUrl',
      width: '30%',
      render: (url?: string) =>
        url ? (
          <Tooltip title={url}>
            <Text
              maxLines={1}
              hasTruncateTooltip="above"
              className="ui-extracted-f4d279753b"
            >
              {url}
            </Text>
          </Tooltip>
        ) : (
          <Text type="supporting" color="secondary">-</Text>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: '10%',
      render: (isActive: boolean) => (
        <StatusBadge label={isActive ? 'Active' : 'Inactive'} variant={isActive ? 'success' : 'neutral'} showIcon={false} />
      ),
      filters: [
        { text: 'Active', value: true },
        { text: 'Inactive', value: false },
      ],
      onFilter: (value, record) => record.isActive === value,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: '15%',
      align: 'right',
      render: (_: any, record: IntegrationListItem) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'edit',
            label: 'Edit in Flow Builder',
            icon: <GatewayIcon name="EditOutlined" />,
            onClick: () => handleEdit(record),
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: 'Delete',
            icon: <GatewayIcon name="DeleteOutlined" />,
            danger: true,
            disabled: deleteMutation.isPending,
            onClick: () => handleDelete(record),
          },
        ];

        return (
          <Space size="small">
            <Button type="primary" size="small" icon={<GatewayIcon name="EditOutlined" />} onClick={() => handleEdit(record)}>
              Edit Flow
            </Button>
            <Dropdown menu={{ items: menuItems }} trigger={['click']}>
              <Button size="small" icon={<GatewayIcon name="EllipsisOutlined" />} />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  // Create dropdown menu items
  const createMenuItems: MenuProps['items'] = [
    {
      key: 'inbound',
      label: 'Inbound Integration',
      icon: <GatewayIcon name="ApiOutlined" />,
      onClick: () => handleCreateNew('INBOUND'),
    },
    {
      key: 'outbound-event',
      label: 'Outbound Event Integration',
      icon: <GatewayIcon name="ThunderboltOutlined" />,
      onClick: () => handleCreateNew('OUTBOUND_EVENT'),
    },
    {
      key: 'outbound-scheduled',
      label: 'Outbound Scheduled Integration',
      icon: <GatewayIcon name="ClockCircleOutlined" />,
      onClick: () => handleCreateNew('OUTBOUND_SCHEDULED'),
    },
  ];

  return (
    <PageTemplate
      as="main"
      className="flow-builder-list-workspace"
      contentClassName="flow-builder-list-workspace__content"
      header={<PageHeader
        title="Flow Builder"
        description="Visual integration designer - Create and manage integrations using a drag-and-drop flow builder"
        breadcrumb={[{ label: 'Configuration' }, { label: 'Flow Builder' }]}
        actions={
          <Dropdown menu={{ items: createMenuItems }} placement="bottomRight">
            <Button type="primary" size="large" icon={<GatewayIcon name="PlusOutlined" />}>
              Create New Integration
            </Button>
          </Dropdown>
        }
      />}
    >

      <section className="flow-builder-capability-note" aria-label="About the flow builder">
        <Text type="supporting" as="p">
          Inbound, event-driven and scheduled integrations are designed in the same visual workflow.
        </Text>
      </section>

      {/* Filters */}
      <FilterBar>
        <SearchInput
          value={searchText}
          onChange={setSearchText}
          label="Search integrations"
          placeholder="Search name, event type, or target URL"
          width={360}
        />
        <Segmented
          aria-label="Filter integrations by mode"
          value={selectedMode}
          onChange={(value) => setSelectedMode(value as 'all' | IntegrationMode)}
          options={[
            { label: 'All', value: 'all' },
            { label: <><GatewayIcon name="ApiOutlined" /> Inbound</>, value: 'INBOUND' },
            { label: <><GatewayIcon name="ThunderboltOutlined" /> Event</>, value: 'OUTBOUND_EVENT' },
            { label: <><GatewayIcon name="ClockCircleOutlined" /> Scheduled</>, value: 'OUTBOUND_SCHEDULED' },
          ]}
        />
      </FilterBar>

      {/* Table */}
      <section className="flow-builder-table-surface" aria-label="Integrations">
        <ModernTable
          columns={columns}
          dataSource={filteredIntegrations}
          rowKey="id"
          loading={isLoading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `Total ${total} integrations`,
          }}
          locale={{
            emptyText: (
              <StatePanel
                size="compact"
                glyph="searching"
                title={searchText || selectedMode !== 'all' ? 'No matching integrations' : 'No integrations yet'}
                description={searchText || selectedMode !== 'all' ? 'Adjust filters to see integrations.' : undefined}
                actions={
                  !searchText && selectedMode === 'all' ? (
                    <Dropdown menu={{ items: createMenuItems }} placement="bottomRight">
                      <Button type="primary" icon={<GatewayIcon name="PlusOutlined" />}>
                        Create integration
                      </Button>
                    </Dropdown>
                  ) : undefined
                }
              />
            ),
          }}
        />
      </section>
    </PageTemplate>
  );
};

export default FlowBuilderListRoute;
