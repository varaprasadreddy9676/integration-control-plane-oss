import { useEffect, useState } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  Space,
  Typography,
  Tag,
  Popconfirm,
  message,
  Alert,
  Collapse,
  Tooltip,
  Radio,
} from 'antd';
import { PlusOutlined, KeyOutlined, DeleteOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/PageHeader';
import { ModernTable } from '../../components/common/ModernTable';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { copyTextToClipboard } from '../../utils/clipboard';
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  purgeApiKey,
  downloadMcpServer,
  getApiBaseUrl,
  type ApiKey,
  type CreatedApiKey,
} from '../../services/api';
import { formatDateTime } from '../../utils/format';
import { scrambleReveal } from '../../design-system/delight';

const { Text, Paragraph } = Typography;

/** Ready-to-paste .mcp.json using the key that was just created. */
const buildMcpConfigSnippet = (rawKey: string): string => {
  const baseUrl = getApiBaseUrl();
  const env = baseUrl.includes('validation.') ? 'validation' : 'production';
  return JSON.stringify(
    {
      mcpServers: {
        'integration-gateway': {
          command: 'node',
          args: ['/path/to/icp-mcp-server/src/index.js'],
          env: {
            ICP_ENV: env,
            ICP_API_BASE_URL: baseUrl,
            ICP_API_KEY: rawKey,
          },
        },
      },
    },
    null,
    2
  );
};

export const ApiKeysRoute = () => {
  const { spacing } = useDesignTokens();
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  // The new key decodes into view; copy always uses the real value.
  const [shownKey, setShownKey] = useState('');
  useEffect(() => scrambleReveal(createdKey?.key ?? '', setShownKey), [createdKey?.key]);
  const [isDownloadingMcp, setIsDownloadingMcp] = useState(false);
  const [form] = Form.useForm();

  const handleDownloadMcpServer = async () => {
    setIsDownloadingMcp(true);
    try {
      await downloadMcpServer();
      message.success('MCP server downloaded — see the README inside for setup');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unexpected error';
      message.error(`Couldn't download the MCP server: ${detail}`);
    } finally {
      setIsDownloadingMcp(false);
    }
  };

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
  });

  const createMutation = useMutation({
    mutationFn: ({ name, scope }: { name: string; scope: 'user' | 'integrations' }) => createApiKey(name, scope),
    onSuccess: (key) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setIsCreateModalOpen(false);
      form.resetFields();
      setCreatedKey(key);
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to create API key');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      message.success('API key revoked');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to revoke API key');
    },
  });

  const purgeMutation = useMutation({
    mutationFn: purgeApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      message.success('API key deleted');
    },
    onError: (error: any) => {
      message.error(error.message || 'Failed to delete API key');
    },
  });

  const handleCopy = async (text: string) => {
    const success = await copyTextToClipboard(text);
    message[success ? 'success' : 'error'](
      success ? 'Copied to clipboard' : 'Could not copy — select and copy manually'
    );
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: ApiKey) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {record.prefix}…
          </Text>
        </Space>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) =>
        role === 'API_KEY' ? (
          <Tooltip title="Can only run and view this organization's integrations">
            <Tag color="blue">Integrations only</Tag>
          </Tooltip>
        ) : (
          <Tag>{role}</Tag>
        ),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatDateTime(value),
    },
    {
      title: 'Last Used',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      render: (value: string | null) => (value ? formatDateTime(value) : <Text type="secondary">Never</Text>),
    },
    {
      title: 'Status',
      dataIndex: 'revokedAt',
      key: 'status',
      render: (revokedAt: string | null) =>
        revokedAt ? <Tag color="default">Revoked</Tag> : <Tag color="green">Active</Tag>,
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right' as const,
      render: (_: unknown, record: ApiKey) =>
        record.revokedAt ? (
          <Popconfirm
            title="Permanently delete this API key?"
            description="This removes it from the list entirely and cannot be undone."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => purgeMutation.mutate(record.id)}
          >
            <Button
              size="small"
              danger
              type="text"
              icon={<DeleteOutlined />}
              aria-label={`Delete ${record.name}`}
              loading={purgeMutation.isPending && purgeMutation.variables === record.id}
            />
          </Popconfirm>
        ) : (
          <Popconfirm
            title="Revoke this API key?"
            description="Anything using this key will immediately lose access. This cannot be undone."
            okText="Revoke"
            okButtonProps={{ danger: true }}
            onConfirm={() => revokeMutation.mutate(record.id)}
          >
            <Button
              size="small"
              danger
              type="text"
              icon={<DeleteOutlined />}
              aria-label={`Revoke ${record.name}`}
              loading={revokeMutation.isPending && revokeMutation.variables === record.id}
            />
          </Popconfirm>
        ),
    },
  ];

  return (
    <div style={{ width: '100%' }}>
      <Space direction="vertical" size={spacingToNumber(spacing[3])} style={{ width: '100%' }}>
        <PageHeader
          title="API Keys"
          description="Personal access tokens for scripts, CI pipelines, or MCP clients. A key authenticates as you — same role and org access — and can be revoked at any time."
          actions={
            <Space wrap>
              <Tooltip title="Get the MCP server package (zip) to run with Claude Code, Codex, or any MCP client — pair it with an API key from this page">
                <Button icon={<DownloadOutlined />} loading={isDownloadingMcp} onClick={handleDownloadMcpServer}>
                  Download MCP Server
                </Button>
              </Tooltip>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateModalOpen(true)}>
                Create API Key
              </Button>
            </Space>
          }
        />

        <ModernTable<ApiKey>
          columns={columns}
          dataSource={keys}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          emptyState={{
            icon: <KeyOutlined style={{ fontSize: 32 }} />,
            title: 'No API keys yet',
            description: 'Create one to authenticate scripts, CI pipelines, or MCP clients as yourself.',
            action: (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateModalOpen(true)}>
                Create API Key
              </Button>
            ),
          }}
        />
      </Space>

      <Modal
        title="Create API Key"
        open={isCreateModalOpen}
        onCancel={() => setIsCreateModalOpen(false)}
        onOk={() => form.submit()}
        okText="Create"
        confirmLoading={createMutation.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ scope: 'user' }}
          onFinish={(values) => createMutation.mutate({ name: values.name, scope: values.scope })}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Give this key a name so you can identify it later' }]}
          >
            <Input placeholder="e.g. CI pipeline, MCP server, laptop script" autoFocus maxLength={100} />
          </Form.Item>
          <Form.Item label="Access" name="scope">
            <Radio.Group>
              <Space direction="vertical">
                <Radio value="user">
                  Same as me
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    For your own scripts and MCP clients.
                  </Typography.Text>
                </Radio>
                <Radio value="integrations">
                  Run integrations only
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    For a partner or system that calls this organization's integrations. It can run and view them,
                    and nothing else.
                  </Typography.Text>
                </Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="API key created"
        open={!!createdKey}
        onCancel={() => setCreatedKey(null)}
        footer={
          <Button type="primary" onClick={() => setCreatedKey(null)}>
            Done — I've copied it
          </Button>
        }
        closable={false}
        maskClosable={false}
      >
        <Alert
          type="warning"
          showIcon
          message="Copy this key now — you won't be able to see it again"
          description="If you lose it, revoke this key and create a new one."
          style={{ marginBottom: spacing[3] }}
        />
        <Paragraph style={{ marginBottom: spacing[2] }}>
          <Text strong>{createdKey?.name}</Text>
        </Paragraph>
        <Space.Compact style={{ width: '100%' }}>
          <Input readOnly value={shownKey} aria-label="New API key" style={{ fontFamily: 'monospace' }} />
          <Button icon={<CopyOutlined />} onClick={() => createdKey && handleCopy(createdKey.key)}>
            Copy
          </Button>
        </Space.Compact>
        <Collapse
          ghost
          size="small"
          style={{ marginTop: spacing[3] }}
          items={[
            {
              key: 'mcp-setup',
              label: 'Use with an MCP client (Claude Code, Codex, Cursor)',
              children: (
                <>
                  <ol style={{ fontSize: 13, paddingLeft: 20, marginBottom: spacing[2] }}>
                    <li>
                      Click <Text strong>Download MCP Server</Text> on this page and unzip it.
                    </li>
                    <li>
                      In the unzipped folder, run <Text code>npm install</Text> (needs Node.js 18 or newer). Without
                      it the server can't start and your client only says it couldn't connect.
                    </li>
                    <li>
                      Paste the config below into your client's MCP config and change <Text code>args</Text> to the
                      absolute path of <Text code>src/index.js</Text> in that folder. It already includes your new key,
                      which won't be shown again.
                    </li>
                    <li>
                      Restart the client and ask it to run <Text code>gateway_health</Text>. <Text code>auth.ok</Text>{' '}
                      should be <Text code>true</Text>. The bundled README has the Claude Code and Codex versions.
                    </li>
                  </ol>
                  {createdKey && (
                    <>
                      <pre
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 12,
                          lineHeight: 1.6,
                          padding: spacing[2],
                          margin: 0,
                          borderRadius: 8,
                          border: '1px solid rgba(128, 128, 128, 0.25)',
                          background: 'rgba(128, 128, 128, 0.08)',
                          overflowX: 'auto',
                          maxHeight: 260,
                        }}
                      >
                        {buildMcpConfigSnippet(createdKey.key)}
                      </pre>
                      <Button
                        icon={<CopyOutlined />}
                        size="small"
                        style={{ marginTop: spacing[2] }}
                        onClick={() => handleCopy(buildMcpConfigSnippet(createdKey.key))}
                      >
                        Copy config
                      </Button>
                    </>
                  )}
                </>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
};
