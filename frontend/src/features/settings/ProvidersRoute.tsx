import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Form, Input, Modal, Select, Space, Switch, Tooltip, message } from "@/components/common/LegacyAntdControls";
import { Banner } from '@astryxdesign/core/Banner';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { PageTemplate } from '../../components/common/PageTemplate';
import { FilterBar } from '../../components/common/FilterBar';
import { StatusBadge } from '../../components/common/StatusBadge';
import { createProvider, deleteProvider, listProviders, updateProvider, type Provider } from '../../services/api';
import { useDesignTokens } from '../../design-system/utils';
import { useTenant } from '../../app/tenant-context';
import { ModernTable } from '../../components/common/ModernTable';
import { StatePanel } from '../../components/common/StatePanel';
import { Button } from '../../components/common/LegacyButton';

export const ProvidersRoute = () => {
  const { token } = useDesignTokens();
  const { orgId } = useTenant();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [form] = Form.useForm();

  const {
    data: providers = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['providers', orgId],
    queryFn: () => listProviders(),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['providers'] });
  };

  const handleOpenCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: '', description: '', isActive: true });
    setOpen(true);
  };

  const handleOpenEdit = (provider: Provider) => {
    setEditing(provider);
    form.setFieldsValue({
      name: provider.name,
      description: provider.description,
      isActive: provider.isActive,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    let values: { name: string; description?: string; isActive?: boolean };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateProvider(editing.id, values);
        messageApi.success('Provider updated');
      } else {
        await createProvider(values);
        messageApi.success('Provider created');
      }
      invalidate();
      setOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save provider';
      messageApi.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (provider: Provider) => {
    Modal.confirm({
      title: 'Delete provider?',
      content: (
        <span>
          Remove <strong>{provider.name}</strong>? Existing integrations that reference this provider will keep their
          tag, but it will no longer appear as a suggestion.
        </span>
      ),
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        setDeletingId(provider.id);
        try {
          await deleteProvider(provider.id);
          messageApi.success('Provider deleted');
          invalidate();
        } catch {
          messageApi.error('Failed to delete provider');
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const filteredProviders = providers.filter((provider) => {
    const search = searchText.trim().toLowerCase();
    const matchesSearch =
      !search ||
      provider.name.toLowerCase().includes(search) ||
      (provider.description || '').toLowerCase().includes(search);
    const matchesStatus =
      statusFilter === 'all' || (statusFilter === 'active' ? provider.isActive : !provider.isActive);
    return matchesSearch && matchesStatus;
  });

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Provider) => (
        <Space direction="vertical" size={0}>
          <Text weight="semibold">{name}</Text>
          {record.description && (
            <Text color="secondary" className="console-type-caption">
              {record.description}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (isActive: boolean) => (
        <StatusBadge
          label={isActive ? 'Active' : 'Inactive'}
          variant={isActive ? 'success' : 'neutral'}
          showIcon={false}
          size="small"
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Provider) => (
        <Space>
          <Tooltip title="Edit">
            <Button size="small" icon={<GatewayIcon name="EditOutlined" />} onClick={() => handleOpenEdit(record)} />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              size="small"
              danger
              icon={<GatewayIcon name="DeleteOutlined" />}
              loading={deletingId === record.id}
              onClick={() => handleDelete(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <PageTemplate
      as="main"
      className="provider-workspace"
      title="Providers"
      description="Manage the list of provider names used to tag and filter integrations."
      actions={
        <Space>
          <Button icon={<GatewayIcon name="ReloadOutlined" />} onClick={() => refetch()} loading={isLoading}>
            Refresh
          </Button>
          <Button type="primary" icon={<GatewayIcon name="PlusOutlined" />} onClick={handleOpenCreate}>
            Add Provider
          </Button>
        </Space>
      }
    >
      {contextHolder}

      <FilterBar
        rightSlot={
          searchText || statusFilter !== 'all' ? (
            <Button
              size="small"
              onClick={() => {
                setSearchText('');
                setStatusFilter('all');
              }}
            >
              Clear filters
            </Button>
          ) : null
        }
      >
        <div className="provider-filter-grid">
          <label className="provider-filter-field">
            <span>Search providers</span>
            <Input
              aria-label="Search providers"
              placeholder="Provider name or description"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              allowClear
            />
          </label>
          <label className="provider-filter-field">
            <span>Status</span>
            <Select aria-label="Filter providers by status" value={statusFilter} onChange={setStatusFilter}>
              <Select.Option value="all">All statuses</Select.Option>
              <Select.Option value="active">Active</Select.Option>
              <Select.Option value="inactive">Inactive</Select.Option>
            </Select>
          </label>
        </div>
      </FilterBar>

      {error && (
        <Banner
          status="error"
          title="Could not load providers"
          description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
          endContent={
            <Button size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      )}

      <section className="provider-table-section" aria-label="Provider directory">
        <div className="provider-table-heading">
          <Text weight="semibold">Provider directory</Text>
          <Text color="secondary">
            Showing {filteredProviders.length} of {providers.length}
          </Text>
        </div>

        {!isLoading && filteredProviders.length === 0 ? (
          <StatePanel
            glyph="searching"
            size="regular"
            title={providers.length ? 'No providers match these filters' : 'No providers yet'}
            description={
              providers.length
                ? 'Change or clear a filter to see the full directory.'
                : 'Add providers to create a controlled list for tagging integrations.'
            }
            actions={
              providers.length ? (
                <Button
                  onClick={() => {
                    setSearchText('');
                    setStatusFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button type="primary" icon={<GatewayIcon name="PlusOutlined" />} onClick={handleOpenCreate}>
                  Add your first provider
                </Button>
              )
            }
          />
        ) : (
          <ModernTable
            dataSource={filteredProviders}
            columns={columns}
            rowKey="id"
            loading={isLoading}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
          />
        )}
      </section>

      <Modal
        title={editing ? 'Edit Provider' : 'New Provider'}
        open={open}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        okText={editing ? 'Save' : 'Create'}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" className="console-margin-top-4">
          <Form.Item name="name" label="Provider Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="e.g. QikChat WhatsApp" size="large" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea placeholder="Optional — describe what this provider is used for" rows={2} />
          </Form.Item>
          {editing && (
            <Form.Item name="isActive" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </PageTemplate>
  );
};
