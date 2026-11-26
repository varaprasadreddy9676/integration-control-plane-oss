import { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, Space, Popconfirm, message, Collapse, Tooltip, Radio } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../../components/common/PageHeader';
import { PageTemplate } from '../../components/common/PageTemplate';
import { FilterBar } from '../../components/common/FilterBar';
import { ModernTable } from '../../components/common/ModernTable';
import { StatusBadge } from '../../components/common/StatusBadge';
import { MetaTag } from '../../components/common/MetaTag';
import { useDesignTokens } from '../../design-system/utils';
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
import { Button } from '../../components/common/LegacyButton';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { InlineNotice as Notice } from '../../components/common';

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
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'revoked'>('all');
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

  const {
    data: keys = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
  });

  const filteredKeys = keys.filter((key) => {
    const search = searchText.trim().toLowerCase();
    const matchesSearch =
      !search || key.name.toLowerCase().includes(search) || key.prefix.toLowerCase().includes(search);
    const matchesStatus =
      statusFilter === 'all' || (statusFilter === 'active' ? !key.revokedAt : Boolean(key.revokedAt));
    return matchesSearch && matchesStatus;
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
          <AstryxText weight="semibold">{name}</AstryxText>
          <AstryxText type="code" size="sm" color="secondary">
            {record.prefix}…
          </AstryxText>
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
            <StatusBadge label="Integrations only" variant="info" showIcon={false} size="small" />
          </Tooltip>
        ) : (
          <MetaTag variant="neutral">{role}</MetaTag>
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
      render: (value: string | null) =>
        value ? (
          formatDateTime(value)
        ) : (
          <AstryxText type="supporting" color="secondary">
            Never
          </AstryxText>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'revokedAt',
      key: 'status',
      render: (revokedAt: string | null) =>
        revokedAt ? (
          <StatusBadge label="Revoked" variant="neutral" showIcon={false} size="small" />
        ) : (
          <StatusBadge label="Active" variant="success" showIcon={false} size="small" />
        ),
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
              icon={<GatewayIcon name="DeleteOutlined" />}
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
              icon={<GatewayIcon name="DeleteOutlined" />}
              aria-label={`Revoke ${record.name}`}
              loading={revokeMutation.isPending && revokeMutation.variables === record.id}
            />
          </Popconfirm>
        ),
    },
  ];

  return (
    <PageTemplate
      as="main"
      className="api-key-workspace"
      contentClassName="api-key-workspace__content"
      header={
        <PageHeader
          title="API Keys"
          description="Personal access tokens for scripts, CI pipelines, or MCP clients. A key authenticates as you — same role and org access — and can be revoked at any time."
          actions={
            <Space wrap>
              <Button icon={<GatewayIcon name="ReloadOutlined" />} onClick={() => refetch()} loading={isLoading}>
                Refresh
              </Button>
              <Tooltip title="Get the MCP server package (zip) to run with Claude Code, Codex, or any MCP client — pair it with an API key from this page">
                <Button
                  icon={<GatewayIcon name="DownloadOutlined" />}
                  loading={isDownloadingMcp}
                  onClick={handleDownloadMcpServer}
                >
                  Download MCP Server
                </Button>
              </Tooltip>
              <Button
                type="primary"
                icon={<GatewayIcon name="PlusOutlined" />}
                onClick={() => setIsCreateModalOpen(true)}
              >
                Create API Key
              </Button>
            </Space>
          }
        />
      }
    >
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
        <div className="api-key-filter-grid">
          <label className="api-key-filter-field">
            <span>Search keys</span>
            <Input
              aria-label="Search API keys"
              placeholder="Name or key prefix"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              allowClear
            />
          </label>
          <label className="api-key-filter-field">
            <span>Status</span>
            <Select aria-label="Filter API keys by status" value={statusFilter} onChange={setStatusFilter}>
              <Select.Option value="all">All statuses</Select.Option>
              <Select.Option value="active">Active</Select.Option>
              <Select.Option value="revoked">Revoked</Select.Option>
            </Select>
          </label>
        </div>
      </FilterBar>

      {error && (
        <Notice
          type="error"
          message="Could not load API keys"
          description={error instanceof Error ? error.message : 'An unexpected error occurred.'}
          action={
            <Button size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      )}

      <section className="api-key-table-section" aria-label="API key directory">
        <div className="api-key-table-heading">
          <AstryxText weight="semibold">API keys</AstryxText>
          <AstryxText type="supporting" color="secondary">
            Showing {filteredKeys.length} of {keys.length}
          </AstryxText>
        </div>
        <ModernTable<ApiKey>
          columns={columns}
          dataSource={filteredKeys}
          rowKey="id"
          loading={isLoading}
          pagination={{ pageSize: 20 }}
          emptyState={{
            icon: <GatewayIcon name="KeyOutlined" className="ui-extracted-f2cf2c9518" />,
            title: keys.length ? 'No API keys match these filters' : 'No API keys yet',
            description: keys.length
              ? 'Change or clear a filter to see the full list.'
              : 'Create one to authenticate scripts, CI pipelines, or MCP clients as yourself.',
            action: keys.length ? undefined : (
              <Button
                type="primary"
                icon={<GatewayIcon name="PlusOutlined" />}
                onClick={() => setIsCreateModalOpen(true)}
              >
                Create API Key
              </Button>
            ),
          }}
        />
      </section>

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
                  <AstryxText as="div" display="block" type="supporting" size="sm" color="secondary">
                    For your own scripts and MCP clients.
                  </AstryxText>
                </Radio>
                <Radio value="integrations">
                  Run integrations only
                  <AstryxText as="div" display="block" type="supporting" size="sm" color="secondary">
                    For a partner or system that calls this organization's integrations. It can run and view them, and
                    nothing else.
                  </AstryxText>
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
        <Notice
          type="warning"
          message="Copy this key now — you won't be able to see it again"
          description="If you lose it, revoke this key and create a new one."
          className="console-margin-bottom-3"
        />
        <AstryxText as="p" display="block" className="console-margin-bottom-2">
          <AstryxText weight="semibold">{createdKey?.name}</AstryxText>
        </AstryxText>
        <Space.Compact className="console-width-full">
          <Input readOnly value={shownKey} aria-label="New API key" className="console-font-mono" />
          <Button icon={<GatewayIcon name="CopyOutlined" />} onClick={() => createdKey && handleCopy(createdKey.key)}>
            Copy
          </Button>
        </Space.Compact>
        <Collapse
          ghost
          size="small"
          className="console-margin-top-3"
          items={[
            {
              key: 'mcp-setup',
              label: 'Use with an MCP client (Claude Code, Codex, Cursor)',
              children: (
                <>
                  <ol
                    style={{
                      fontSize: 'var(--console-type-body)',
                      paddingLeft: 'var(--spacing-5)',
                      marginBottom: spacing[2],
                    }}
                  >
                    <li>
                      Click <AstryxText weight="semibold">Download MCP Server</AstryxText> on this page and unzip it.
                    </li>
                    <li>
                      In the unzipped folder, run <AstryxText type="code">npm install</AstryxText> (needs Node.js 18 or
                      newer). Without it the server can't start and your client only says it couldn't connect.
                    </li>
                    <li>
                      Paste the config below into your client's MCP config and change{' '}
                      <AstryxText type="code">args</AstryxText> to the absolute path of{' '}
                      <AstryxText type="code">src/index.js</AstryxText> in that folder. It already includes your new
                      key, which won't be shown again.
                    </li>
                    <li>
                      Restart the client and ask it to run <AstryxText type="code">gateway_health</AstryxText>.{' '}
                      <AstryxText type="code">auth.ok</AstryxText> should be <AstryxText type="code">true</AstryxText>.
                      The bundled README has the Claude Code and Codex versions.
                    </li>
                  </ol>
                  {createdKey && (
                    <>
                      <pre
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 'var(--console-type-caption)',
                          lineHeight: 1.6,
                          padding: spacing[2],
                          margin: 'var(--spacing-0)',
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
                        icon={<GatewayIcon name="CopyOutlined" />}
                        size="small" className="console-margin-top-2"
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
    </PageTemplate>
  );
};
