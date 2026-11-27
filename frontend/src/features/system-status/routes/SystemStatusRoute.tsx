import { useEffect, useMemo, useState } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import { Card, Col, Descriptions, List, Row, Space, Statistic, Switch } from "@/components/common/LegacyAntdControls";
import { Banner } from '@astryxdesign/core/Banner';
import { Tab, TabList } from '@astryxdesign/core';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { Row as ItemRow, RowList } from '../../../design-system/primitives';
import { RefreshCountdown } from '../../../components/common/RefreshCountdown';
import { StatusBadge, type StatusBadgeVariant } from '../../../components/common/StatusBadge';
import { PortalScopeBadge } from '../../../components/portal/PortalScopeBadge';
import { useAuth } from '../../../app/auth-context';
import { useTenant } from '../../../app/tenant-context';
import { useDesignTokens } from '../../../design-system/utils';
import {
  getSystemStatus,
  type SystemStatusAdapter,
  type SystemStatusOrganizationRow,
  type SystemStatusResponse,
  type SystemStatusWorker,
} from '../../../services/api';
import {
  formatAgeLabel,
  formatBytes,
  formatDateTime,
  formatDuration,
  formatPercentage,
  getAdapterStatusPresentation,
  getEventSourceConfigurationPresentation,
  getOverallStatusPresentation,
  getProcessLifecyclePresentation,
  getWorkerStatusPresentation,
} from '../system-status-utils';
import { useSearchParams } from 'react-router-dom';
import { ModernTable } from '../../../components/common/ModernTable';
import { StatePanel } from '../../../components/common/StatePanel';
import { Button } from '../../../components/common/LegacyButton';

const { Text, Paragraph } = Typography;

const TAB_KEYS = ['overview', 'workers', 'event-sources', 'runtime', 'traffic', 'alerts'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const AUTO_REFRESH_INTERVAL_MS = 30000;

function statusTag(label: string, color: string) {
  const variants: Record<string, StatusBadgeVariant> = {
    default: 'neutral',
    blue: 'blue',
    green: 'green',
    orange: 'orange',
    red: 'red',
    warning: 'warning',
  };
  return <StatusBadge label={label} variant={variants[color] || 'neutral'} showIcon={false} />;
}

function DataAgeLabel({ timestamp }: { timestamp?: string | null }) {
  return <Text type="secondary">{formatAgeLabel(timestamp)}</Text>;
}

function humanizeKey(value?: string | null) {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function KeyValueTable({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  // Key/value pairs are divided rows inside the panel, not a bordered table
  // nested in a card.
  return (
    <RowList>
      {rows.map((row) => (
        <ItemRow
          key={row.label}
          title={row.label}
          actions={<span className="system-status-kv-value">{row.value}</span>}
        />
      ))}
    </RowList>
  );
}

function WorkerTable({ workers }: { workers: SystemStatusWorker[] }) {
  return (
    <ModernTable
      size="small"
      rowKey={(worker) => worker.workerName}
      pagination={false}
      dataSource={workers}
      columns={[
        {
          title: 'Worker',
          key: 'worker',
          render: (_, worker) => (
            <Space direction="vertical" size={0}>
              <Text strong>{worker.displayName}</Text>
              <Text type="secondary" className="console-type-caption">
                {worker.workerName}
              </Text>
            </Space>
          ),
        },
        {
          title: 'Status',
          key: 'status',
          render: (_, worker) => {
            const presentation = getWorkerStatusPresentation(worker);
            return statusTag(presentation.label, presentation.color === 'orange' ? 'warning' : presentation.color);
          },
        },
        {
          title: 'Heartbeat',
          key: 'heartbeat',
          render: (_, worker) => <DataAgeLabel timestamp={worker.lastHeartbeat} />,
        },
        {
          title: 'Last Success',
          key: 'success',
          render: (_, worker) => <DataAgeLabel timestamp={worker.lastSuccessAt} />,
        },
        {
          title: 'Last Error',
          key: 'error',
          render: (_, worker) => worker.lastErrorMessage || '—',
        },
        {
          title: 'Metadata',
          key: 'meta',
          render: (_, worker) => {
            const entries = Object.entries(worker.meta || {});
            if (!entries.length) return '—';
            return (
              <Text type="secondary">
                {entries
                  .slice(0, 4)
                  .map(([key, value]) => `${humanizeKey(key)}: ${String(value)}`)
                  .join(' · ')}
              </Text>
            );
          },
        },
      ]}
    />
  );
}

function EventSourceTable({ adapters }: { adapters: SystemStatusAdapter[] }) {
  const showOrgColumn = adapters.some((adapter) => Number.isFinite(Number(adapter.orgId)));
  return (
    <ModernTable
      size="small"
      rowKey={(adapter) => `${adapter.orgId}-${adapter.sourceType}-${adapter.name}`}
      pagination={false}
      dataSource={adapters}
      columns={[
        ...(showOrgColumn
          ? [
              {
                title: 'Org',
                dataIndex: 'orgId',
                key: 'orgId',
                render: (value: number) => value || '—',
              },
            ]
          : []),
        {
          title: 'Source',
          key: 'source',
          render: (_, adapter) => (
            <Space direction="vertical" size={0}>
              <Text strong>{adapter.sourceType?.toUpperCase() || 'Unknown'}</Text>
              <Text type="secondary" className="console-type-caption">
                {adapter.name}
              </Text>
            </Space>
          ),
        },
        {
          title: 'Connection',
          key: 'status',
          render: (_, adapter) => {
            const presentation = getAdapterStatusPresentation(adapter);
            return statusTag(presentation.label, presentation.color === 'orange' ? 'warning' : presentation.color);
          },
        },
        {
          title: 'Last Activity',
          key: 'activity',
          render: (_, adapter) => (
            <DataAgeLabel
              timestamp={
                adapter.lastMessageAt || adapter.lastSuccessAt || adapter.lastPollFinishedAt || adapter.lastConnectAt
              }
            />
          ),
        },
        {
          title: 'Probe / Runtime',
          key: 'probe',
          render: (_, adapter) => {
            if (adapter.connectionProbe?.ok) {
              return `Probe OK${adapter.connectionProbe.responseTimeMs ? ` (${adapter.connectionProbe.responseTimeMs} ms)` : ''}`;
            }
            if (adapter.connectionProbe?.error) return adapter.connectionProbe.error;
            if (adapter.lastReconnectReason) return adapter.lastReconnectReason;
            if (adapter.note) return adapter.note;
            return '—';
          },
        },
        {
          title: 'Details',
          key: 'details',
          render: (_, adapter) => {
            const details: string[] = [];
            if (adapter.topic) details.push(`Topic: ${adapter.topic}`);
            if (adapter.groupId) details.push(`Group: ${adapter.groupId}`);
            if (adapter.table) details.push(`Table: ${adapter.table}`);
            if (adapter.reconnectAttempt) details.push(`Retries: ${adapter.reconnectAttempt}`);
            if (adapter.lastBackoffMs) details.push(`Backoff: ${adapter.lastBackoffMs} ms`);
            if (adapter.lastRowsFetched !== undefined) details.push(`Rows: ${adapter.lastRowsFetched}`);
            if (adapter.lastCheckpoint !== null && adapter.lastCheckpoint !== undefined)
              details.push(`Checkpoint: ${String(adapter.lastCheckpoint)}`);
            return details.length ? <Text type="secondary">{details.join(' · ')}</Text> : '—';
          },
        },
      ]}
    />
  );
}

function OrganizationStatusTable({ organizations }: { organizations: SystemStatusOrganizationRow[] }) {
  return (
    <ModernTable<SystemStatusOrganizationRow>
      size="small"
      rowKey={(row) => row.orgId}
      pagination={false}
      dataSource={organizations}
      columns={[
        {
          title: 'Organization',
          key: 'org',
          render: (_, row) => (
            <Space direction="vertical" size={0}>
              <Text strong>{row.name || `Org ${row.orgId}`}</Text>
              <Text type="secondary" className="console-type-caption">
                {row.code || `Org ${row.orgId}`}
              </Text>
            </Space>
          ),
        },
        {
          title: 'Status',
          key: 'status',
          render: (_, row) => {
            const presentation = getOverallStatusPresentation(row.status);
            return statusTag(presentation.label, presentation.color === 'orange' ? 'warning' : presentation.color);
          },
        },
        {
          title: 'Deliveries (24h)',
          dataIndex: ['summary', 'deliveries24h'],
          key: 'deliveries24h',
        },
        {
          title: 'Success Rate',
          key: 'successRate24h',
          render: (_, row) => formatPercentage(row.summary?.successRate24h),
        },
        {
          title: 'P95',
          key: 'p95ResponseTimeMs',
          render: (_, row) => formatDuration(row.summary?.p95ResponseTimeMs),
        },
        {
          title: 'Event Source',
          key: 'eventSources',
          render: (_, row) => {
            if (!row.eventSources?.configured) {
              return <Text type="secondary">Not configured</Text>;
            }
            const adapterLabel = row.eventSources?.adapterStatus || row.eventSources?.state || 'configured';
            return statusTag(
              String(adapterLabel).replace(/_/g, ' '),
              adapterLabel === 'connected' ? 'green' : 'warning'
            );
          },
        },
      ]}
    />
  );
}

function SenderProfilesTable({ items }: { items: SystemStatusResponse['senderProfiles']['items'] }) {
  return (
    <ModernTable
      size="small"
      rowKey={(row) => row.id}
      pagination={false}
      dataSource={items}
      columns={[
        {
          title: 'Sender',
          key: 'sender',
          render: (_, row) => (
            <Space direction="vertical" size={0}>
              <Text strong>{row.name}</Text>
              <Text type="secondary" className="console-type-caption">
                {row.fromEmail || '—'}
              </Text>
            </Space>
          ),
        },
        {
          title: 'Provider',
          dataIndex: 'provider',
          key: 'provider',
          render: (value: string) => value || 'Unknown',
        },
        {
          title: 'Flags',
          key: 'flags',
          render: (_, row) => (
            <Space size={[4, 4]} wrap>
              {row.isDefault && <Text type="secondary">Default</Text>}
              {!row.isActive && statusTag('Inactive', 'red')}
              {row.key && <Text code>{row.key}</Text>}
            </Space>
          ),
        },
        {
          title: 'Aliases',
          key: 'aliases',
          render: (_, row) => (row.aliases?.length ? <Text type="secondary">{row.aliases.join(' · ')}</Text> : '—'),
        },
      ]}
    />
  );
}

function AlertsList({ data }: { data: SystemStatusResponse }) {
  const alertItems = data.alerts || [];
  const checkEntries = Object.entries(data.checks || {});

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card title="Alerts" size="small">
          {alertItems.length === 0 ? (
            <StatePanel size="compact" glyph="searching" title="No active alerts" />
          ) : (
            <List
              dataSource={alertItems}
              renderItem={(alert) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        {statusTag(
                          String(alert.severity || 'unknown'),
                          alert.severity === 'critical'
                            ? 'red'
                            : alert.severity === 'warning'
                              ? 'warning'
                              : alert.severity === 'info'
                                ? 'blue'
                                : 'default'
                        )}
                        <Text strong>{alert.type}</Text>
                      </Space>
                    }
                    description={alert.message}
                  />
                </List.Item>
              )}
            />
          )}
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="Checks" size="small">
          {checkEntries.length === 0 ? (
            <StatePanel size="compact" glyph="searching" title="No check data" />
          ) : (
            <List
              dataSource={checkEntries}
              renderItem={([key, value]) => (
                <List.Item>
                  <Space className="console-width-full-between">
                    <Text>{key}</Text>
                    {statusTag(
                      String(value),
                      value === 'warning'
                        ? 'warning'
                        : value === 'healthy'
                          ? 'green'
                          : value === 'error'
                            ? 'red'
                            : 'default'
                    )}
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      </Col>
    </Row>
  );
}

function getOverallHealthFactors(data?: SystemStatusResponse | null) {
  if (!data) return [];

  const factors: Array<{ key: string; severity: 'critical' | 'warning' | 'info'; label: string; detail: string }> = [];
  const pushFactor = (key: string, severity: 'critical' | 'warning' | 'info', label: string, detail: string) => {
    if (!factors.some((factor) => factor.key === key)) {
      factors.push({ key, severity, label, detail });
    }
  };

  const criticalAlerts = (data.alerts || []).filter((alert) => String(alert.severity).toLowerCase() === 'critical');
  const warningAlerts = (data.alerts || []).filter((alert) => String(alert.severity).toLowerCase() === 'warning');
  if (criticalAlerts.length > 0) {
    pushFactor(
      'critical-alerts',
      'critical',
      'Critical alerts active',
      `${criticalAlerts.length} critical alert${criticalAlerts.length === 1 ? '' : 's'} currently active.`
    );
  }
  if (warningAlerts.length > 0) {
    pushFactor(
      'warning-alerts',
      'warning',
      'Warning alerts active',
      `${warningAlerts.length} warning alert${warningAlerts.length === 1 ? '' : 's'} currently active.`
    );
  }

  Object.entries(data.checks || {}).forEach(([key, value]) => {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'critical' || normalized === 'error') {
      pushFactor(
        `check-${key}`,
        'critical',
        `${humanizeKey(key)} check failing`,
        `The ${humanizeKey(key).toLowerCase()} check is reporting ${normalized}.`
      );
    } else if (normalized === 'warning' || normalized === 'degraded') {
      pushFactor(
        `check-${key}`,
        'warning',
        `${humanizeKey(key)} check degraded`,
        `The ${humanizeKey(key).toLowerCase()} check is reporting ${normalized}.`
      );
    }
  });

  if (data.scope === 'global') {
    const criticalOrgs = Number(data.globalSummary?.organizationStatusCounts?.critical || 0);
    const warningOrgs = Number(data.globalSummary?.organizationStatusCounts?.warning || 0);
    if (criticalOrgs > 0) {
      pushFactor(
        'critical-orgs',
        'critical',
        'Critical organizations present',
        `${criticalOrgs} organization${criticalOrgs === 1 ? '' : 's'} currently report critical status.`
      );
    }
    if (warningOrgs > 0) {
      pushFactor(
        'warning-orgs',
        'warning',
        'Degraded organizations present',
        `${warningOrgs} organization${warningOrgs === 1 ? '' : 's'} currently report degraded or warning status.`
      );
    }
  }

  const workerSummary = data.workers?.summary;
  if (Number(workerSummary?.stopped || 0) > 0) {
    pushFactor(
      'stopped-workers',
      'critical',
      'Stopped workers detected',
      `${workerSummary?.stopped} background worker${workerSummary?.stopped === 1 ? '' : 's'} are stopped.`
    );
  }
  if (Number(workerSummary?.stale || 0) > 0) {
    pushFactor(
      'stale-workers',
      'warning',
      'Stale workers detected',
      `${workerSummary?.stale} background worker${workerSummary?.stale === 1 ? '' : 's'} are stale.`
    );
  }

  if (data.logs?.app?.status === 'error' || data.logs?.access?.status === 'error') {
    pushFactor(
      'log-errors',
      'critical',
      'Runtime log collection failing',
      'One or more runtime log files are reporting an error state.'
    );
  } else if (data.logs?.app?.status === 'stale' || data.logs?.access?.status === 'stale') {
    pushFactor('log-stale', 'warning', 'Runtime logs are stale', 'Recent log files are not being updated as expected.');
  }

  if (data.scope !== 'global') {
    if (Number(data.overall?.summary?.failed24h || 0) > 0) {
      pushFactor(
        'failed-deliveries',
        'warning',
        'Recent delivery failures present',
        `${data.overall.summary.failed24h} failed deliver${data.overall.summary.failed24h === 1 ? 'y' : 'ies'} in the last 24 hours.`
      );
    }
    if (Number(data.overall?.summary?.pendingCount || 0) > 0) {
      pushFactor(
        'pending-deliveries',
        'warning',
        'Pending deliveries queued',
        `${data.overall.summary.pendingCount} pending deliver${data.overall.summary.pendingCount === 1 ? 'y remains' : 'ies remain'} in backlog.`
      );
    }
    if (String(data.eventSources?.configuration?.state || '').toLowerCase() === 'error') {
      pushFactor(
        'event-source-config',
        'critical',
        'Event source configuration error',
        'The configured event source is in an error state.'
      );
    }
  }

  if (data.processLifecycle?.abruptRestart?.detected) {
    pushFactor(
      'abrupt-restart',
      'warning',
      'Abrupt previous restart detected',
      'The previous process ended without a clean shutdown record.'
    );
  }

  return factors.slice(0, 6);
}

export function SystemStatusRoute({ mode = 'admin' }: { mode?: 'admin' | 'standalone' }) {
  const { spacing } = useDesignTokens();
  const { user } = useAuth();
  const { orgId, tenant } = useTenant();
  const isStandalone = mode === 'standalone';
  const isPortalSession = !!(user as any)?.isPortalSession;
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const activeTab = (searchParams.get('tab') || 'overview') as TabKey;
  const selectedTab = TAB_KEYS.includes(activeTab) ? activeTab : 'overview';
  const [visitedTabs, setVisitedTabs] = useState(() => new Set<TabKey>([selectedTab]));
  const allowedViews = useMemo(() => {
    try {
      const stored = localStorage.getItem('integration_gateway_user');
      return stored ? (JSON.parse(stored)?.allowedViews ?? []) : [];
    } catch {
      return [] as string[];
    }
  }, []);
  const canViewPortalStatus = !isPortalSession || allowedViews.length === 0 || allowedViews.includes('system_status');

  const effectiveOrgId = orgId > 0 ? orgId : Number(searchParams.get('orgId') || 0);
  const isGlobalAdminMode = !isStandalone && !isPortalSession && effectiveOrgId <= 0;

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['systemStatus', isGlobalAdminMode ? 'global' : effectiveOrgId],
    queryFn: () => getSystemStatus(isGlobalAdminMode ? null : effectiveOrgId),
    enabled: canViewPortalStatus && (effectiveOrgId > 0 || isGlobalAdminMode),
    staleTime: 20000,
    refetchInterval: autoRefresh ? AUTO_REFRESH_INTERVAL_MS : false,
  });

  // The countdown lives in <RefreshCountdown>, a leaf that re-renders itself
  // once a second rather than re-rendering this route and everything on it.

  const handleManualRefresh = async () => {
    setManualRefreshPending(true);
    try {
      await refetch();
    } finally {
      setManualRefreshPending(false);
    }
  };

  const setTab = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    setVisitedTabs((current) => new Set(current).add(selectedTab));
  }, [selectedTab]);

  const lastUpdatedAge = dataUpdatedAt ? Math.floor((Date.now() - dataUpdatedAt) / 1000) : null;
  const dataStale = !!(autoRefresh && dataUpdatedAt && Date.now() - dataUpdatedAt > AUTO_REFRESH_INTERVAL_MS * 2);

  const overallStatus = useMemo(() => getOverallStatusPresentation(data?.overall?.status), [data?.overall?.status]);
  const lifecycleStatus = useMemo(
    () => getProcessLifecyclePresentation(data?.processLifecycle?.current),
    [data?.processLifecycle?.current]
  );
  const workerSummary = data?.workers?.summary;
  const configurationPresentation = useMemo(
    () => getEventSourceConfigurationPresentation(data?.eventSources?.configuration),
    [data?.eventSources?.configuration]
  );
  const isGlobalScope = data?.scope === 'global';
  const organizations = data?.organizations || [];
  const viewingLabel = isGlobalScope
    ? 'Viewing: All Organizations'
    : effectiveOrgId > 0
      ? `Viewing: ${tenant?.tenantName || `Org ${effectiveOrgId}`}`
      : 'Viewing: Scope Unknown';
  const overallHealthFactors = useMemo(() => getOverallHealthFactors(data), [data]);

  const directionMix = data?.traffic?.directionMixLast60m || {};
  const backlogRows = [
    {
      label: 'Pending Deliveries',
      value: Object.values(data?.backlogs?.pendingDeliveries || {}).reduce((sum, count) => sum + count, 0),
    },
    { label: 'DLQ', value: Object.values(data?.backlogs?.dlq || {}).reduce((sum, count) => sum + count, 0) },
    {
      label: 'Scheduled Integrations',
      value: Object.values(data?.backlogs?.scheduledIntegrations || {}).reduce((sum, count) => sum + count, 0),
    },
  ];

  if (isPortalSession && !canViewPortalStatus) {
    return (
      <div style={{ padding: spacing[6] }}>
        <StatePanel
          size="regular"
          title="System Status is unavailable"
          description="Ask your administrator to add the System Status view to this portal profile."
        />
      </div>
    );
  }

  const tabItems = [
    {
      key: 'overview',
      label: 'Overview',
      children: (
        <Space direction="vertical" size={16} className="console-width-full">
          {overallHealthFactors.length > 0 && (
            <Card size="small" title="Health Drivers">
              <List
                size="small"
                dataSource={overallHealthFactors}
                renderItem={(factor) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          {statusTag(
                            factor.severity === 'critical'
                              ? 'Critical'
                              : factor.severity === 'warning'
                                ? 'Warning'
                                : 'Info',
                            factor.severity === 'critical' ? 'red' : factor.severity === 'warning' ? 'warning' : 'blue'
                          )}
                          <Text strong>{factor.label}</Text>
                        </Space>
                      }
                      description={factor.detail}
                    />
                  </List.Item>
                )}
              />
            </Card>
          )}

          <Row gutter={[16, 16]}>
            <Col xs={12} sm={12} xl={6}>
              <Card size="small">
                <Statistic
                  title="Overall Health"
                  value={overallStatus.label}
                  prefix={
                    overallStatus.color === 'green' ? (
                      <GatewayIcon name="CheckCircleOutlined" />
                    ) : overallStatus.color === 'red' ? (
                      <GatewayIcon name="ExclamationCircleOutlined" />
                    ) : (
                      <GatewayIcon name="WarningOutlined" />
                    )
                  }
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} xl={6}>
              <Card size="small">
                <Statistic
                  title="Process State"
                  value={lifecycleStatus.label}
                  prefix={
                    lifecycleStatus.color === 'green' ? (
                      <GatewayIcon name="CheckCircleOutlined" />
                    ) : lifecycleStatus.color === 'orange' ? (
                      <GatewayIcon name="WarningOutlined" />
                    ) : (
                      <GatewayIcon name="ClockCircleOutlined" />
                    )
                  }
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} xl={6}>
              <Card size="small">
                <Statistic title="Alerts" value={data?.overall?.alertCount?.total ?? 0} />
              </Card>
            </Col>
            <Col xs={12} sm={12} xl={6}>
              <Card size="small">
                <Statistic
                  title={isGlobalScope ? 'Organizations' : 'Deliveries (24h)'}
                  value={
                    isGlobalScope
                      ? (data?.globalSummary?.organizationCount ?? 0)
                      : (data?.overall?.summary?.deliveries24h ?? 0)
                  }
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={8}>
              <Card size="small" title="Traffic Windows">
                <KeyValueTable
                  rows={[
                    { label: 'Deliveries · 5m', value: data?.traffic?.deliveries?.last5m ?? 0 },
                    { label: 'Deliveries · 15m', value: data?.traffic?.deliveries?.last15m ?? 0 },
                    { label: 'Deliveries · 60m', value: data?.traffic?.deliveries?.last60m ?? 0 },
                    ...(!isGlobalScope
                      ? [
                          {
                            label: 'Success Rate · 24h',
                            value: formatPercentage(data?.overall?.summary?.successRate24h),
                          },
                          { label: 'P95 Response', value: formatDuration(data?.overall?.summary?.p95ResponseTimeMs) },
                        ]
                      : []),
                    { label: 'Inbound Events · 60m', value: data?.traffic?.inboundEvents?.last60m ?? 0 },
                    { label: 'Inbound Events · 24h', value: data?.traffic?.inboundEvents?.last24h ?? 0 },
                    { label: 'Uptime', value: data?.process?.uptime?.formatted || '—' },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card size="small" title="Backlog Snapshot">
                <KeyValueTable rows={backlogRows.map((row) => ({ label: row.label, value: row.value }))} />
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card size="small" title="Log Freshness">
                <KeyValueTable
                  rows={[
                    {
                      label: 'App Log',
                      value: `${data?.logs?.app?.status || 'unknown'} · ${formatAgeLabel(data?.logs?.app?.modifiedAt)}`,
                    },
                    {
                      label: 'Access Log',
                      value: `${data?.logs?.access?.status || 'unknown'} · ${formatAgeLabel(data?.logs?.access?.modifiedAt)}`,
                    },
                    {
                      label: 'Abrupt Restart',
                      value: data?.processLifecycle?.abruptRestart?.detected
                        ? `Yes · ${formatAgeLabel(data?.processLifecycle?.abruptRestart?.detectedAt)}`
                        : 'No',
                    },
                    {
                      label: isGlobalScope ? 'Configured Event Sources' : 'Event Source Config',
                      value: isGlobalScope
                        ? `${data?.globalSummary?.eventSourceConfiguredCount ?? 0}/${data?.globalSummary?.organizationCount ?? 0}`
                        : configurationPresentation.label,
                    },
                    {
                      label: 'Workers Healthy',
                      value: workerSummary ? `${workerSummary.healthy}/${workerSummary.total}` : '—',
                    },
                    {
                      label: 'Sender Profiles',
                      value: isGlobalScope
                        ? `${data?.senderProfiles?.summary?.total ?? 0} across ${data?.senderProfiles?.summary?.organizationCount ?? 0} orgs`
                        : `${data?.senderProfiles?.summary?.active ?? 0}/${data?.senderProfiles?.summary?.total ?? 0} active`,
                    },
                  ]}
                />
              </Card>
            </Col>
          </Row>

          {isGlobalScope && (
            <Card size="small" title="Organization Health">
              <KeyValueTable
                rows={[
                  {
                    label: 'Critical organizations',
                    value: data?.globalSummary?.organizationStatusCounts?.critical ?? 0,
                  },
                  {
                    label: 'Warning organizations',
                    value: data?.globalSummary?.organizationStatusCounts?.warning ?? 0,
                  },
                ]}
              />
              <OrganizationStatusTable organizations={organizations} />
            </Card>
          )}
        </Space>
      ),
    },
    {
      key: 'workers',
      label: 'Workers',
      children: <WorkerTable workers={data?.workers?.items || []} />,
    },
    {
      key: 'event-sources',
      label: 'Event Sources',
      children: (
        <Space direction="vertical" size={16} className="console-width-full">
          <Card size="small" title="Configuration">
            <KeyValueTable
              rows={
                isGlobalScope
                  ? [
                      { label: 'View', value: 'Global' },
                      { label: 'Configured Orgs', value: data?.globalSummary?.eventSourceConfiguredCount ?? 0 },
                      { label: 'Not Configured Orgs', value: data?.globalSummary?.eventSourceNotConfiguredCount ?? 0 },
                      { label: 'Running Adapters', value: data?.eventSources?.manager?.adapterCount ?? 0 },
                      { label: 'Manager Sync Error', value: data?.eventSources?.manager?.lastSyncErrorMessage || '—' },
                      {
                        label: 'Sender Profiles',
                        value: `${data?.senderProfiles?.summary?.total ?? 0} across ${data?.senderProfiles?.summary?.organizationCount ?? 0} orgs`,
                      },
                    ]
                  : [
                      { label: 'State', value: configurationPresentation.label },
                      { label: 'Configured', value: data?.eventSources?.configuration?.configured ? 'Yes' : 'No' },
                      { label: 'Source Type', value: data?.eventSources?.configuration?.sourceType || '—' },
                      { label: 'Config Origin', value: data?.eventSources?.configuration?.configOrigin || '—' },
                      {
                        label: 'Configuration Error',
                        value: data?.eventSources?.configuration?.error?.errorMessage || '—',
                      },
                      { label: 'Sender Profiles', value: data?.senderProfiles?.summary?.total ?? 0 },
                      { label: 'Default Sender', value: data?.senderProfiles?.defaultProfile?.fromEmail || '—' },
                    ]
              }
            />
          </Card>
          <Card size="small" title="Sender Profiles">
            {isGlobalScope ? (
              <KeyValueTable
                rows={[
                  { label: 'Total Profiles', value: data?.senderProfiles?.summary?.total ?? 0 },
                  { label: 'Active Profiles', value: data?.senderProfiles?.summary?.active ?? 0 },
                  { label: 'Inactive Profiles', value: data?.senderProfiles?.summary?.inactive ?? 0 },
                  { label: 'Default Profiles', value: data?.senderProfiles?.summary?.defaultCount ?? 0 },
                  {
                    label: 'Organizations Using Profiles',
                    value: data?.senderProfiles?.summary?.organizationCount ?? 0,
                  },
                  {
                    label: 'Providers',
                    value: Object.keys(data?.senderProfiles?.summary?.providers || {}).length
                      ? Object.entries(data?.senderProfiles?.summary?.providers || {})
                          .map(([provider, count]) => `${provider}: ${count}`)
                          .join(' · ')
                      : '—',
                  },
                ]}
              />
            ) : (data?.senderProfiles?.items?.length || 0) > 0 ? (
              <SenderProfilesTable items={data?.senderProfiles?.items || []} />
            ) : (
              <StatePanel size="compact" glyph="searching" title="No sender profiles" />
            )}
          </Card>
          {!isGlobalScope &&
          (data?.eventSources?.configuration?.state === 'not_configured' ||
            (data?.eventSources?.orgAdapters?.length || 0) === 0) ? (
            <Text type="secondary">
              No event source is configured for this organization. This is different from a failed adapter.
            </Text>
          ) : (
            <EventSourceTable adapters={data?.eventSources?.orgAdapters || []} />
          )}
        </Space>
      ),
    },
    {
      key: 'runtime',
      label: 'Runtime',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card size="small" title="Application Runtime">
              <KeyValueTable
                rows={[
                  { label: 'Version', value: data?.process?.appVersion || '—' },
                  { label: 'Node', value: data?.process?.nodeVersion || '—' },
                  { label: 'Environment', value: data?.process?.environment || '—' },
                  { label: 'PID', value: data?.process?.pid ?? '—' },
                  { label: 'Started', value: formatDateTime(data?.process?.startedAt) },
                  { label: 'Lifecycle Status', value: lifecycleStatus.label },
                  { label: 'Lifecycle Updated', value: formatDateTime(data?.processLifecycle?.current?.updatedAt) },
                  { label: 'Drain Reason', value: data?.processLifecycle?.current?.reason || '—' },
                  { label: 'MySQL', value: data?.process?.mysql?.status || '—' },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="Memory & Host">
              <KeyValueTable
                rows={[
                  {
                    label: 'Node Heap Used',
                    value:
                      data?.process?.memory?.stats?.nodeHeapUsedMB !== undefined
                        ? `${data.process.memory.stats.nodeHeapUsedMB} MB`
                        : '—',
                  },
                  {
                    label: 'Node Heap Limit',
                    value:
                      data?.process?.memory?.stats?.nodeHeapLimitMB !== undefined
                        ? `${data.process.memory.stats.nodeHeapLimitMB} MB`
                        : '—',
                  },
                  {
                    label: 'Node Heap Usage',
                    value:
                      data?.process?.memory?.stats?.nodeHeapUsagePercent !== undefined
                        ? formatPercentage(data.process.memory.stats.nodeHeapUsagePercent, 0)
                        : '—',
                  },
                  {
                    label: 'RSS',
                    value:
                      data?.process?.memory?.stats?.processRssMB !== undefined
                        ? `${data.process.memory.stats.processRssMB} MB`
                        : data?.process?.memory?.stats?.rss !== undefined
                          ? `${data.process.memory.stats.rss} MB`
                          : '—',
                  },
                  {
                    label: 'Host Memory Usage',
                    value:
                      data?.process?.memory?.stats?.hostUsagePercent !== undefined
                        ? formatPercentage(data.process.memory.stats.hostUsagePercent, 0)
                        : '—',
                  },
                  { label: 'Host Free Memory', value: formatBytes(data?.process?.host?.freeMemoryBytes) },
                  { label: 'Host Total Memory', value: formatBytes(data?.process?.host?.totalMemoryBytes) },
                  {
                    label: 'Host Load',
                    value: Array.isArray(data?.process?.host?.loadAverage)
                      ? data?.process?.host?.loadAverage?.map((value) => value.toFixed(2)).join(' / ')
                      : '—',
                  },
                  { label: 'Hostname', value: data?.process?.host?.hostname || '—' },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24}>
            <Card size="small" title="Lifecycle Diagnostics">
              <KeyValueTable
                rows={[
                  { label: 'Current Status', value: lifecycleStatus.label },
                  { label: 'Current PID', value: data?.processLifecycle?.current?.pid ?? '—' },
                  { label: 'Current Started', value: formatDateTime(data?.processLifecycle?.current?.startedAt) },
                  { label: 'Current Updated', value: formatDateTime(data?.processLifecycle?.current?.updatedAt) },
                  { label: 'Current Stopped', value: formatDateTime(data?.processLifecycle?.current?.stoppedAt) },
                  { label: 'Current Error', value: data?.processLifecycle?.current?.error?.message || '—' },
                  {
                    label: 'Abrupt Previous Restart',
                    value: data?.processLifecycle?.abruptRestart?.detected ? 'Detected' : 'Not detected',
                  },
                  {
                    label: 'Abrupt Restart Detected At',
                    value: formatDateTime(data?.processLifecycle?.abruptRestart?.detectedAt),
                  },
                  { label: 'Previous PID', value: data?.processLifecycle?.abruptRestart?.previousPid ?? '—' },
                  { label: 'Previous Status', value: data?.processLifecycle?.abruptRestart?.previousStatus || '—' },
                  {
                    label: 'Previous Started',
                    value: formatDateTime(data?.processLifecycle?.abruptRestart?.previousStartedAt),
                  },
                  {
                    label: 'Previous Updated',
                    value: formatDateTime(data?.processLifecycle?.abruptRestart?.previousUpdatedAt),
                  },
                  { label: 'Previous Reason', value: data?.processLifecycle?.abruptRestart?.previousReason || '—' },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24}>
            <Card size="small" title="Log Files">
              <ModernTable
                size="small"
                pagination={false}
                rowKey={(row) => row.key}
                dataSource={[
                  { key: 'app', label: 'App Log', ...data?.logs?.app },
                  { key: 'access', label: 'Access Log', ...data?.logs?.access },
                ]}
                columns={[
                  { title: 'Log', dataIndex: 'label', key: 'label' },
                  {
                    title: 'Status',
                    key: 'status',
                    render: (_, row) =>
                      statusTag(
                        String(row.status || 'unknown'),
                        row.status === 'fresh'
                          ? 'green'
                          : row.status === 'stale'
                            ? 'warning'
                            : row.status === 'error'
                              ? 'red'
                              : 'default'
                      ),
                  },
                  { title: 'Modified', key: 'modifiedAt', render: (_, row) => formatDateTime(row.modifiedAt) },
                  {
                    title: 'Age',
                    key: 'age',
                    render: (_, row) => (row.modifiedAt ? formatAgeLabel(row.modifiedAt) : '—'),
                  },
                  { title: 'Size', key: 'size', render: (_, row) => formatBytes(row.sizeBytes) },
                  { title: 'File', dataIndex: 'fileName', key: 'fileName', render: (value: string) => value || '—' },
                ]}
              />
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: 'traffic',
      label: 'Traffic & Backlog',
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card size="small" title="Direction Mix (60m)">
              {Object.keys(directionMix).length === 0 ? (
                <StatePanel size="compact" glyph="searching" title="No direction data" />
              ) : (
                <Text type="secondary">
                  {Object.entries(directionMix)
                    .map(([direction, count]) => `${humanizeKey(direction)}: ${count}`)
                    .join(' · ')}
                </Text>
              )}
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card size="small" title="Backlog Breakdown">
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Pending Deliveries">
                  {Object.entries(data?.backlogs?.pendingDeliveries || {})
                    .map(([key, value]) => `${humanizeKey(key)}: ${value}`)
                    .join(' · ') || '0'}
                </Descriptions.Item>
                <Descriptions.Item label="DLQ">
                  {Object.entries(data?.backlogs?.dlq || {})
                    .map(([key, value]) => `${humanizeKey(key)}: ${value}`)
                    .join(' · ') || '0'}
                </Descriptions.Item>
                <Descriptions.Item label="Scheduled Integrations">
                  {Object.entries(data?.backlogs?.scheduledIntegrations || {})
                    .map(([key, value]) => `${humanizeKey(key)}: ${value}`)
                    .join(' · ') || '0'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
          <Col xs={24}>
            <Card size="small" title="Scheduled Jobs">
              <Row gutter={[16, 16]} className="console-margin-bottom-4">
                <Col xs={24} md={8}>
                  <Statistic title="Total" value={data?.scheduledJobs?.summary?.total ?? 0} />
                </Col>
                <Col xs={24} md={8}>
                  <Statistic title="Active" value={data?.scheduledJobs?.summary?.active ?? 0} />
                </Col>
                <Col xs={24} md={8}>
                  <Statistic title="Loaded Tasks" value={data?.scheduledJobs?.worker?.loadedTasks ?? 0} />
                </Col>
              </Row>
              <ModernTable
                size="small"
                rowKey={(row) => `${row.integrationId}-${row.correlationId}`}
                pagination={false}
                dataSource={data?.scheduledJobs?.recentExecutions || []}
                columns={[
                  { title: 'Job', dataIndex: 'integrationName', key: 'integrationName' },
                  {
                    title: 'Status',
                    key: 'status',
                    render: (_, row) =>
                      statusTag(
                        String(row.status || 'unknown'),
                        row.status === 'success' ? 'green' : row.status === 'failed' ? 'red' : 'default'
                      ),
                  },
                  { title: 'Started', key: 'startedAt', render: (_, row) => formatDateTime(row.startedAt) },
                  { title: 'Duration', key: 'durationMs', render: (_, row) => formatDuration(row.durationMs) },
                  { title: 'Records', dataIndex: 'recordsFetched', key: 'recordsFetched' },
                ]}
              />
            </Card>
          </Col>
        </Row>
      ),
    },
    {
      key: 'alerts',
      label: 'Alerts',
      children: <AlertsList data={data as SystemStatusResponse} />,
    },
  ];

  return (
    <div style={{ padding: isStandalone ? spacing[4] : spacing[6] }}>
      <PageTemplate
        as="div"
        header={
          <PageHeader
            title="System Status"
            description={`${viewingLabel} · ${dataUpdatedAt ? `Updated ${lastUpdatedAge}s ago` : 'Live diagnostics'}`}
            titleSuffix={isPortalSession ? <PortalScopeBadge /> : undefined}
            actions={
              <Space wrap>
                <Space size={8}>
                  <Text type="secondary" className="console-type-body">
                    {autoRefresh ? (
                      <RefreshCountdown intervalMs={AUTO_REFRESH_INTERVAL_MS} lastRefreshAt={dataUpdatedAt} />
                    ) : (
                      'Auto-refresh off'
                    )}
                  </Text>
                  <Switch
                    aria-label="Enable automatic system status refresh"
                    size="small"
                    checked={autoRefresh}
                    onChange={setAutoRefresh}
                  />
                </Space>
                <Button
                  icon={<GatewayIcon name="ReloadOutlined" />}
                  onClick={handleManualRefresh}
                  loading={manualRefreshPending}
                >
                  {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
                </Button>
              </Space>
            }
          />
        }
      >
        {error && <Banner status="error" title="Failed to load system status" description={(error as Error).message} />}

        {data?.processLifecycle?.current?.status === 'draining' && (
          <Banner
            status="warning"
            title="Application is draining"
            description={
              data?.processLifecycle?.current?.reason
                ? `New traffic should be routed away from this instance. Drain reason: ${data.processLifecycle.current.reason}`
                : 'New traffic should be routed away from this instance while background work winds down.'
            }
            className="console-margin-bottom-4"
          />
        )}

        {data?.processLifecycle?.abruptRestart?.detected && (
          <Banner
            status="warning"
            title="Abrupt previous restart detected"
            description={`The previous process did not record a clean stop. Detected ${formatAgeLabel(data.processLifecycle.abruptRestart.detectedAt)}.`}
            className="console-margin-bottom-4"
          />
        )}

        {dataStale && (
          <Banner
            status="warning"
            title="Status data is stale"
            description="Auto-refresh is enabled, but the last successful update is older than expected. The data below may no longer reflect the current system state."
            className="console-margin-bottom-4"
          />
        )}

        {isLoading && !data ? (
          <Card>
            <Paragraph type="secondary" className="console-margin-none">
              Loading system status…
            </Paragraph>
          </Card>
        ) : !data ? (
          <Card>
            <StatePanel size="regular" glyph="searching" title="No system status data" />
          </Card>
        ) : (
          <div className="system-status-tabs">
            <TabList
              aria-label="System status sections"
              className="system-status-tab-list"
              hasDivider
              onChange={setTab}
              overflow="visible"
              role="tablist"
              size="md"
              value={selectedTab}
            >
              {tabItems.map((item) => (
                <Tab
                  key={item.key}
                  id={`system-status-${item.key}-tab`}
                  value={item.key}
                  label={item.label}
                  panelId={`system-status-${item.key}-panel`}
                />
              ))}
            </TabList>
            {tabItems.map(
              (item) =>
                visitedTabs.has(item.key as TabKey) && (
                  <div
                    key={item.key}
                    id={`system-status-${item.key}-panel`}
                    role="tabpanel"
                    aria-labelledby={`system-status-${item.key}-tab`}
                    hidden={selectedTab !== item.key}
                    tabIndex={0}
                  >
                    {item.children}
                  </div>
                )
            )}
          </div>
        )}
      </PageTemplate>
    </div>
  );
}

export default SystemStatusRoute;
