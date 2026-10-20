import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Space, Switch, Tag, Tooltip, Typography, message } from 'antd';
import {
  AppstoreOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { PageHeader } from '../../components/common/PageHeader';
import {
  createProvider,
  deleteProvider,
  listProviders,
  updateProvider,
  type Provider,
} from '../../services/api';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { useTenant } from '../../app/tenant-context';
import { ModernTable } from '../../components/common/ModernTable';

const { Text, Paragraph } = Typography;

export const ProvidersRoute = () => {
  const { spacing, token } = useDesignTokens();
  const { orgId } = useTenant();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form] = Form.useForm();

  const { data: providers = [], isLoading } = useQuery({
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
          Remove <strong>{provider.name}</strong>? Existing integrations that reference this provider
          will keep their tag, but it will no longer appear as a suggestion.
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

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Provider) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          {record.description && (
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
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
      render: (isActive: boolean) =>
        isActive ? <Tag color="success">Active</Tag> : <Tag color="default">Inactive</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      render: (_: unknown, record: Provider) => (
        <Space>
          <Tooltip title="Edit">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleOpenEdit(record)}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deletingId === record.id}
              onClick={() => handleDelete(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="Providers"
        description="Manage the list of provider names used to tag and filter integrations."
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
            Add Provider
          </Button>
        }
      />

      <ModernTable
        dataSource={providers}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{
          emptyText: (
            <Space direction="vertical" style={{ padding: spacingToNumber(spacing[6]) }}>
              <AppstoreOutlined style={{ fontSize: 32, color: token.colorTextTertiary }} />
              <div>
                <Text strong>No providers yet</Text>
                <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                  Add providers to create a controlled list for tagging integrations.
                </Paragraph>
              </div>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
                Add your first provider
              </Button>
            </Space>
          ),
        }}
      />

      <Modal
        title={editing ? 'Edit Provider' : 'New Provider'}
        open={open}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        okText={editing ? 'Save' : 'Create'}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Provider Name"
            rules={[{ required: true, message: 'Name is required' }]}
          >
            <Input placeholder="e.g. QikChat WhatsApp" size="large" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea
              placeholder="Optional — describe what this provider is used for"
              rows={2}
            />
          </Form.Item>
          {editing && (
            <Form.Item name="isActive" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
};
