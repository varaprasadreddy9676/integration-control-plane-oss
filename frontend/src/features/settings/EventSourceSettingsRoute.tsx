/**
 * Event Source Settings Route
 * /settings/event-source
 *
 * Lets org admins configure how events are ingested:
 *   - MySQL polling (with per-org column mapping)
 *   - Kafka consumer
 *   - HTTP Push (inbound webhook)
 *   - HL7 MLLP listener
 *
 * Features:
 *   - Live column discovery from the real DB table
 *   - Test Connection validates credentials + mapping before saving
 *   - Full audit trail via backend audit-logger
 *   - Org-scoped: ORG_ADMIN only sees/edits their own org's config
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Select,
  Input,
  InputNumber,
  Switch,
  Space,
  Divider,
  App,
  Spin,
  Tooltip,
  Row,
  Col,
  Collapse,
  Modal,
  Badge,
} from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { PageHeader } from '../../components/common';
import { PageTemplate } from '../../components/common/PageTemplate';
import { PermissionGuard } from '../../components/common';
import { InlineHint } from '../../components/common/InlineHint';
import { StatePanel } from '../../components/common/StatePanel';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Banner } from '@astryxdesign/core/Banner';
import { cssVar, useDesignTokens } from '../../design-system/utils';
import {
  getEventSourceConfig,
  upsertEventSourceConfig,
  deleteEventSourceConfig,
  testEventSourceConnection,
  getEventSourceColumns,
  getEventTypes,
  type ColumnMeta,
  type EventSourceTestResult,
} from '../../services/api';
import activityTracker, { ACTIVITY_EVENTS } from '../../services/activity-tracker';
import { useTenant } from '../../app/tenant-context';
import { ModernTable } from '../../components/common/ModernTable';
import { usePermissions } from '../../hooks/usePermissions';
import { Button } from '../../components/common/LegacyButton';
import { Typography } from '../../components/common/LegacyTypography';

const { Text, Title, Paragraph } = Typography;

const TEST_CONNECTION_TOOLTIPS: Record<string, string> = {
  mysql: 'Checks database credentials, table access, and column mappings. Nothing is saved.',
  kafka: 'Checks broker connectivity and topic access. Nothing is saved.',
  http_push: 'Validates the HTTP push queue settings locally. Nothing is saved.',
  hl7_mllp: 'Validates the listener, TLS, and message settings. Nothing is saved.',
};

function normalizeMessageTypeMapping(value: unknown) {
  if (!value) return {};
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? JSON.parse(trimmed) : {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function normalizeDelimitedList(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEventSourceConfig(type: string, cfg: Record<string, any>) {
  if (type !== 'hl7_mllp') return cfg;
  const tls = cfg.tls || {};
  const tlsEnabled = Boolean(tls.enabled);

  return {
    ...cfg,
    host: String(cfg.host || '0.0.0.0').trim(),
    port: cfg.port ? Number(cfg.port) : cfg.port,
    idleTimeoutMs: cfg.idleTimeoutMs ? Number(cfg.idleTimeoutMs) : undefined,
    maxMessageBytes: cfg.maxMessageBytes ? Number(cfg.maxMessageBytes) : undefined,
    duplicateWindowMs: cfg.duplicateWindowMs ? Number(cfg.duplicateWindowMs) : undefined,
    listenerLockEnabled: Boolean(cfg.listenerLockEnabled),
    listenerLockTtlMs: cfg.listenerLockTtlMs ? Number(cfg.listenerLockTtlMs) : undefined,
    allowedSourceIps: normalizeDelimitedList(cfg.allowedSourceIps),
    messageTypeMapping: normalizeMessageTypeMapping(cfg.messageTypeMapping),
    tls: {
      ...tls,
      enabled: tlsEnabled,
      requestCert: Boolean(tls.requestCert),
      rejectUnauthorized: tls.rejectUnauthorized !== false,
    },
  };
}

// ---------------------------------------------------------------------------
// Column mapping field definitions
// ---------------------------------------------------------------------------

const MAPPING_FIELDS = [
  {
    key: 'id',
    label: 'Row ID',
    required: true,
    description: 'Auto-increment primary key — used as the polling cursor',
  },
  {
    key: 'orgId',
    label: 'Org ID',
    required: true,
    description: 'Column that identifies the organisation (used to scope queries)',
  },
  {
    key: 'eventType',
    label: 'Event Type',
    required: true,
    description: 'Column containing the event type string (e.g. OP_VISIT_CREATED)',
  },
  {
    key: 'payload',
    label: 'Payload',
    required: true,
    description: 'Column with the event JSON payload (varchar or json type)',
  },
  {
    key: 'orgUnitId',
    label: 'Org Unit ID',
    required: false,
    description: 'Optional: sub-entity / branch identifier',
  },
  {
    key: 'timestamp',
    label: 'Timestamp',
    required: false,
    description: 'Optional: event creation time',
  },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ColumnSelect({
  discoveredColumns,
  placeholder,
  value,
  onChange,
}: {
  discoveredColumns: ColumnMeta[];
  placeholder: string;
  value?: string | null;
  onChange?: (...args: any[]) => void;
}) {
  if (discoveredColumns.length === 0) {
    return <Input placeholder={placeholder} value={value ?? undefined} onChange={onChange as any} />;
  }
  return (
    <Select
      showSearch
      allowClear
      placeholder={placeholder}
      value={value ?? undefined}
      onChange={onChange}
      filterOption={(input, option) => ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())}
      options={discoveredColumns.map((c) => ({
        value: c.name,
        label: c.name,
        title: `${c.name} — ${c.type}${c.nullable ? ' (nullable)' : ''}${c.key ? ` [${c.key}]` : ''}`,
      }))}
    />
  );
}

function MysqlFields({
  useSharedPool,
  discoveredColumns,
  discovering,
  onDiscover,
  orgId,
  eventTypeOptions,
}: {
  useSharedPool: boolean;
  discoveredColumns: ColumnMeta[];
  discovering: boolean;
  onDiscover: () => void;
  orgId: number | string | null;
  eventTypeOptions: string[];
}) {
  const { spacing } = useDesignTokens();

  return (
    <>
      <Form.Item
        name="useSharedPool"
        label="Use shared database pool"
        valuePropName="checked"
        tooltip="Enable to use the server's built-in MySQL connection. Disable to provide dedicated credentials for this org."
      >
        <Switch />
      </Form.Item>

      {!useSharedPool && (
        <>
          <Row gutter={16}>
            <Col span={16}>
              {/* preserve={false} removes this field from form state when hidden,
                  preventing required-rule validation from firing on shared pool */}
              <Form.Item
                name="host"
                label="Host"
                preserve={false}
                rules={[{ required: true, message: 'Host is required' }]}
              >
                <Input placeholder="mysql.example.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="port" label="Port" preserve={false}>
                <InputNumber min={1} max={65535} className="console-width-full" placeholder="3306" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="user"
                label="Username"
                preserve={false}
                rules={[{ required: true, message: 'Username is required' }]}
              >
                <Input placeholder="db_user" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="password" label="Password" preserve={false}>
                <Input.Password placeholder="••••••••" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="database"
            label="Database"
            preserve={false}
            rules={[{ required: true, message: 'Database name is required' }]}
          >
            <Input placeholder="my_database" />
          </Form.Item>
        </>
      )}

      <Row gutter={16}>
        <Col span={16}>
          <Form.Item
            name="table"
            label="Table"
            rules={[{ required: true, message: 'Table name is required' }]}
            tooltip="The table to poll for new events"
          >
            <Input placeholder="notification_queue" />
          </Form.Item>
        </Col>
        <Col span={8} className="ui-extracted-fd8218bf00">
          <Button icon={<GatewayIcon name="SearchOutlined" />} onClick={onDiscover} loading={discovering} block>
            Discover Columns
          </Button>
        </Col>
      </Row>

      {discoveredColumns.length > 0 && (
        <Banner
          status="success"
          title={`${discoveredColumns.length} columns discovered from table`}
          description="Select columns below using the dropdown, or type a name manually."
          className="console-margin-bottom-4"
        />
      )}

      <Divider orientation="left" className="console-type-body">
        Column Mapping
        <Tooltip title="Map each standard event field to the actual column name in your table. Run Discover Columns to pick from a dropdown.">
          <GatewayIcon name="InfoCircleOutlined" style={{ marginLeft: 'var(--spacing-2)', color: cssVar.text.muted }} />
        </Tooltip>
      </Divider>

      <Row gutter={16}>
        {MAPPING_FIELDS.map((field) => (
          <Col key={field.key} span={12}>
            <Form.Item
              name={['columnMapping', field.key]}
              label={
                <Space size={4}>
                  {field.label}
                  {!field.required && <Text type="secondary">Optional</Text>}
                </Space>
              }
              tooltip={
                field.key === 'orgId'
                  ? `Column in your MySQL table that contains the organisation identifier. The system will automatically filter rows where this column equals your org ID${orgId ? ` (${orgId})` : ''}.`
                  : field.description
              }
            >
              <ColumnSelect
                discoveredColumns={discoveredColumns}
                placeholder={`e.g. ${field.key === 'id' ? 'id' : field.key === 'orgId' ? 'org_id' : field.key === 'eventType' ? 'transaction_type' : field.key === 'payload' ? 'message' : field.key}`}
              />
            </Form.Item>
          </Col>
        ))}
      </Row>

      <Divider orientation="left" className="console-type-body">
        Row Filters
        <Tooltip title="Optionally restrict which rows are processed. Leave blank to process all rows for your org.">
          <GatewayIcon name="InfoCircleOutlined" style={{ marginLeft: 'var(--spacing-2)', color: cssVar.text.muted }} />
        </Tooltip>
      </Divider>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="orgUnitIdFilter"
            label="Org Unit ID Filter"
            tooltip="Only process rows whose Org Unit ID column value matches one of these. Enter comma-separated values (e.g. 101,205,310). Leave blank to include all org units."
          >
            <Input placeholder="e.g. 101, 205, 310" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="eventTypeFilter"
            label="Event Type Filter"
            tooltip="Only process rows whose Event Type column value matches one of the selected types. Leave blank to process all event types."
            getValueFromEvent={(val: string[]) => val}
            getValueProps={(val: string | string[]) => ({
              value: Array.isArray(val)
                ? val
                : val
                  ? String(val)
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : [],
            })}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="All event types"
              showSearch
              filterOption={(input, option) =>
                ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={eventTypeOptions.map((t) => ({ value: t, label: t }))}
            />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="pollIntervalMs"
            label="Poll Interval (ms)"
            tooltip="How often to check for new rows. Default: 5000"
          >
            <InputNumber min={500} max={300000} className="console-width-full" placeholder="5000" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="batchSize" label="Batch Size" tooltip="Rows fetched per poll cycle. Default: 10">
            <InputNumber min={1} max={500} className="console-width-full" placeholder="10" />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}

function KafkaFields() {
  return (
    <>
      <Form.Item
        name="brokers"
        label="Brokers"
        rules={[{ required: true, message: 'At least one broker is required' }]}
        tooltip="Comma-separated list of broker addresses (host:port)"
        getValueFromEvent={(e: React.ChangeEvent<HTMLInputElement>) =>
          e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        }
        getValueProps={(value: string[]) => ({ value: Array.isArray(value) ? value.join(', ') : value })}
      >
        <Input placeholder="kafka1.example.com:9092, kafka2.example.com:9092" />
      </Form.Item>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="topic" label="Topic" rules={[{ required: true, message: 'Topic is required' }]}>
            <Input placeholder="events.outbound" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="groupId" label="Consumer Group ID" tooltip="Defaults to ig-org-{orgId} if not set">
            <Input placeholder="ig-org-145" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="clientId" label="Client ID">
            <Input placeholder="integration-gateway" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="fromBeginning"
            label="Consume from beginning"
            valuePropName="checked"
            tooltip="Read all messages from the start of the topic (only on first connect)"
          >
            <Switch />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="sessionTimeout" label="Session Timeout (ms)">
            <InputNumber min={1000} className="console-width-full" placeholder="30000" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="heartbeatInterval" label="Heartbeat Interval (ms)">
            <InputNumber min={100} className="console-width-full" placeholder="3000" />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}

function HttpPushFields() {
  return (
    <>
      <InlineHint icon={<GatewayIcon name="ApiOutlined" />}>
        HTTP Push — external systems send events via <Text code>POST /api/v1/events/push</Text> with your org's API key.
        Accepted events are queued durably and retried automatically when processing fails.
      </InlineHint>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="pollIntervalMs"
            label="Poll Interval (ms)"
            tooltip="How often the gateway checks for queued events"
          >
            <InputNumber min={100} step={100} className="console-width-full" placeholder="1000" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="batchSize" label="Batch Size" tooltip="Maximum events claimed in one poll">
            <InputNumber min={1} max={100} className="console-width-full" placeholder="10" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="maxAttempts"
            label="Maximum Attempts"
            tooltip="Event is marked failed after this many attempts"
          >
            <InputNumber min={1} max={100} className="console-width-full" placeholder="5" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="staleAfterMs"
            label="Stale Claim Timeout (ms)"
            tooltip="Processing claims older than this are recovered after a restart"
          >
            <InputNumber min={1000} step={1000} className="console-width-full" placeholder="300000" />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}

function Hl7MllpFields() {
  return (
    <>
      <InlineHint icon={<GatewayIcon name="WifiOutlined" />}>
        HL7 MLLP listener — external systems send HL7 v2 messages over MLLP/TCP. The gateway parses the message, sends
        an HL7 ACK/NACK, and routes the parsed payload through normal event processing.
      </InlineHint>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="host"
            label="Listen Host"
            initialValue="0.0.0.0"
            rules={[{ required: true, message: 'Listen host is required' }]}
          >
            <Input placeholder="0.0.0.0" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="port" label="Listen Port" rules={[{ required: true, message: 'Listen port is required' }]}>
            <InputNumber min={1} max={65535} className="console-width-full" placeholder="2575" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="ackSendingApp" label="ACK Sending App" initialValue="INTEGRATION_GATEWAY">
            <Input placeholder="INTEGRATION_GATEWAY" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="ackSendingFacility" label="ACK Sending Facility">
            <Input placeholder="Optional facility name" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="idleTimeoutMs" label="Socket Idle Timeout (ms)" initialValue={30000}>
            <InputNumber min={1000} max={300000} className="console-width-full" placeholder="30000" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="maxMessageBytes" label="Max Message Size (bytes)" initialValue={5242880}>
            <InputNumber min={1024} max={10485760} className="console-width-full" placeholder="5242880" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name="duplicateWindowMs"
            label="Duplicate Window (ms)"
            initialValue={21600000}
            tooltip="Recently accepted MSH-10 message control IDs are ACKed without reprocessing during this window."
          >
            <InputNumber min={1000} max={86400000} className="console-width-full" placeholder="21600000" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="listenerLockEnabled"
            label="Primary listener lock"
            valuePropName="checked"
            tooltip="Enable when multiple workers may run this source. Only one worker holds the listener lease at a time."
          >
            <Switch />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="listenerLockTtlMs" label="Listener Lock TTL (ms)" initialValue={30000}>
            <InputNumber min={5000} max={300000} className="console-width-full" placeholder="30000" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="allowedSourceIps"
            label="Allowed Source IPs / CIDRs"
            tooltip="Optional allowlist. Leave blank to allow any network source that can reach the listener."
            getValueFromEvent={(e: React.ChangeEvent<HTMLTextAreaElement>) => normalizeDelimitedList(e.target.value)}
            getValueProps={(value: any) => ({
              value: Array.isArray(value) ? value.join('\n') : value,
            })}
          >
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder={`10.10.20.50\n10.10.0.0/16`} />
          </Form.Item>
        </Col>
      </Row>

      <Divider orientation="left" plain>
        TLS
      </Divider>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            name={['tls', 'enabled']}
            label="Enable TLS"
            valuePropName="checked"
            tooltip="Use TLS/MLLP instead of plain TCP/MLLP. The server certificate and key must be readable by the backend process."
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name={['tls', 'requestCert']}
            label="Request client certificate"
            valuePropName="checked"
            tooltip="Enable for mTLS when the sender must present a client certificate."
          >
            <Switch />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name={['tls', 'keyPath']} label="TLS Key Path">
            <Input placeholder="/etc/integration-control-plane/hl7.key" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name={['tls', 'certPath']} label="TLS Cert Path">
            <Input placeholder="/etc/integration-control-plane/hl7.crt" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name={['tls', 'caPath']} label="Client CA Path">
            <Input placeholder="/etc/integration-control-plane/client-ca.crt" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name={['tls', 'rejectUnauthorized']}
            label="Reject unauthorized clients"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item
        name="messageTypeMapping"
        label="Message Type Mapping"
        tooltip="Optional JSON object. Example: {&quot;ORM^O01&quot;:&quot;RIS_ORDER_CREATED&quot;}. Defaults to HL7_ORM_O01 style event names."
        getValueFromEvent={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
          const raw = e.target.value;
          if (!raw.trim()) return {};
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        }}
        getValueProps={(value: any) => ({
          value: typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2),
        })}
        rules={[
          {
            validator: async (_, value) => {
              if (!value) return;
              if (typeof value === 'object' && !Array.isArray(value)) return;
              try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return;
              } catch {
                // handled below
              }
              throw new Error('Enter a valid JSON object');
            },
          },
        ]}
      >
        <Input.TextArea
          autoSize={{ minRows: 4, maxRows: 8 }}
          placeholder={`{\n  "ORM^O01": "RIS_ORDER_CREATED",\n  "ORU^R01": "RIS_REPORT_READY",\n  "ADT^A08": "PATIENT_DEMOGRAPHICS_UPDATED"\n}`}
        />
      </Form.Item>
    </>
  );
}

function TestResultPanel({ result }: { result: EventSourceTestResult }) {
  if (!result.success) {
    return (
      <Banner
        status="error"
        title={
          <Space>
            <Text strong>Connection failed</Text>
            {result.code && <Text code>{result.code}</Text>}
          </Space>
        }
        description={
          <Space direction="vertical" size={4} className="console-width-full">
            <Text>{result.error}</Text>
            {result.hint && (
              <Text type="secondary">
                <GatewayIcon name="InfoCircleOutlined" className="console-margin-right-1" />
                {result.hint}
              </Text>
            )}
          </Space>
        }
      />
    );
  }

  const mappingRows = result.validatedMapping
    ? Object.entries(result.validatedMapping).map(([field, info]) => ({
        field,
        column: info.column,
        found: info.found,
        type: info.type,
      }))
    : [];

  const collapseItems = [
    ...(mappingRows.length > 0
      ? [
          {
            key: 'mapping',
            label: `Column Mapping Validation (${mappingRows.filter((r) => r.found).length}/${mappingRows.length} found)`,
            children: (
              <ModernTable
                size="small"
                dataSource={mappingRows}
                rowKey="field"
                pagination={false}
                columns={[
                  { title: 'Field', dataIndex: 'field', width: 120, render: (v: string) => <Text code>{v}</Text> },
                  { title: 'Column', dataIndex: 'column', render: (v: string) => <Text code>{v}</Text> },
                  {
                    title: 'Status',
                    dataIndex: 'found',
                    width: 80,
                    render: (found: boolean) => (
                      <StatusBadge
                        status={found ? 'SUCCESS' : 'FAILED'}
                        label={found ? 'Found' : 'Missing'}
                        variant={found ? 'success' : 'error'}
                        size="small"
                      />
                    ),
                  },
                  {
                    title: 'DB Type',
                    dataIndex: 'type',
                    render: (v: string) => (v ? <Text type="secondary">{v}</Text> : '—'),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
    ...(result.tableColumns && result.tableColumns.length > 0
      ? [
          {
            key: 'columns',
            label: `All Table Columns (${result.tableColumns.length})`,
            children: (
              <Space wrap size={4}>
                {result.tableColumns.map((col) => (
                  <Text key={col} code>
                    {col}
                  </Text>
                ))}
              </Space>
            ),
          },
        ]
      : []),
    ...(result.sampleEvent
      ? [
          {
            key: 'sample',
            label: 'Sample Event (normalized)',
            children: (
              <pre
                style={{
                  background: cssVar.bg.subtle,
                  padding: 'var(--spacing-3)',
                  borderRadius: 4,
                  fontSize: 'var(--console-type-caption)',
                  overflowX: 'auto',
                  margin: 'var(--spacing-0)',
                }}
              >
                {JSON.stringify(result.sampleEvent, null, 2)}
              </pre>
            ),
          },
        ]
      : []),
  ];

  return (
    <Space direction="vertical" className="console-width-full" size={12}>
      <Banner status="success" title={<Text strong>Connection successful</Text>} description={result.message} />
      {collapseItems.length > 0 && <Collapse size="small" items={collapseItems} />}
    </Space>
  );
}

// ---------------------------------------------------------------------------
// Main route
// ---------------------------------------------------------------------------

export const EventSourceSettingsRoute = () => {
  const { orgId } = useTenant();
  const canReadEventSource = usePermissions().can('event_source', 'read');

  const { data: eventTypeOptions = [] } = useQuery({
    queryKey: ['outboundEventTypes', orgId],
    queryFn: getEventTypes,
    enabled: canReadEventSource,
    staleTime: 300_000,
  });
  const { message: messageApi, modal } = App.useApp();
  const { spacing } = useDesignTokens();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  // Reactive form watches
  const sourceType: string = Form.useWatch('type', form) ?? 'none';
  const useSharedPool: boolean = Form.useWatch('useSharedPool', form) ?? true;

  // Column discovery state
  const [discoveredColumns, setDiscoveredColumns] = useState<ColumnMeta[]>([]);
  const [discovering, setDiscovering] = useState(false);

  // Test result state
  const [testResult, setTestResult] = useState<EventSourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Track page view on mount
  useEffect(() => {
    activityTracker.track({
      event: ACTIVITY_EVENTS.SETTINGS_VIEWED,
      action: 'event-source-settings-viewed',
      metadata: { orgId },
    });
  }, [orgId]);

  // Load existing config — treat 404 as "not configured yet" (not an error)
  const {
    data: currentConfig,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ['eventSourceConfig', orgId],
    queryFn: async () => {
      try {
        return await getEventSourceConfig(orgId);
      } catch (e: any) {
        if (e?.statusCode === 404) return null;
        throw e;
      }
    },
    enabled: !!orgId && canReadEventSource,
    retry: false,
    staleTime: 30_000,
  });

  const { data: savedColumnsResult } = useQuery({
    queryKey: ['eventSourceColumns', orgId, currentConfig?.updatedAt, currentConfig?.config?.table],
    queryFn: () => getEventSourceColumns(orgId),
    enabled: !!orgId && !!currentConfig && currentConfig.type === 'mysql',
    retry: false,
    staleTime: 30_000,
  });

  // Populate form when config loads
  useEffect(() => {
    if (currentConfig) {
      form.setFieldsValue({
        type: currentConfig.type,
        ...currentConfig.config,
      });
      // Clear test result when config is (re)loaded
      setTestResult(null);
      setDiscoveredColumns([]);
    } else if (currentConfig === null) {
      // Not configured — show the "none" state by default
      form.setFieldsValue({ type: 'none' });
    }
  }, [currentConfig, form]);

  useEffect(() => {
    if (savedColumnsResult?.success && Array.isArray(savedColumnsResult.columns)) {
      setDiscoveredColumns(savedColumnsResult.columns);
    }
  }, [savedColumnsResult]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      const { type, ...cfg } = values;
      return upsertEventSourceConfig(orgId, {
        type,
        config: normalizeEventSourceConfig(type, cfg),
      });
    },
    onSuccess: (_, variables) => {
      messageApi.success('Event source configuration saved');
      queryClient.invalidateQueries({ queryKey: ['eventSourceConfig', orgId] });
      activityTracker.track({
        event: ACTIVITY_EVENTS.SETTINGS_UPDATED,
        action: 'event-source-config-saved',
        metadata: { type: variables.type, orgId },
      });
    },
    onError: (err: any) => {
      messageApi.error(err?.message || 'Failed to save configuration');
    },
  });

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      saveMutation.mutate(values);
    } catch {
      // Ant Design already highlights the failing fields
    }
  };

  // Test connection
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    activityTracker.track({
      event: ACTIVITY_EVENTS.BUTTON_CLICKED,
      action: 'event-source-test-clicked',
      metadata: { orgId },
    });

    try {
      const values = form.getFieldsValue();
      const { type, ...cfg } = values;
      const selectedType = type ?? sourceType;
      const result = await testEventSourceConnection(selectedType, normalizeEventSourceConfig(selectedType, cfg));
      setTestResult(result);
      // If MySQL test succeeded, populate column discovery from the result
      if (result.success && result.columnMeta && result.columnMeta.length > 0) {
        setDiscoveredColumns(result.columnMeta);
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err?.message, code: 'REQUEST_FAILED' });
    } finally {
      setTesting(false);
    }
  };

  // Discover columns (runs test without columnMapping to get schema only)
  const handleDiscoverColumns = async () => {
    setDiscovering(true);
    activityTracker.track({
      event: ACTIVITY_EVENTS.BUTTON_CLICKED,
      action: 'event-source-discover-columns',
      metadata: { orgId },
    });

    try {
      const values = form.getFieldsValue();
      // Omit columnMapping so the test just probes the connection + table
      const { type: _t, columnMapping: _cm, ...cfg } = values;
      const result = await testEventSourceConnection('mysql', cfg);
      if (result.success && result.columnMeta) {
        setDiscoveredColumns(result.columnMeta);
        messageApi.success(`Discovered ${result.columnMeta.length} columns from "${cfg.table}"`);
      } else {
        messageApi.error(result.hint ?? result.error ?? 'Could not connect to discover columns');
      }
    } catch (err: any) {
      messageApi.error('Failed to reach the database');
    } finally {
      setDiscovering(false);
    }
  };

  // Delete / remove config
  const handleDelete = () => {
    modal.confirm({
      title: 'Remove event source configuration?',
      content: 'The adapter for this org will be stopped. You can reconfigure it at any time.',
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteEventSourceConfig(orgId);
          messageApi.success('Event source configuration removed');
          queryClient.invalidateQueries({ queryKey: ['eventSourceConfig', orgId] });
          form.resetFields();
          form.setFieldsValue({ type: 'none' });
          setTestResult(null);
          setDiscoveredColumns([]);
          activityTracker.track({
            event: ACTIVITY_EVENTS.SETTINGS_UPDATED,
            action: 'event-source-config-deleted',
            metadata: { orgId },
          });
        } catch (err: any) {
          messageApi.error(err?.message || 'Failed to remove configuration');
        }
      },
    });
  };

  if (isLoading) {
    return (
      <PageTemplate
        as="main"
        title="Event Source"
        breadcrumb={[{ label: 'Settings', path: '/settings' }, { label: 'Event Source' }]}
        compact
      >
        <StatePanel glyph="connecting" tone="busy" size="compact" title="Loading event source settings" />
      </PageTemplate>
    );
  }

  const statusBadge = currentConfig?.isActive ? (
    <StatusBadge status="SUCCESS" label="Active" variant="success" size="small" />
  ) : (
    <StatusBadge label="Not configured" variant="neutral" size="small" />
  );

  const sourceTypeLabel: Record<string, string> = {
    mysql: 'MySQL Polling',
    kafka: 'Kafka Consumer',
    http_push: 'HTTP Push',
    hl7_mllp: 'HL7 MLLP Listener',
  };

  return (
    <PermissionGuard
      feature="event_source"
      operation="read"
      fallback={
        <PageTemplate
          as="main"
          title="Event Source"
          description="Configure how this organisation's events are ingested."
          breadcrumb={[{ label: 'Settings', path: '/settings' }, { label: 'Event Source' }]}
          compact
        >
          <StatePanel
            glyph="searching"
            tone="neutral"
            title="Event source settings are restricted"
            description="Your role does not have permission to view event source settings. Ask an organization administrator to update your role."
          />
        </PageTemplate>
      }
    >
      <PageTemplate
        as="main"
        className="event-source-settings-template"
        contentClassName="event-source-settings-template__content"
        header={
          <PageHeader
            title="Event Source"
            description="Configure how this organisation's events are ingested — MySQL polling, Kafka consumer, HTTP Push, or HL7 MLLP."
            breadcrumb={[{ label: 'Settings', path: '/settings' }, { label: 'Event Source' }]}
            compact
            actions={statusBadge}
          />
        }
      >
        {/* Current status card */}
        {currentConfig && (
          <Card size="small" className="console-margin-bottom-3">
            <Space split={<Divider type="vertical" />} wrap>
              <Space size={4}>
                <Text type="secondary">Type:</Text>
                <Text strong>{sourceTypeLabel[currentConfig.type] ?? currentConfig.type}</Text>
              </Space>
              {currentConfig.config?.table && (
                <Space size={4}>
                  <Text type="secondary">Table:</Text>
                  <Text code>{currentConfig.config.table}</Text>
                </Space>
              )}
              {currentConfig.updatedAt && (
                <Space size={4}>
                  <Text type="secondary">Last updated:</Text>
                  <Text>{new Date(currentConfig.updatedAt).toLocaleString()}</Text>
                </Space>
              )}
            </Space>
          </Card>
        )}

        {loadError && (
          <Banner
            status="warning"
            title="Could not load existing configuration"
            description={(loadError as any)?.message}
            className="console-margin-bottom-3"
          />
        )}

        {/* Configuration form */}
        <Card
          title={
            <Space>
              <GatewayIcon name="DatabaseOutlined" />
              Configure Event Source
            </Space>
          }
        >
          <Form form={form} layout="vertical" size="middle">
            {/* Source type selector */}
            <Form.Item name="type" label="Source Type" rules={[{ required: true }]} className="ui-extracted-140b17fdb3">
              <Select
                options={[
                  { value: 'none', label: 'None (no event source)' },
                  { value: 'mysql', label: 'MySQL Polling' },
                  { value: 'kafka', label: 'Kafka Consumer' },
                  { value: 'http_push', label: 'HTTP Push (inbound webhook)' },
                  { value: 'hl7_mllp', label: 'HL7 MLLP Listener' },
                ]}
                onChange={() => {
                  setTestResult(null);
                  setDiscoveredColumns([]);
                }}
              />
            </Form.Item>

            {sourceType !== 'none' && (
              <>
                <Divider style={{ margin: `${spacing[2]} 0 ${spacing[3]}` }} />

                {/* Source-specific fields */}
                {sourceType === 'mysql' && (
                  <MysqlFields
                    useSharedPool={useSharedPool}
                    discoveredColumns={discoveredColumns}
                    discovering={discovering}
                    onDiscover={handleDiscoverColumns}
                    orgId={orgId}
                    eventTypeOptions={eventTypeOptions}
                  />
                )}
                {sourceType === 'kafka' && <KafkaFields />}
                {sourceType === 'http_push' && <HttpPushFields />}
                {sourceType === 'hl7_mllp' && <Hl7MllpFields />}
              </>
            )}

            {sourceType === 'none' && (
              <InlineHint>
                No event source configured. Events will not be ingested automatically — select a source type above to
                configure one.
              </InlineHint>
            )}

            <Divider />

            {/* Action buttons */}
            <Space wrap>
              {sourceType !== 'none' && (
                <Tooltip
                  title={
                    TEST_CONNECTION_TOOLTIPS[sourceType] ?? 'Validates this source configuration. Nothing is saved.'
                  }
                >
                  <Button icon={<GatewayIcon name="WifiOutlined" />} onClick={handleTest} loading={testing}>
                    Test Connection
                  </Button>
                </Tooltip>
              )}

              {sourceType !== 'none' && (
                <PermissionGuard feature="event_source" operation="write">
                  <Button
                    type="primary"
                    icon={<GatewayIcon name="SaveOutlined" />}
                    onClick={handleSave}
                    loading={saveMutation.isPending}
                  >
                    Save Configuration
                  </Button>
                </PermissionGuard>
              )}

              {currentConfig && (
                <PermissionGuard feature="event_source" operation="delete">
                  <Button danger icon={<GatewayIcon name="DeleteOutlined" />} onClick={handleDelete}>
                    Remove Configuration
                  </Button>
                </PermissionGuard>
              )}

              <Button
                icon={<GatewayIcon name="ReloadOutlined" />}
                onClick={() => queryClient.invalidateQueries({ queryKey: ['eventSourceConfig', orgId] })}
                type="text"
              >
                Reload
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
    </PermissionGuard>
  );
};
