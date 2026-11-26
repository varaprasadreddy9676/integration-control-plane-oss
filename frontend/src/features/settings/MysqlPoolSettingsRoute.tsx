/**
 * MySQL Shared Pool Settings Route
 * /settings/mysql-pool
 *
 * Lets SUPER_ADMIN / ADMIN configure the shared MySQL connection pool at runtime.
 * Credentials are stored in MongoDB system_config and auto-applied on server restart.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Col, Divider, Form, Input, InputNumber, Row, Space, App } from "@/components/common/LegacyAntdControls";
import { Banner } from '@astryxdesign/core/Banner';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { PageHeader } from '../../components/common';
import { PageTemplate } from '../../components/common/PageTemplate';
import { StatePanel } from '../../components/common/StatePanel';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
import { useDesignTokens } from '../../design-system/utils';
import {
  getAdminMysqlPool,
  updateAdminMysqlPool,
  testAdminMysqlPool,
  type MysqlPoolConfig,
  type EventSourceTestResult,
} from '../../services/api';
import { useAuth } from '../../app/auth-context';
import { Button } from '../../components/common/LegacyButton';
import { StatusBadge } from '../../components/common/StatusBadge';

function TestResultPanel({ result }: { result: EventSourceTestResult }) {
  if (!result.success) {
    return (
      <Banner
        status="error"
        title={
          <Space>
            <Text weight="semibold">Connection failed</Text>
            {result.code && <code>{result.code}</code>}
          </Space>
        }
        description={
          <Space direction="vertical" size={4} className="console-width-full">
            <Text>{result.error}</Text>
            {result.hint && (
              <Text color="secondary">
                <GatewayIcon name="InfoCircleOutlined" className="console-margin-right-1" />
                {result.hint}
              </Text>
            )}
          </Space>
        }
      />
    );
  }

  return (
    <Banner
      status="success"
      title={<Text weight="semibold">Connection successful</Text>}
      description={result.message}
    />
  );
}

export const MysqlPoolSettingsRoute = () => {
  const { user } = useAuth();
  const { message: messageApi } = App.useApp();
  const { spacing } = useDesignTokens();
  const [form] = Form.useForm();

  const [isConfigured, setIsConfigured] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<MysqlPoolConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<EventSourceTestResult | null>(null);

  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await getAdminMysqlPool();
      setIsConfigured(data.isConfigured);
      setCurrentConfig(data.config);
      if (data.isConfigured && data.config?.host) {
        form.setFieldsValue({
          host: data.config.host,
          port: data.config.port ?? 3306,
          user: data.config.user,
          database: data.config.database,
          connectionLimit: data.config.connectionLimit,
          queueLimit: data.config.queueLimit,
          // never pre-fill password
        });
      } else {
        form.setFieldsValue({ port: 3306 });
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadConfig();
  }, [isAdmin, loadConfig]);

  const handleTest = async () => {
    let values: MysqlPoolConfig;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAdminMysqlPool(values);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message, code: 'REQUEST_FAILED' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    let values: MysqlPoolConfig;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const result = await updateAdminMysqlPool(values);
      if (result.success) {
        messageApi.success(result.message || 'MySQL pool configuration saved.');
        setIsConfigured(true);
        // Reload masked config
        const data = await getAdminMysqlPool();
        setCurrentConfig(data.config);
        setTestResult(null);
      } else {
        messageApi.error('Failed to configure MySQL pool.');
      }
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <PageTemplate
        as="main"
        title="MySQL Shared Pool"
        breadcrumb={[{ label: 'Settings', path: '/settings' }, { label: 'MySQL Shared Pool' }]}
        compact
      >
        <StatePanel
          glyph="searching"
          tone="neutral"
          title="Access restricted"
          description="You need a platform administrator role to manage the MySQL shared pool."
        />
      </PageTemplate>
    );
  }

  if (loadError) {
    return (
      <PageTemplate
        as="main"
        className="mysql-pool-settings-template"
        contentClassName="mysql-pool-settings-template__content"
        header={
          <PageHeader
            title="MySQL Shared Pool"
            breadcrumb={[{ label: 'Settings', path: '/settings' }, { label: 'MySQL Shared Pool' }]}
            compact
          />
        }
      >
        <StatePanel
          glyph="disrupted"
          tone="critical"
          title="Could not load shared pool settings"
          description="No settings were changed."
          actions={
            <AstryxButton label="Retry" variant="secondary" isLoading={loading} onClick={() => void loadConfig()} />
          }
        />
      </PageTemplate>
    );
  }

  return (
    <PageTemplate
      as="main"
      className="mysql-pool-settings-template"
      contentClassName="mysql-pool-settings-template__content"
      header={
        <PageHeader
          title="MySQL Shared Pool"
          description="Configure the server-wide MySQL connection pool used by orgs with 'Use shared pool' enabled."
          breadcrumb={[{ label: 'Settings', path: '/settings' }, { label: 'MySQL Shared Pool' }]}
          compact
          actions={
            isConfigured ? (
              <StatusBadge label="Configured" variant="success" size="small" showIcon={false} />
            ) : (
              <StatusBadge label="Not configured" variant="neutral" size="small" showIcon={false} />
            )
          }
        />
      }
    >
      {/* Current status card */}
      {isConfigured && currentConfig?.host && (
        <Card size="small" className="console-margin-bottom-3">
          <Space split={<Divider type="vertical" />} wrap>
            <Space size={4}>
              <Text color="secondary">Host:</Text>
              <Text type="code">
                {currentConfig.host}
                {currentConfig.port ? `:${currentConfig.port}` : ''}
              </Text>
            </Space>
            {currentConfig.user && (
              <Space size={4}>
                <Text color="secondary">User:</Text>
                <Text type="code">{currentConfig.user}</Text>
              </Space>
            )}
            {currentConfig.database && (
              <Space size={4}>
                <Text color="secondary">Database:</Text>
                <Text type="code">{currentConfig.database}</Text>
              </Space>
            )}
            <Space size={4}>
              <Text color="secondary">Password:</Text>
              <Text type="code">****</Text>
            </Space>
          </Space>
        </Card>
      )}

      <Card
        title={
          <Space>
            <GatewayIcon name="DatabaseOutlined" />
            Connection Credentials
          </Space>
        }
        loading={loading}
      >
        <Form form={form} layout="vertical" size="middle">
          <Row gutter={16}>
            <Col xs={24} md={16}>
              <Form.Item name="host" label="Host" rules={[{ required: true, message: 'Host is required' }]}>
                <Input placeholder="mysql.example.com" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="port" label="Port">
                <InputNumber min={1} max={65535} className="console-width-full" placeholder="3306" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="user" label="Username" rules={[{ required: true, message: 'Username is required' }]}>
                <Input placeholder="db_user" autoComplete="username" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Password is required' }]}>
                <Input.Password placeholder="••••••••" autoComplete="new-password" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="database"
            label="Database"
            rules={[{ required: true, message: 'Database name is required' }]}
          >
            <Input placeholder="my_database" />
          </Form.Item>

          <Divider orientation="left">Advanced (optional)</Divider>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="connectionLimit"
                label="Connection Limit"
                tooltip="Max simultaneous connections in the pool (1–20)"
              >
                <InputNumber min={1} max={20} className="console-width-full" placeholder="10" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="queueLimit"
                label="Queue Limit"
                tooltip="Max queued connection requests before rejecting (0 = unlimited)"
              >
                <InputNumber min={0} max={200} className="console-width-full" placeholder="0" />
              </Form.Item>
            </Col>
          </Row>

          <Divider />

          <Space wrap>
            <Button icon={<GatewayIcon name="WifiOutlined" />} onClick={handleTest} loading={testing}>
              Test Connection
            </Button>
            <Button type="primary" icon={<GatewayIcon name="SaveOutlined" />} onClick={handleSave} loading={saving}>
              Save & Apply
            </Button>
          </Space>

          {testResult && (
            <div className="console-margin-top-4">
              <TestResultPanel result={testResult} />
            </div>
          )}
        </Form>
      </Card>
    </PageTemplate>
  );
};
