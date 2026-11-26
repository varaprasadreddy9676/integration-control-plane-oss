import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Form, Input, InputNumber, Modal, Select, Space, Switch, message } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from "../../components/common/Icon";
import { PageHeader } from '../../components/common/PageHeader';
import { PageTemplate } from '../../components/common/PageTemplate';
import { InlineHint } from '../../components/common/InlineHint';
import {
  createSenderProfile,
  deleteSenderProfile,
  listSenderProfiles,
  updateSenderProfile,
  type SenderProfile,
} from '../../services/api';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { useTenant } from '../../app/tenant-context';
import { ModernTable } from '../../components/common/ModernTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Button } from '../../components/common/LegacyButton';

const splitLines = (value?: string) =>
  String(value || '')
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const SenderProfilesRoute = () => {
  const { spacing } = useDesignTokens();
  const { orgId } = useTenant();
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SenderProfile | null>(null);
  const [form] = Form.useForm();
  const provider = Form.useWatch('provider', form);

  const {
    data: profiles = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['senderProfiles', orgId],
    queryFn: listSenderProfiles,
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const handleOpenCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      key: '',
      name: '',
      fromEmail: '',
      aliasesText: '',
      provider: 'SMTP',
      isDefault: profiles.length === 0,
      isActive: true,
      providerConfig: {
        host: '',
        port: 587,
        username: '',
        password: '',
        secure: false,
      },
    });
    setOpen(true);
  };

  const handleEdit = (profile: SenderProfile) => {
    setEditing(profile);
    form.setFieldsValue({
      key: profile.key,
      name: profile.name,
      fromEmail: profile.fromEmail,
      aliasesText: (profile.aliases || []).join('\n'),
      provider: profile.provider,
      isDefault: profile.isDefault,
      isActive: profile.isActive,
      providerConfig: {
        host: profile.providerConfig?.host || '',
        port: profile.providerConfig?.port || 587,
        username: profile.providerConfig?.username || '',
        password: profile.providerConfig?.password || '',
        secure: profile.providerConfig?.secure === true,
      },
    });
    setOpen(true);
  };

  const columns = useMemo(
    () => [
      {
        title: 'Sender',
        key: 'sender',
        render: (_: unknown, record: SenderProfile) => (
          <Space direction="vertical" size={2}>
            <Text weight="semibold">{record.name}</Text>
            <Text color="secondary">{record.fromEmail}</Text>
            {!!record.aliases?.length && (
              <Text color="secondary" as="span">{record.aliases.join(' · ')}</Text>
            )}
          </Space>
        ),
      },
      {
        title: 'Provider',
        key: 'provider',
        render: (_: unknown, record: SenderProfile) => (
          <Space size={6} wrap>
            <StatusBadge label={record.provider} variant="info" size="small" showIcon={false} />
            {record.isDefault && <StatusBadge label="Default" variant="success" size="small" showIcon={false} />}
            {!record.isActive && <StatusBadge label="Inactive" variant="neutral" size="small" showIcon={false} />}
          </Space>
        ),
      },
      {
        title: 'Actions',
        key: 'actions',
        render: (_: unknown, record: SenderProfile) => (
          <Space size="small">
            <Button size="small" onClick={() => handleEdit(record)}>
              Edit
            </Button>
            <Button
              size="small"
              danger
              onClick={() => {
                Modal.confirm({
                  title: 'Delete sender profile?',
                  content: `This will remove ${record.fromEmail}. Existing generic email routing may fail if it depends on this profile.`,
                  okText: 'Delete',
                  okButtonProps: { danger: true },
                  cancelText: 'Cancel',
                  async onOk() {
                    try {
                      await deleteSenderProfile(record.id);
                      await queryClient.invalidateQueries({ queryKey: ['senderProfiles', orgId] });
                      messageApi.success('Sender profile deleted');
                      refetch();
                    } catch (error: any) {
                      messageApi.error(error?.message || 'Failed to delete sender profile');
                    }
                  },
                });
              }}
            >
              Delete
            </Button>
          </Space>
        ),
      },
    ],
    [messageApi, orgId, queryClient, refetch]
  );

  return (
    <PageTemplate
      as="main"
      className="sender-profile-workspace"
      contentClassName="sender-profile-workspace__content"
      header={<PageHeader
        title="Sender Profiles"
        description="Manage reusable email sender credentials per organization. Generic inbound email routing resolves one of these profiles at runtime."
      />}
    >
      {contextHolder}

      <section className="sender-profile-surface" aria-label="Sender profiles">
        <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
          <InlineHint icon={<GatewayIcon name="MailOutlined" />}>
            Use one generic email integration, many sender profiles — create reusable mailbox profiles once, then let
            the generic inbound email integration resolve the correct sender from the request's from field. If the
            request omits from, the configured default profile can be used safely.
          </InlineHint>

          <Space wrap>
            <Button type="primary" icon={<GatewayIcon name="PlusOutlined" />} onClick={handleOpenCreate}>
              Add Sender Profile
            </Button>
            <Button icon={<GatewayIcon name="ReloadOutlined" />} onClick={() => refetch()}>
              Refresh
            </Button>
          </Space>

          <ModernTable rowKey="id" columns={columns} dataSource={profiles} loading={isLoading} pagination={false} />
        </Space>
      </section>

      <Modal
        open={open}
        title={editing ? `Edit Sender Profile · ${editing.fromEmail}` : 'Add Sender Profile'}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          try {
            const values = await form.validateFields();
            const payload = {
              key: values.key,
              name: values.name,
              fromEmail: values.fromEmail,
              aliases: splitLines(values.aliasesText),
              provider: values.provider,
              providerConfig: values.providerConfig,
              isDefault: values.isDefault,
              isActive: values.isActive,
            };
            if (editing) {
              await updateSenderProfile(editing.id, payload);
              messageApi.success('Sender profile updated');
            } else {
              await createSenderProfile(payload);
              messageApi.success('Sender profile created');
            }
            await queryClient.invalidateQueries({ queryKey: ['senderProfiles', orgId] });
            setOpen(false);
            refetch();
          } catch (error: any) {
            if (error?.errorFields) return;
            messageApi.error(error?.message || 'Failed to save sender profile');
          }
        }}
        okText="Save"
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="key" label="Profile Key" rules={[{ required: true, message: 'Key is required' }]}>
            <Input placeholder="purchase" />
          </Form.Item>
          <Form.Item name="name" label="Display Name" rules={[{ required: true, message: 'Name is required' }]}>
            <Input placeholder="Purchase Mailbox" />
          </Form.Item>
          <Form.Item
            name="fromEmail"
            label="From Email"
            rules={[{ required: true, type: 'email', message: 'Valid from email is required' }]}
          >
            <Input placeholder="billing@example.com" />
          </Form.Item>
          <Form.Item
            name="aliasesText"
            label="Aliases"
            extra="Optional. One alias per line. Requests using these values will resolve the same sender profile."
          >
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder={'accounts@example.com\npurchase-team@example.com'}
            />
          </Form.Item>
          <Form.Item name="provider" label="Provider" rules={[{ required: true, message: 'Provider is required' }]}>
            <Select options={[{ label: 'SMTP', value: 'SMTP' }]} />
          </Form.Item>
          <InlineHint>
            SMTP is the active sender runtime — the sender-profile model is reusable and provider-aware, but the current
            runtime routes generic email through SMTP-backed sender profiles.
          </InlineHint>
          <Form.Item
            name={['providerConfig', 'host']}
            label="Host"
            rules={[{ required: provider === 'SMTP', message: 'SMTP host is required' }]}
          >
            <Input placeholder="smtp.office365.com or smtp.yourserver.com" />
          </Form.Item>
          <Form.Item
            name={['providerConfig', 'port']}
            label="Port"
            rules={[{ required: provider === 'SMTP', message: 'Port is required' }]}
          >
            <InputNumber min={1} max={65535} className="console-width-full" />
          </Form.Item>
          <Form.Item
            name={['providerConfig', 'username']}
            label="Username"
            rules={[{ required: provider === 'SMTP', message: 'Username is required' }]}
          >
            <Input placeholder="billing@example.com" />
          </Form.Item>
          <Form.Item
            name={['providerConfig', 'password']}
            label="Password"
            rules={[{ required: provider === 'SMTP', message: 'Password is required' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name={['providerConfig', 'secure']} label="Secure" valuePropName="checked">
            <Switch checkedChildren="SSL/TLS" unCheckedChildren="STARTTLS/Plain" />
          </Form.Item>
          <Form.Item name="isDefault" label="Default Profile" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch defaultChecked />
          </Form.Item>
        </Form>
      </Modal>
    </PageTemplate>
  );
};
