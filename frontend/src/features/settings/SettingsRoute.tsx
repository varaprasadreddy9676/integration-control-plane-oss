import { useEffect, useState } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import {
  Card,
  Col,
  Collapse,
  Divider,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Row,
  Select,
  Space,
  Switch,
  Tooltip,
  message,
} from '@/components/common/LegacyAntdControls';
import { Banner } from '@astryxdesign/core/Banner';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { useTenant } from '../../app/tenant-context';
import { PageHeader } from '../../components/common/PageHeader';
import { PageTemplate } from '../../components/common/PageTemplate';
import {
  clearUIConfigOverride,
  getAdminSystemConfig,
  getAdminUiConfig,
  getCheckpoint,
  getUIConfig,
  getUIConfigOverride,
  listAdminOrgSummaries,
  updateAdminSystemConfig,
  updateAdminUiConfig,
  updateCheckpoint,
  updateUIConfigOverride,
} from '../../services/api';
import { useDesignTokens, spacingToNumber, cssVar } from '../../design-system/utils';
import { ModernTable } from '../../components/common/ModernTable';
import { AlertChannelsCard } from './components/AlertChannelsCard';
import { StatePanel } from '../../components/common/StatePanel';
import { Button } from '../../components/common/LegacyButton';
import { InlineHint } from '../../components/common/InlineHint';
import { StatusBadge } from '../../components/common/StatusBadge';

const { Text, Title, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FieldRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="settings-field-row">
      <Text type="secondary" className="settings-field-label">
        {label}
      </Text>
      <Text strong className={`settings-field-value${mono ? ' settings-field-value--mono' : ''}`}>
        {value || (
          <Text type="secondary" italic className="console-font-weight-normal">
            Not set
          </Text>
        )}
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const SettingsRoute = () => {
  const { tenant, orgId, setManualOrgId } = useTenant();
  const { user, impersonate } = useAuth();
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ---- pagination ----
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  // ---- alerting ----
  const [reportEnabled, setReportEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [lookbackMinutes, setLookbackMinutes] = useState(60);
  const [minFailures, setMinFailures] = useState(1);
  const [maxItems, setMaxItems] = useState(25);
  const [overrideEmail, setOverrideEmail] = useState('');
  const [savingAlert, setSavingAlert] = useState(false);
  const [resettingAlert, setResettingAlert] = useState(false);

  // ---- display preferences ----
  const [multiActionDelayMs, setMultiActionDelayMs] = useState(0);
  const [savingDelay, setSavingDelay] = useState(false);
  const [dashboardRefreshSeconds, setDashboardRefreshSeconds] = useState(30);
  const [savingDashboard, setSavingDashboard] = useState(false);

  // ---- checkpoint ----
  const [checkpointValue, setCheckpointValue] = useState<number | null>(null);
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);

  // ---- admin ----
  const [adminImpersonateOrgId, setAdminImpersonateOrgId] = useState<number | null>(null);
  const [adminUiConfigText, setAdminUiConfigText] = useState('');
  const [adminSystemConfigText, setAdminSystemConfigText] = useState('');
  const [adminSavingUiConfig, setAdminSavingUiConfig] = useState(false);
  const [adminSavingSystemConfig, setAdminSavingSystemConfig] = useState(false);
  const [adminUiConfigEditable, setAdminUiConfigEditable] = useState(false);
  const [adminSystemConfigEditable, setAdminSystemConfigEditable] = useState(false);

  const [messageApi, contextHolder] = message.useMessage();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  // ---- queries ----
  const { data: uiConfig, isLoading: uiConfigLoading } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000,
  });
  const {
    data: uiOverride,
    isLoading: uiOverrideLoading,
    refetch: refetchOverride,
  } = useQuery({
    queryKey: ['uiConfigOverride'],
    queryFn: getUIConfigOverride,
    staleTime: 5 * 60 * 1000,
  });
  const {
    data: checkpointData,
    isLoading: checkpointLoading,
    refetch: refetchCheckpoint,
  } = useQuery({
    queryKey: ['workerCheckpoint'],
    queryFn: getCheckpoint,
    staleTime: 10 * 1000,
  });
  const { data: adminOrgs = [] } = useQuery({
    queryKey: ['adminOrgsSummary'],
    queryFn: listAdminOrgSummaries,
    enabled: isAdmin,
    staleTime: 30 * 1000,
  });
  const { data: adminUiConfig } = useQuery({
    queryKey: ['adminUiConfig'],
    queryFn: getAdminUiConfig,
    enabled: isAdmin,
    staleTime: 30 * 1000,
  });
  const { data: adminSystemConfig } = useQuery({
    queryKey: ['adminSystemConfig'],
    queryFn: getAdminSystemConfig,
    enabled: isAdmin,
    staleTime: 30 * 1000,
  });

  // ---- sync state from queries ----
  useEffect(() => {
    const effective = uiConfig?.notifications?.failureEmailReports;
    const override = uiOverride?.notifications?.failureEmailReports;
    const config = override || effective;
    if (config) {
      setReportEnabled(config.enabled ?? false);
      setIntervalMinutes(config.intervalMinutes ?? 15);
      setLookbackMinutes(config.lookbackMinutes ?? 60);
      setMinFailures(config.minFailures ?? 1);
      setMaxItems(config.maxItems ?? 25);
      setOverrideEmail(config.email ?? '');
    }
    const overrideDelay = uiOverride?.worker?.multiActionDelayMs;
    const effectiveDelay = uiConfig?.worker?.multiActionDelayMs;
    if (overrideDelay != null || effectiveDelay != null) {
      setMultiActionDelayMs(Number(overrideDelay ?? effectiveDelay ?? 0));
    }
    const overrideRefresh = uiOverride?.dashboard?.autoRefreshSeconds;
    const effectiveRefresh = uiConfig?.dashboard?.autoRefreshSeconds;
    if (overrideRefresh != null || effectiveRefresh != null) {
      setDashboardRefreshSeconds(Number(overrideRefresh ?? effectiveRefresh ?? 30));
    }
  }, [uiConfig, uiOverride]);

  useEffect(() => {
    if (checkpointData?.lastProcessedId !== undefined) {
      setCheckpointValue(checkpointData.lastProcessedId);
    } else if (checkpointData?.checkpoint?.lastProcessedId !== undefined) {
      setCheckpointValue(checkpointData.checkpoint.lastProcessedId);
    }
  }, [checkpointData]);

  useEffect(() => {
    if (adminUiConfig) setAdminUiConfigText(JSON.stringify(adminUiConfig, null, 2));
  }, [adminUiConfig]);

  useEffect(() => {
    if (adminSystemConfig) setAdminSystemConfigText(JSON.stringify(adminSystemConfig, null, 2));
  }, [adminSystemConfig]);

  // ---- helpers ----
  const buildConfigDiff = (before: any, after: any) => {
    const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
    return keys
      .map((key) => {
        const prev = (before || {})[key];
        const next = (after || {})[key];
        return JSON.stringify(prev) === JSON.stringify(next) ? null : { key, before: prev, after: next };
      })
      .filter(Boolean) as Array<{ key: string; before: any; after: any }>;
  };

  // ---- derived data ----
  const childBranches = tenant?.childEntities || [];
  const paginatedBranches = childBranches.slice((page - 1) * pageSize, page * pageSize);
  const hasOverrides = !!uiOverride && Object.keys(uiOverride).length > 0;

  // Determine event source mode for checkpoint card
  const eventSourceMode: 'kafka' | 'mysql' | 'http' | 'none' = (() => {
    if (!checkpointData) return 'none';
    if (checkpointData.eventSource === 'kafka') return 'kafka';
    if (checkpointData.lastProcessedId !== undefined || checkpointData.checkpoint?.lastProcessedId !== undefined)
      return 'mysql';
    return 'http';
  })();

  const cardStyle = { borderRadius: token.borderRadius };
  const mt = { marginTop: spacingToNumber(spacing[4]) };

  // ---- save helpers ----
  const saveAlertSettings = async (
    overrides?: Partial<{
      enabled: boolean;
      email: string;
      intervalMinutes: number;
      lookbackMinutes: number;
      minFailures: number;
      maxItems: number;
    }>
  ) => {
    setSavingAlert(true);
    try {
      await updateUIConfigOverride({
        notifications: {
          failureEmailReports: {
            enabled: overrides?.enabled ?? reportEnabled,
            email: overrides?.email ?? overrideEmail,
            intervalMinutes: overrides?.intervalMinutes ?? intervalMinutes,
            lookbackMinutes: overrides?.lookbackMinutes ?? lookbackMinutes,
            minFailures: overrides?.minFailures ?? minFailures,
            maxItems: overrides?.maxItems ?? maxItems,
          },
        },
      });
      await refetchOverride();
      queryClient.invalidateQueries({ queryKey: ['uiConfigOverride'] });
      messageApi.success('Alert settings saved');
    } catch {
      messageApi.error('Failed to save alert settings');
    } finally {
      setSavingAlert(false);
    }
  };

  // ============================
  // RENDER
  // ============================
  return (
    <PageTemplate
      as="main"
      className="organization-settings-workspace"
      contentClassName="organization-settings-workspace__content"
      header={
        <PageHeader
          title="Organization Settings"
          description="Configure alerts, display preferences, and view your organization details."
          summary={[tenant?.region, tenant?.timezone].filter(Boolean).join(' · ')}
        />
      }
    >
      {contextHolder}

      <Row gutter={spacingToNumber(spacing[5])}>
        {/* ================================================================
            LEFT COLUMN — configurable settings
            ================================================================ */}
        <Col xs={24} lg={14}>
          {/* ---- 1. Notifications & Alerts ---- */}
          <Card
            title="Notifications & Alerts"
            style={cardStyle}
            extra={
              hasOverrides && (
                <Tooltip title="Reset all alert settings back to platform defaults">
                  <Button
                    size="small"
                    icon={<GatewayIcon name="RollbackOutlined" />}
                    loading={resettingAlert}
                    onClick={() => {
                      Modal.confirm({
                        title: 'Reset to platform defaults?',
                        content:
                          'This will remove your custom alert settings and restore the defaults set by your platform admin.',
                        okText: 'Reset',
                        cancelText: 'Cancel',
                        onOk: async () => {
                          setResettingAlert(true);
                          try {
                            await clearUIConfigOverride();
                            await refetchOverride();
                            messageApi.success('Settings reset to platform defaults');
                          } catch {
                            messageApi.error('Failed to reset settings');
                          } finally {
                            setResettingAlert(false);
                          }
                        },
                      });
                    }}
                  >
                    Reset to defaults
                  </Button>
                </Tooltip>
              )
            }
          >
            {uiConfigLoading || uiOverrideLoading ? (
              <StatePanel glyph="connecting" tone="busy" title="Loading alert settings" size="compact" />
            ) : (
              <Space direction="vertical" size={spacingToNumber(spacing[4])} className="console-width-full">
                {/* Toggle row */}
                <div
                  className="settings-toggle-row"
                >
                  <div>
                    <Text strong>Failure email reports</Text>
                    <Paragraph className="console-settings-helper console-margin-top-1 console-margin-bottom-none">
                      Automatically email a digest when integration deliveries fail
                    </Paragraph>
                  </div>
                  <Switch
                    checked={reportEnabled}
                    loading={savingAlert}
                    onChange={async (checked) => {
                      setReportEnabled(checked);
                      await saveAlertSettings({ enabled: checked });
                    }}
                  />
                </div>

                {/* Config fields — only when enabled */}
                {reportEnabled && (
                  <>
                    <div>
                      <Text type="secondary" className="console-type-caption">
                        Report recipient email
                      </Text>
                      <Paragraph className="console-settings-helper console-settings-helper--tertiary console-margin-top-1 console-margin-bottom-none">
                        Leave empty to use the org's primary email ({tenant?.tenantEmail || 'none on file'})
                      </Paragraph>
                      <Input
                        placeholder={tenant?.tenantEmail || 'alerts@example.com'}
                        value={overrideEmail}
                        onChange={(e) => setOverrideEmail(e.target.value)}
                        className="console-margin-top-2"
                      />
                    </div>

                    <div className="settings-responsive-control-grid">
                      <div>
                        <Text type="secondary" className="console-type-caption">
                          Check every&nbsp;
                          <Tooltip title="How often the system checks for new failures">
                            <GatewayIcon name="InfoCircleOutlined" />
                          </Tooltip>
                        </Text>
                        <InputNumber
                          min={1}
                          max={120}
                          value={intervalMinutes}
                          onChange={(v) => setIntervalMinutes(Number(v || 1))}
                          addonAfter="min"
                          className="console-width-full-margin-top-2"
                        />
                      </div>
                      <div>
                        <Text type="secondary" className="console-type-caption">
                          Scan window&nbsp;
                          <Tooltip title="How far back to look for failures each check">
                            <GatewayIcon name="InfoCircleOutlined" />
                          </Tooltip>
                        </Text>
                        <InputNumber
                          min={15}
                          max={720}
                          value={lookbackMinutes}
                          onChange={(v) => setLookbackMinutes(Number(v || 60))}
                          addonAfter="min"
                          className="console-width-full-margin-top-2"
                        />
                      </div>
                      <div>
                        <Text type="secondary" className="console-type-caption">
                          Alert threshold&nbsp;
                          <Tooltip title="Minimum number of failures before sending a report">
                            <GatewayIcon name="InfoCircleOutlined" />
                          </Tooltip>
                        </Text>
                        <InputNumber
                          min={1}
                          max={100}
                          value={minFailures}
                          onChange={(v) => setMinFailures(Number(v || 1))}
                          addonAfter="failures"
                          className="console-width-full-margin-top-2"
                        />
                      </div>
                      <div>
                        <Text type="secondary" className="console-type-caption">
                          Max per report&nbsp;
                          <Tooltip title="Maximum number of failure records included in each email">
                            <GatewayIcon name="InfoCircleOutlined" />
                          </Tooltip>
                        </Text>
                        <InputNumber
                          min={1}
                          max={100}
                          value={maxItems}
                          onChange={(v) => setMaxItems(Number(v || 25))}
                          addonAfter="items"
                          className="console-width-full-margin-top-2"
                        />
                      </div>
                    </div>

                    <Button type="primary" loading={savingAlert} onClick={() => saveAlertSettings()}>
                      Save alert settings
                    </Button>
                  </>
                )}
              </Space>
            )}
          </Card>

          <AlertChannelsCard style={{ ...cardStyle, ...mt }} />

          {/* ---- 2. Display & Behavior ---- */}
          <Card title="Display & Behavior" style={{ ...cardStyle, ...mt }}>
            {uiConfigLoading || uiOverrideLoading ? (
              <StatePanel glyph="connecting" tone="busy" title="Loading display settings" size="compact" />
            ) : (
              <Space direction="vertical" size={0} className="console-width-full">
                {/* Dashboard auto-refresh */}
                <div className="console-padding-bottom-4">
                  <Text strong>Dashboard auto-refresh</Text>
                  <Paragraph className="console-settings-helper console-settings-helper--section">
                    How often the dashboard automatically reloads live data. Set to 0 to disable.
                  </Paragraph>
                  <div className="console-settings-input-actions">
                    <InputNumber
                      min={0}
                      max={3600}
                      value={dashboardRefreshSeconds}
                      onChange={(v) => setDashboardRefreshSeconds(Number(v ?? 30))}
                      addonAfter="seconds"
                      className="console-flex-fill console-margin-top-1"
                    />
                    <Button
                      type="primary"
                      loading={savingDashboard}
                      onClick={async () => {
                        setSavingDashboard(true);
                        try {
                          await updateUIConfigOverride({ dashboard: { autoRefreshSeconds: dashboardRefreshSeconds } });
                          await refetchOverride();
                          messageApi.success('Dashboard refresh interval saved');
                        } catch {
                          messageApi.error('Failed to save');
                        } finally {
                          setSavingDashboard(false);
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                  <Text type="secondary" className="console-type-caption">
                    Platform default: {uiConfig?.dashboard?.autoRefreshSeconds ?? 30}s
                  </Text>
                </div>

                <Divider className="console-settings-divider" />

                {/* Multi-action delay */}
                <div>
                  <Text strong>Delay between integration actions</Text>
                  <Paragraph className="console-settings-helper console-settings-helper--section">
                    For integrations with multiple sequential actions, add a pause between each step. 0 = no delay.
                  </Paragraph>
                  <div className="console-settings-input-actions">
                    <InputNumber
                      min={0}
                      max={600000}
                      value={multiActionDelayMs}
                      onChange={(v) => setMultiActionDelayMs(Number(v ?? 0))}
                      addonAfter="ms"
                      className="console-flex-fill console-margin-top-1"
                    />
                    <Button
                      type="primary"
                      loading={savingDelay}
                      onClick={async () => {
                        setSavingDelay(true);
                        try {
                          await updateUIConfigOverride({ worker: { multiActionDelayMs } });
                          await refetchOverride();
                          messageApi.success('Action delay saved');
                        } catch {
                          messageApi.error('Failed to save');
                        } finally {
                          setSavingDelay(false);
                        }
                      }}
                    >
                      Save
                    </Button>
                  </div>
                  <Text type="secondary" className="console-type-caption">
                    Platform default: {uiConfig?.worker?.multiActionDelayMs ?? 0} ms
                  </Text>
                </div>
              </Space>
            )}
          </Card>

          {/* ---- 3. Event Processing (advanced, collapsed by default) ---- */}
          <Collapse
            style={{ ...mt, borderRadius: token.borderRadiusLG, overflow: 'hidden' }}
            items={[
              {
                key: 'checkpoint',
                label: (
                  <div className="console-flex-center-gap-2">
                    <GatewayIcon name="DatabaseOutlined" />
                    <span className="console-font-weight-semibold">Event Processing</span>
                    <Text type="secondary" className="console-type-caption">
                      Advanced
                    </Text>
                  </div>
                ),
                children: checkpointLoading ? (
                  <StatePanel glyph="connecting" tone="busy" title="Loading event processing" size="compact" />
                ) : eventSourceMode === 'kafka' ? (
                  // ---- Kafka mode ----
                  <Space direction="vertical" size={spacingToNumber(spacing[4])} className="console-width-full">
                    <InlineHint>
                      Kafka manages consumer offsets. Use Kafka admin tools to reset offsets when needed.
                    </InlineHint>
                    <div className="console-settings-metadata-wrap">
                      <div>
                        <Text type="secondary" className="console-type-caption">
                          Consumer group
                        </Text>
                        <div className="console-font-mono console-margin-top-1">
                          {checkpointData?.consumerGroup}
                        </div>
                      </div>
                      <div>
                        <Text type="secondary" className="console-type-caption">
                          Topic
                        </Text>
                        <div className="console-font-mono console-margin-top-1">
                          {checkpointData?.topic}
                        </div>
                      </div>
                      <div>
                        <Text type="secondary" className="console-type-caption">
                          Total lag
                        </Text>
                        <div className="console-font-mono console-margin-top-1">
                          <span className="settings-lag-value" data-level={(checkpointData?.totalLag || 0) > 100 ? 'high' : 'normal'}>
                            {checkpointData?.totalLag || 0} messages
                          </span>
                        </div>
                      </div>
                    </div>
                    {(checkpointData?.partitions?.length ?? 0) > 0 && (
                      <div>
                        <Text strong className="console-type-caption">
                          Partitions
                        </Text>
                        <div className="console-stack-vertical-gap-2 console-margin-top-2">
                          {checkpointData?.partitions?.map((p: any) => (
                            <div
                              key={p.partition}
                              className="settings-partition-row"
                            >
                              <Text strong>Partition {p.partition}</Text>
                              <div
                                  className="settings-partition-metrics"
                              >
                                <span>
                                  <Text type="secondary">Offset: </Text>
                                  {p.offset}
                                </span>
                                <span>
                                  <Text type="secondary">High watermark: </Text>
                                  {p.highWatermark}
                                </span>
                                <span>
                                  <Text type="secondary">Lag: </Text>
                                  <span className="settings-lag-value" data-level={p.lag > 100 ? 'high' : 'normal'}>
                                    {p.lag}
                                  </span>
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {checkpointData?.error && (
                      <Banner
                        status="warning"
                        title="Unable to fetch Kafka consumer group details"
                        description={checkpointData.message}
                      />
                    )}
                  </Space>
                ) : eventSourceMode === 'mysql' ? (
                  // ---- MySQL polling mode ----
                  <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
                    <Banner
                      status="warning"
                      title="Resetting this cursor may resend events"
                      description="Setting it to 0 makes the worker reprocess all events from the beginning, which may trigger duplicate deliveries to integrations."
                    />
                    <div>
                      <Text strong>Processing cursor</Text>
                      <Paragraph className="console-settings-helper console-settings-helper--section">
                        The ID of the last event row processed. Set to 0 to replay all events from the start.
                      </Paragraph>
                      <div className="console-settings-input-actions console-settings-input-actions--start">
                        <InputNumber
                          min={0}
                          value={checkpointValue}
                          onChange={(v) => setCheckpointValue(v !== null ? Number(v) : 0)}
                          className="console-flex-fill console-font-mono"
                          placeholder="0"
                        />
                        <Button
                          type="primary"
                          icon={<GatewayIcon name="SyncOutlined" />}
                          loading={savingCheckpoint}
                          onClick={async () => {
                            if (checkpointValue === null) return;
                            setSavingCheckpoint(true);
                            try {
                              await updateCheckpoint(checkpointValue);
                              messageApi.success('Cursor updated');
                              await refetchCheckpoint();
                            } catch {
                              messageApi.error('Failed to update cursor');
                            } finally {
                              setSavingCheckpoint(false);
                            }
                          }}
                        >
                          Update
                        </Button>
                        <Button
                          danger
                          loading={savingCheckpoint}
                          onClick={() => {
                            Modal.confirm({
                              title: 'Reset cursor to 0?',
                              content:
                                'The worker will reprocess ALL events, which may cause duplicate deliveries to your integrations.',
                              okText: 'Reset',
                              okButtonProps: { danger: true },
                              cancelText: 'Cancel',
                              onOk: async () => {
                                setSavingCheckpoint(true);
                                try {
                                  setCheckpointValue(0);
                                  await updateCheckpoint(0);
                                  messageApi.warning('Cursor reset to 0 — worker will reprocess all events');
                                  await refetchCheckpoint();
                                } catch {
                                  messageApi.error('Failed to reset cursor');
                                } finally {
                                  setSavingCheckpoint(false);
                                }
                              },
                            });
                          }}
                        >
                          Reset to 0
                        </Button>
                      </div>
                    </div>
                    <div className="console-flex-between-center">
                      <div>
                        <Text type="secondary" className="console-type-caption">
                          Current value in DB
                        </Text>
                        <div className="console-font-mono console-font-weight-semibold">
                          {checkpointData?.lastProcessedId ?? '—'}
                        </div>
                      </div>
                      <Button
                        size="small"
                        icon={<GatewayIcon name="ReloadOutlined" />}
                        onClick={async () => {
                          await refetchCheckpoint();
                        }}
                      >
                        Refresh
                      </Button>
                    </div>
                  </Space>
                ) : (
                  // ---- HTTP Push / no event source ----
                  <InlineHint>
                    No cursor management is needed. HTTP Push delivers events directly; polling cursors apply only to
                    configured database or Kafka sources.
                  </InlineHint>
                ),
              },
            ]}
          />
        </Col>

        {/* ================================================================
            RIGHT COLUMN — info panels
            ================================================================ */}
        <Col xs={24} lg={10}>
          {/* ---- Organization info ---- */}
          <Card
            title="Organization"
            style={cardStyle}
            extra={
              <div
                className="settings-organization-icon"
              >
                <GatewayIcon size="xsm" name="KeyOutlined" className="console-text-secondary" />
              </div>
            }
          >
            <Space direction="vertical" size={0} className="console-width-full">
              <FieldRow label="Name" value={tenant?.tenantName} />
              <FieldRow label="Org code" value={tenant?.tenantCode} mono />
              <FieldRow label="Org ID" value={tenant?.orgId} mono />
              <FieldRow label="Region" value={tenant?.region} />
              <FieldRow label="Timezone" value={tenant?.timezone} />
              <FieldRow label="Primary email" value={tenant?.tenantEmail} />
              <FieldRow label="Phone" value={tenant?.tenantPhone} />
              <FieldRow label="Address" value={tenant?.tenantAddress} />
              {(tenant?.tenantTags?.length ?? 0) > 0 && (
                <div className="settings-field-row">
                  <Text type="secondary" className="settings-field-label">
                    Tags
                  </Text>
                  <Space size={4} wrap className="ui-extracted-7fb78f0ecc">
                    {tenant?.tenantTags?.map((t: string) => (
                      <Text key={t} type="secondary">
                        {t}
                      </Text>
                    ))}
                  </Space>
                </div>
              )}
                <div className="settings-field-row">
                <Text type="secondary" className="console-type-caption">
                  Branches
                </Text>
                <Text strong>{childBranches.length}</Text>
              </div>
            </Space>
          </Card>

          {/* ---- Child Branches ---- */}
          {childBranches.length > 0 && (
            <Card
              title={
                <Space>
                  <GatewayIcon name="ApartmentOutlined" />
                  <span>Branches</span>
                  <Text type="secondary">{childBranches.length}</Text>
                </Space>
              }
              style={{ ...cardStyle, ...mt }}
            >
              <ModernTable
                dataSource={paginatedBranches}
                rowKey={(row) => row.rid ?? row.code}
                pagination={false}
                size="small"
                columns={[
                  { title: 'Name', dataIndex: 'name', key: 'name' },
                  {
                    title: 'ID',
                    dataIndex: 'rid',
                    key: 'rid',
                    width: 80,
                    render: (rid: number) => (
                      <Text className="console-font-mono console-type-caption">
                        {rid ?? '—'}
                      </Text>
                    ),
                  },
                  { title: 'Code', dataIndex: 'code', key: 'code', width: 110 },
                ]}
              />
              {childBranches.length > pageSize && (
                <div className="console-margin-top-3 console-text-align-right">
                  <Pagination
                    size="small"
                    current={page}
                    pageSize={pageSize}
                    total={childBranches.length}
                    showSizeChanger
                    pageSizeOptions={[5, 8, 15]}
                    onChange={(p, ps) => {
                      setPage(p);
                      setPageSize(ps);
                    }}
                  />
                </div>
              )}
            </Card>
          )}

          {/* ---- Quick links ---- */}
          <Card
            title={
              <Space>
                <GatewayIcon name="SettingOutlined" />
                <span>Related Settings</span>
              </Space>
            }
            style={{ ...cardStyle, ...mt }}
          >
            <Space direction="vertical" className="console-width-full" size={spacingToNumber(spacing[2])}>
              <Button
                block
                icon={<GatewayIcon name="ThunderboltOutlined" />}
                onClick={() => navigate('/settings/event-source')}
                className="console-text-align-left"
              >
                Event Source Configuration
              </Button>
              <Button
                block
                icon={<GatewayIcon name="MailOutlined" />}
                onClick={() => navigate('/settings/sender-profiles')}
                className="console-text-align-left"
              >
                Sender Profiles
              </Button>
              <Button
                block
                icon={<GatewayIcon name="AppstoreOutlined" />}
                onClick={() => navigate('/settings/providers')}
                className="console-text-align-left"
              >
                Providers
              </Button>
              {isAdmin && (
                <Button
                  block
                  icon={<GatewayIcon name="DatabaseOutlined" />}
                  onClick={() => navigate('/settings/mysql-pool')}
                  className="console-text-align-left"
                >
                  MySQL Shared Pool
                </Button>
              )}
              <Button
                block
                icon={<GatewayIcon name="TeamOutlined" />}
                onClick={() => navigate('/admin/users')}
                className="console-text-align-left"
              >
                User Management
              </Button>
              {isAdmin && (
                <Button
                  block
                  icon={<GatewayIcon name="AuditOutlined" />}
                  onClick={() => navigate('/admin/audit-logs')}
                  className="console-text-align-left"
                >
                  Audit Logs
                </Button>
              )}
            </Space>
          </Card>
        </Col>
      </Row>

      {/* ================================================================
          ADMIN-ONLY SECTION
          ================================================================ */}
      {isAdmin && (
        <div className="console-margin-top-8">
          <Divider>
            <Space>
              <GatewayIcon name="WarningOutlined" className="console-text-warning" />
              <Text type="secondary">Platform Admin Settings</Text>
            </Space>
          </Divider>

          <Row gutter={spacingToNumber(spacing[5])}>
            <Col xs={24} lg={12}>
              <Card title="Organization Scope" style={cardStyle}>
                <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
                  <Text type="secondary">
                    Switch the data view context to any organization, or start an impersonation session as that org's
                    admin.
                  </Text>
                  <div>
                    <Text type="secondary" className="console-type-caption">
                      Current org context
                    </Text>
                    <div className="console-font-mono console-font-weight-semibold console-margin-top-1">
                      {orgId || 'None'}
                    </div>
                  </div>
                  <Select
                    placeholder="Select organization"
                    value={adminImpersonateOrgId ?? undefined}
                    onChange={(v) => setAdminImpersonateOrgId(Number(v))}
                    options={adminOrgs.map((org) => ({
                      label: org.name ? `${org.name} (${org.orgId})` : `Org ${org.orgId}`,
                      value: org.orgId,
                    }))}
                    className="console-width-full"
                    showSearch
                    optionFilterProp="label"
                  />
                  <InputNumber
                    placeholder="Or type an org ID"
                    value={adminImpersonateOrgId ?? undefined}
                    onChange={(v) => setAdminImpersonateOrgId(Number(v || 0))}
                    className="console-width-full"
                  />
                  <Space wrap>
                    <Button
                      onClick={() => {
                        if (!adminImpersonateOrgId) {
                          messageApi.error('Select or enter an org ID');
                          return;
                        }
                        Modal.confirm({
                          title: 'Switch organization context?',
                          content: `Set view to org ${adminImpersonateOrgId}. Unsaved changes may be lost.`,
                          okText: 'Switch',
                          onOk: () => {
                            setManualOrgId(adminImpersonateOrgId);
                            messageApi.success(`Context set to org ${adminImpersonateOrgId}`);
                          },
                        });
                      }}
                    >
                      Set Org Context
                    </Button>
                    <Button
                      type="primary"
                      onClick={() => {
                        if (!adminImpersonateOrgId) {
                          messageApi.error('Select or enter an org ID');
                          return;
                        }
                        Modal.confirm({
                          title: 'Start impersonation session?',
                          content: `You will act as org ${adminImpersonateOrgId} until you exit impersonation.`,
                          okText: 'Impersonate',
                          onOk: async () => {
                            await impersonate(adminImpersonateOrgId, 'ORG_ADMIN');
                            messageApi.success(`Impersonating org ${adminImpersonateOrgId}`);
                          },
                        });
                      }}
                    >
                      Impersonate Org Admin
                    </Button>
                  </Space>
                </Space>
              </Card>

              <Card title="Global UI Config" style={{ ...cardStyle, ...mt }}>
                <Paragraph type="secondary" className="console-margin-bottom-2">
                  Changes apply to all organizations. Must be valid JSON.
                </Paragraph>
                <Input.TextArea
                  value={adminUiConfigText}
                  onChange={(e) => setAdminUiConfigText(e.target.value)}
                  rows={12}
                  className="console-font-mono"
                  disabled={!adminUiConfigEditable}
                />
                <Space className="console-margin-top-3">
                  <Button onClick={() => setAdminUiConfigEditable((v) => !v)}>
                    {adminUiConfigEditable ? 'Lock' : 'Unlock editing'}
                  </Button>
                  <Button
                    type="primary"
                    loading={adminSavingUiConfig}
                    disabled={!adminUiConfigEditable}
                    onClick={async () => {
                      try {
                        const parsed = JSON.parse(adminUiConfigText || '{}');
                        const changes = buildConfigDiff(adminUiConfig, parsed);
                        if (changes.length === 0) {
                          messageApi.info('No changes to save');
                          return;
                        }
                        Modal.confirm({
                          title: 'Apply global UI config?',
                          content: (
                            <div className="console-scroll-max-height-60">
                              {changes.map((c) => (
                                <div key={c.key} className="console-margin-bottom-3">
                                  <Text strong>{c.key}</Text>
                                  <pre className="console-code-caption-margin-y-1-pre-wrap">
                                    {JSON.stringify(c.before, null, 2)}
                                  </pre>
                                  <pre className="console-code-caption-reset-wrap">
                                    {JSON.stringify(c.after, null, 2)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          ),
                          okText: 'Apply',
                          onOk: async () => {
                            setAdminSavingUiConfig(true);
                            try {
                              await updateAdminUiConfig(parsed);
                              messageApi.success('Global UI config updated');
                              setAdminUiConfigEditable(false);
                            } finally {
                              setAdminSavingUiConfig(false);
                            }
                          },
                        });
                      } catch {
                        messageApi.error('Invalid JSON — fix formatting before saving');
                      }
                    }}
                  >
                    Save
                  </Button>
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card
                title="System Config"
                style={cardStyle}
                extra={<StatusBadge label="Requires restart" variant="warning" />}
              >
                <Paragraph type="secondary" className="console-margin-bottom-2">
                  Only safe fields are exposed here. Changes are written to <Text code>config.json</Text> and take
                  effect after a backend restart.
                </Paragraph>
                <Input.TextArea
                  value={adminSystemConfigText}
                  onChange={(e) => setAdminSystemConfigText(e.target.value)}
                  rows={10}
                  className="console-font-mono"
                  disabled={!adminSystemConfigEditable}
                />
                <Space className="console-margin-top-3">
                  <Button onClick={() => setAdminSystemConfigEditable((v) => !v)}>
                    {adminSystemConfigEditable ? 'Lock' : 'Unlock editing'}
                  </Button>
                  <Button
                    type="primary"
                    loading={adminSavingSystemConfig}
                    disabled={!adminSystemConfigEditable}
                    onClick={async () => {
                      try {
                        const parsed = JSON.parse(adminSystemConfigText || '{}');
                        const changes = buildConfigDiff(adminSystemConfig, parsed);
                        if (changes.length === 0) {
                          messageApi.info('No changes to save');
                          return;
                        }
                        Modal.confirm({
                          title: 'Apply system config changes?',
                          content: (
                            <div className="console-scroll-max-height-60">
                              {changes.map((c) => (
                                <div key={c.key} className="console-margin-bottom-3">
                                  <Text strong>{c.key}</Text>
                                  <pre className="console-code-caption-margin-y-1-pre-wrap">
                                    {JSON.stringify(c.before, null, 2)}
                                  </pre>
                                  <pre className="console-code-caption-reset-wrap">
                                    {JSON.stringify(c.after, null, 2)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          ),
                          okText: 'Apply',
                          onOk: async () => {
                            setAdminSavingSystemConfig(true);
                            try {
                              const response = await updateAdminSystemConfig(parsed);
                              messageApi.success(response.message);
                              setAdminSystemConfigEditable(false);
                            } finally {
                              setAdminSavingSystemConfig(false);
                            }
                          },
                        });
                      } catch {
                        messageApi.error('Invalid JSON — fix formatting before saving');
                      }
                    }}
                  >
                    Save
                  </Button>
                </Space>
              </Card>
            </Col>
          </Row>
        </div>
      )}
    </PageTemplate>
  );
};
