import { useState } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import {
  Card,
  Descriptions,
  Space,
  Collapse,
  message,
  Timeline,
  Divider,
} from '@/components/common/LegacyAntdControls';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { getLogById, retryLog, getApiBaseUrl } from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { resolveGatewayUrl } from '../../../utils/curl';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { useDesignTokens, spacingToNumber, withAlpha, cssVar } from '../../../design-system/utils';
import { isCredentialField } from '../../../utils/curl';
import { DeliveryAttempt } from '../../../mocks/types';
import { useTenant } from '../../../app/tenant-context';
import { RequestPolicySummary } from '../../integrations/components/detail/shared/RequestPolicySummary';
import { Hl7LogPanel, isHl7LogLike } from '../components/Hl7LogPanel';
import { StatePanel } from '../../../components/common/StatePanel';
import { Button } from '../../../components/common/LegacyButton';
import { StatusBadge } from '../../../components/common/StatusBadge';

const { Panel } = Collapse;
const { Text, Title } = Typography;

export const LogDetailRoute = () => {
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;
  const { id } = useParams();
  const navigate = useNavigate();
  const { orgId } = useTenant();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['log', id],
    queryFn: () => (id ? getLogById(id) : Promise.resolve(undefined)),
    enabled: Boolean(id),
  });

  const handleReplayWithPayload = async (options: { payload: unknown; reason: string; force: boolean }) => {
    if (!id) return;
    try {
      await retryLog(id, options);
      message.success(
        options.force ? 'Force replay initiated with edited payload.' : 'Replay initiated with edited payload.'
      );
      await refetch();
    } catch (error: any) {
      message.error(error?.message || 'Failed to replay delivery');
      throw error;
    }
  };

  // Use integration configuration from the log response (no separate API call needed)
  const integration = data?.__KEEP_integrationConfig__;
  const responseStatus = data?.responseStatus;
  const hasResponseStatus = typeof responseStatus === 'number';
  const responseOk = hasResponseStatus && responseStatus >= 200 && responseStatus < 300;
  const metadata = data?.metadata;
  const dataFetched = metadata?.dataFetched;
  const transformedPayload = metadata?.transformedPayload;
  const curlCommand = metadata?.curlCommand;
  const hasDataFetched = dataFetched !== undefined && dataFetched !== null;
  const hasTransformedPayload = transformedPayload !== undefined && transformedPayload !== null;
  const hasCurlCommand = Boolean(curlCommand);
  const isScriptJob = data?.direction === 'SCRIPT_JOB';
  const scriptLogs = metadata?.scriptLogs;
  const hasScriptLogs = Array.isArray(scriptLogs) && scriptLogs.length > 0;
  const scriptSkipReason = metadata?.reason;
  const hasScheduledJobFlow =
    (data?.direction === 'SCHEDULED' || data?.direction === 'SCRIPT_JOB' || data?.triggerType === 'SCHEDULE') &&
    metadata &&
    (metadata.recordsFetched !== undefined ||
      hasTransformedPayload ||
      Boolean(metadata.httpRequest) ||
      Boolean(data?.responseBody) ||
      hasScriptLogs ||
      Boolean(data?.errorMessage) ||
      Boolean(scriptSkipReason));
  const senderRoutingMetadata = metadata?.senderRouting;
  const hasHl7Details = isHl7LogLike({
    httpMethod: data?.httpMethod,
    metadata,
    requestPayload: data?.requestPayload,
    responseBody: data?.responseBody,
  });

  // Headers added by browsers/Postman that are not relevant for reproduction
  const SKIP_HEADERS = new Set([
    'user-agent',
    'accept',
    'postman-token',
    'host',
    'accept-encoding',
    'connection',
    'content-length',
    'accept-language',
  ]);

  // Generate curl command from the actual request headers. Credential headers
  // are masked: this command gets pasted into tickets and chat.
  const generateCurlCommand = (
    config: any,
    payload: any,
    requestHeaders?: any,
    direction?: string,
    requestSnapshot?: { url?: string | null; method?: string | null; query?: Record<string, unknown> }
  ) => {
    if (!payload) return '';

    const apiBase = getApiBaseUrl();

    let targetUrl: string;
    let httpMethod: string;

    if (direction === 'INBOUND') {
      const usesPublicRuntime =
        !config?.inboundAuthType || config?.inboundAuthType === 'NONE' || config?.inboundAuthType === 'HMAC';
      const requestUrl =
        typeof requestSnapshot?.url === 'string' && requestSnapshot.url.trim()
          ? requestSnapshot.url.trim()
          : `/api/v1/${usesPublicRuntime ? 'public/integrations' : 'integrations'}/${config?.type || 'integration'}?orgId=${orgId}`;

      targetUrl = resolveGatewayUrl(requestUrl, apiBase);

      httpMethod = String(requestSnapshot?.method || 'GET').toUpperCase();
    } else {
      targetUrl = config?.targetUrl || '';
      httpMethod = config?.httpMethod || 'POST';
    }

    let curl = `curl --location '${targetUrl}'`;

    if (direction === 'INBOUND') {
      const usesPublicRuntime =
        !config?.inboundAuthType || config?.inboundAuthType === 'NONE' || config?.inboundAuthType === 'HMAC';
      if (!usesPublicRuntime) {
        curl += ` \\\n  --header 'X-API-Key: [REDACTED]'`;
      }

      if (config?.inboundAuthType === 'BEARER') {
        curl += ` \\\n  --header 'Authorization: Bearer <INBOUND_TOKEN>'`;
      } else if (config?.inboundAuthType === 'BASIC') {
        curl += ` \\\n  --header 'Authorization: Basic <BASE64_USER_PASS>'`;
      } else if (config?.inboundAuthType === 'HMAC') {
        const messageIdHeader = config?.inboundAuthConfig?.messageIdHeader || 'X-Integration-ID';
        const timestampHeader = config?.inboundAuthConfig?.timestampHeader || 'X-Integration-Timestamp';
        const signatureHeader = config?.inboundAuthConfig?.signatureHeader || 'X-Integration-Signature';
        curl += ` \\\n  --header '${messageIdHeader}: <MESSAGE_ID>'`;
        curl += ` \\\n  --header '${timestampHeader}: <UNIX_TIMESTAMP>'`;
        curl += ` \\\n  --header '${signatureHeader}: <V1_HMAC_SIGNATURE>'`;
      } else if (config?.inboundAuthType === 'API_KEY' && config?.inboundAuthConfig?.headerName) {
        const headerName = String(config.inboundAuthConfig.headerName);
        if (headerName.toLowerCase() !== 'x-api-key') {
          curl += ` \\\n  --header '${headerName}: <INBOUND_API_KEY>'`;
        }
      }
    } else if (requestHeaders && typeof requestHeaders === 'object') {
      Object.entries(requestHeaders).forEach(([key, value]) => {
        if (!SKIP_HEADERS.has(key.toLowerCase())) {
          const customAuthHeader = config?.outgoingAuthConfig?.headerName;
          const isCustomAuth =
            typeof customAuthHeader === 'string' && key.toLowerCase() === customAuthHeader.toLowerCase();
          const shown = isCredentialField(key) || isCustomAuth ? '[REDACTED]' : value;
          curl += ` \\\n  --header '${key}: ${shown}'`;
        }
      });
    } else if (config) {
      curl += ` \\\n  --header 'Content-Type: application/json'`;

      if (config.outgoingAuthType === 'API_KEY' && config.outgoingAuthConfig) {
        const headerName = config.outgoingAuthConfig.headerName || 'X-API-Key';
        curl += ` \\\n  --header '${headerName}: [REDACTED]'`;
      } else if (config.outgoingAuthType === 'BEARER' && config.outgoingAuthConfig) {
        curl += ` \\\n  --header 'Authorization: Bearer [REDACTED]'`;
      } else if (config.outgoingAuthType === 'BASIC' && config.outgoingAuthConfig) {
        curl += ` \\\n  --header 'Authorization: Basic [REDACTED]'`;
      }
    }

    if (httpMethod !== 'GET') {
      curl += ` \\\n  --data-raw '${JSON.stringify(payload, null, 2)}'`;
    }

    return curl;
  };

  const formatResponseBody = (body: any): string => {
    if (body === null || body === undefined) return '';
    if (typeof body === 'string') return body;
    return JSON.stringify(body, null, 2);
  };

  const copyToClipboard = async (text: string) => {
    const copied = await copyTextToClipboard(text);
    if (copied) {
      message.success('Copied to clipboard');
    } else {
      message.error('Failed to copy');
    }
  };

  // Helper functions for retry attempts
  const getAttemptIcon = (attempt: DeliveryAttempt) => {
    switch (attempt.status) {
      case 'SUCCESS':
        return <GatewayIcon name="CheckCircleOutlined" className="console-text-success" />;
      case 'FAILED':
        return <GatewayIcon name="ExclamationCircleOutlined" className="console-text-error" />;
      case 'RETRYING':
        return <GatewayIcon name="LoadingOutlined" className="console-text-warning" />;
      default:
        return <GatewayIcon name="ClockCircleOutlined" style={{ color: colors.info[600] }} />;
    }
  };

  const getAttemptColor = (attempt: DeliveryAttempt) => {
    switch (attempt.status) {
      case 'SUCCESS':
        return colors.success[600];
      case 'FAILED':
        return colors.error[600];
      case 'RETRYING':
        return colors.warning[600];
      default:
        return colors.info[600];
    }
  };

  const generateCurlCommandForAttempt = (attempt: DeliveryAttempt, __KEEP_integrationConfig__?: any) => {
    const targetUrl = attempt.targetUrl || __KEEP_integrationConfig__?.targetUrl;
    const httpMethod = attempt.httpMethod || __KEEP_integrationConfig__?.httpMethod || 'POST';

    if (!targetUrl || !attempt.requestPayload) return '';

    let curl = `curl -X ${httpMethod} "${targetUrl}"`;

    // Headers as sent, with credentials masked — this gets copied into tickets.
    if (attempt.requestHeaders && typeof attempt.requestHeaders === 'object') {
      Object.entries(attempt.requestHeaders).forEach(([key, value]) => {
        const customAuthHeader = __KEEP_integrationConfig__?.outgoingAuthConfig?.headerName;
        const isCustomAuth =
          typeof customAuthHeader === 'string' && key.toLowerCase() === customAuthHeader.toLowerCase();
        const shown = isCredentialField(key) || isCustomAuth ? '[REDACTED]' : value;
        curl += ` \\\n  -H "${key}: ${shown}"`;
      });
    } else {
      // Fallback: Reconstruct from integration config (redacted for security)
      curl += ` \\\n  -H "Content-Type: application/json"`;

      if (__KEEP_integrationConfig__?.outgoingAuthType === 'API_KEY' && __KEEP_integrationConfig__.outgoingAuthConfig) {
        const headerName = __KEEP_integrationConfig__.outgoingAuthConfig.headerName || 'X-API-Key';
        curl += ` \\\n  -H "${headerName}: [REDACTED]"`;
      } else if (
        __KEEP_integrationConfig__?.outgoingAuthType === 'BEARER' &&
        __KEEP_integrationConfig__.outgoingAuthConfig
      ) {
        curl += ` \\\n  -H "Authorization: Bearer [REDACTED]"`;
      } else if (
        __KEEP_integrationConfig__?.outgoingAuthType === 'BASIC' &&
        __KEEP_integrationConfig__.outgoingAuthConfig
      ) {
        curl += ` \\\n  -H "Authorization: Basic [REDACTED]"`;
      }
    }

    curl += ` \\\n  -d '${JSON.stringify(attempt.requestPayload, null, 2)}'`;

    return curl;
  };

  const AttemptTimelineItem = ({
    attempt,
    __KEEP_integrationConfig__,
  }: {
    attempt: DeliveryAttempt;
    __KEEP_integrationConfig__?: any;
  }) => (
    <Timeline.Item
      dot={getAttemptIcon(attempt)}
      color={attempt.status === 'SUCCESS' ? 'green' : attempt.status === 'FAILED' ? 'red' : 'blue'}
    >
      <Space direction="vertical" className="console-width-full" size="small">
        <div className="console-flex-between-center">
          <Space>
            <Title level={5} style={{ margin: 'var(--spacing-0)', color: getAttemptColor(attempt) }}>
              Attempt {attempt.attemptNumber}
            </Title>
            <StatusBadge status={attempt.status} />
          </Space>
          <Text type="secondary">{formatDateTime(attempt.attemptedAt)}</Text>
        </div>

        {attempt.retryReason && (
          <Text type="secondary" className="ui-extracted-e9b019cefa">
            Reason: {attempt.retryReason}
          </Text>
        )}

        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3, lg: 3, xl: 3, xxl: 3 }} bordered>
          {attempt.responseStatus && (
            <Descriptions.Item label="HTTP Status">{renderHttpStatus(attempt.responseStatus)}</Descriptions.Item>
          )}
          {attempt.responseTimeMs && (
            <Descriptions.Item label="Response Time">{attempt.responseTimeMs} ms</Descriptions.Item>
          )}
          <Descriptions.Item label="Target">
            <Text code className="console-type-caption">
              {attempt.targetUrl}
            </Text>
          </Descriptions.Item>
        </Descriptions>

        {attempt.errorMessage && (
          <div className="console-margin-top-1">
            <Text type="danger" strong>
              Error:
            </Text>
            <Text code style={{ display: 'block', marginTop: spacing[0.5], fontSize: 'var(--console-type-caption)' }}>
              {attempt.errorMessage}
            </Text>
          </div>
        )}

        <Collapse size="small" ghost>
          <Panel
            header={
              <div className="console-flex-between-center">
                <Text strong>Request Details</Text>
                <Button
                  size="small"
                  icon={<GatewayIcon name="CopyOutlined" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(generateCurlCommandForAttempt(attempt, __KEEP_integrationConfig__));
                  }}
                >
                  Copy cURL
                </Button>
              </div>
            }
            key="request"
          >
            <Space direction="vertical" className="console-width-full" size="middle">
              <div>
                <Text strong>cURL Command:</Text>
                <div className="console-position-relative">
                  <Button
                    size="small"
                    icon={<GatewayIcon name="CopyOutlined" />}
                    onClick={() => copyToClipboard(generateCurlCommandForAttempt(attempt, __KEEP_integrationConfig__))}
                    className="console-position-absolute-inset-1"
                  />
                  <pre className="log-detail-code-preview log-detail-code-preview--curl log-detail-code-preview--compact">
                    {generateCurlCommandForAttempt(attempt, __KEEP_integrationConfig__)}
                  </pre>
                </div>
              </div>

              <div>
                <Space>
                  <Text strong>Request Payload:</Text>
                  <Button
                    size="small"
                    icon={<GatewayIcon name="CopyOutlined" />}
                    onClick={() => copyToClipboard(JSON.stringify(attempt.requestPayload, null, 2))}
                  >
                    Copy JSON
                  </Button>
                </Space>
                <pre className="log-detail-code-preview log-detail-code-preview--compact">
                  {JSON.stringify(attempt.requestPayload, null, 2)}
                </pre>
              </div>
            </Space>
          </Panel>

          <Panel
            header={
              <div className="console-flex-between-center">
                <Text strong>Response Details</Text>
                {attempt.responseBody && (
                  <Button
                    size="small"
                    icon={<GatewayIcon name="CopyOutlined" />}
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(formatResponseBody(attempt.responseBody));
                    }}
                  >
                    Copy Response
                  </Button>
                )}
              </div>
            }
            key="response"
          >
            <div>
              <Text strong>Response Body:</Text>
              <div className="console-position-relative">
                {attempt.responseBody && (
                  <Button
                    size="small"
                    icon={<GatewayIcon name="CopyOutlined" />}
                    onClick={() => copyToClipboard(formatResponseBody(attempt.responseBody))}
                    className="console-position-absolute-inset-1"
                  />
                )}
                <pre
                  className="log-detail-code-preview log-detail-code-preview--compact"
                  data-copyable={Boolean(attempt.responseBody)}
                >
                  {formatResponseBody(attempt.responseBody) || 'No response captured'}
                </pre>
              </div>
            </div>
          </Panel>
        </Collapse>
      </Space>
    </Timeline.Item>
  );

  const renderHttpStatus = (status: unknown) => {
    if (typeof status !== 'number') return <Text type="secondary">N/A</Text>;
    return (
      <code className={`console-text-secondary font-tabular${status >= 400 ? ' console-text-error' : ''}`}>
        {status}
      </code>
    );
  };

  return (
    <PageTemplate
      header={
        <PageHeader
          title="Delivery log"
          breadcrumb={[
            { label: 'Logs', path: '/logs' },
            { label: integration?.name || data?.__KEEP_integrationName__ || data?.eventType || 'Delivery log' },
          ]}
          compact
          actions={<Link to="/logs">Back to logs</Link>}
        />
      }
    >
      {isLoading && !data ? (
        <StatePanel
          glyph="connecting"
          size="regular"
          title="Loading delivery log"
          description="Fetching delivery details."
        />
      ) : isError && !data ? (
        <StatePanel
          glyph="disrupted"
          tone="critical"
          title="Could not load delivery log"
          description="The request failed."
          actions={
            <Button size="small" icon={<GatewayIcon name="ReloadOutlined" />} onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : !data ? (
        <StatePanel
          glyph="searching"
          title="Delivery log not found"
          description="This record may have been removed."
          actions={
            <Button size="small" type="primary" onClick={() => navigate('/logs')}>
              Back to logs
            </Button>
          }
        />
      ) : (
        <Space direction="vertical" className="console-width-full" size={spacingToNumber(spacing[3])}>
          {/* Overview Card */}
          <Card title="Overview" size="small">
            <Descriptions column={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2, xxl: 2 }} bordered size="small">
              <Descriptions.Item label="Integration">{data.__KEEP_integrationName__}</Descriptions.Item>
              <Descriptions.Item label="Event type">{data.eventType}</Descriptions.Item>
              <Descriptions.Item label="Flow">
                {data.direction === 'OUTBOUND' && data.triggerType === 'SCHEDULED'
                  ? 'SCHEDULED'
                  : data.direction || 'OUTBOUND'}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusBadge status={data.status} />
              </Descriptions.Item>
              <Descriptions.Item label="Attempt Count">
                <Text type="secondary">
                  {data.attemptCount} {data.attemptCount === 1 ? 'attempt' : 'attempts'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Created">{formatDateTime(data.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Response status">
                {hasResponseStatus ? renderHttpStatus(responseStatus) : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Response time">
                {data.responseTimeMs ? `${data.responseTimeMs} ms` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Error Message">
                {data.errorMessage ? (
                  <Space direction="vertical" size={8} className="console-width-full">
                    <Text type="danger">{data.errorMessage}</Text>
                  </Space>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Integration Configuration Details */}
          {integration && (
            <Card
              title="Integration Configuration"
              size="small"
              extra={
                <Button
                  type="link"
                  icon={<GatewayIcon name="ReloadOutlined" />}
                  onClick={() => navigate(`/integrations/${integration.id}`)}
                >
                  View Integration
                </Button>
              }
            >
              <Descriptions column={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2, xxl: 2 }} bordered size="small">
                <Descriptions.Item label="Target URL">{integration.targetUrl}</Descriptions.Item>
                <Descriptions.Item label="HTTP Method">
                  <Text code>{integration.httpMethod}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Authentication">
                  <Text code>{integration.outgoingAuthType}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Timeout">{integration.timeoutMs} ms</Descriptions.Item>
                <Descriptions.Item label="Max Retries">{integration.retryCount}</Descriptions.Item>
                <Descriptions.Item label="Active">
                  <StatusBadge
                    label={integration.isActive ? 'Active' : 'Inactive'}
                    variant={integration.isActive ? 'success' : 'neutral'}
                  />
                </Descriptions.Item>
                {data.direction === 'INBOUND' && (
                  <Descriptions.Item label="Request Policy" span={2}>
                    <RequestPolicySummary
                      policy={integration.requestPolicy || null}
                      emptyLabel="No inbound request policy configured"
                    />
                  </Descriptions.Item>
                )}
                {senderRoutingMetadata && (
                  <Descriptions.Item label="Sender Routing" span={2}>
                    <Space size={[6, 6]} wrap>
                      <Text type="secondary">Decision: {senderRoutingMetadata.routingDecision || 'resolved'}</Text>
                      {senderRoutingMetadata.requestedFrom && (
                        <Text type="secondary">Requested: {senderRoutingMetadata.requestedFrom}</Text>
                      )}
                      {senderRoutingMetadata.senderProfile?.fromEmail && (
                        <Text type="secondary">Resolved: {senderRoutingMetadata.senderProfile.fromEmail}</Text>
                      )}
                      {senderRoutingMetadata.senderProfile?.provider && (
                        <Text type="secondary">Provider: {senderRoutingMetadata.senderProfile.provider}</Text>
                      )}
                      {senderRoutingMetadata.senderProfile?.isDefault && <Text type="secondary">Default profile</Text>}
                    </Space>
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>
          )}

          {/* Scheduled Job Execution Details */}
          {hasScheduledJobFlow && metadata && (
            <Card title={isScriptJob ? 'Script Job Execution' : 'Scheduled Job Execution Flow'} size="small">
              <Timeline>
                {scriptSkipReason && (
                  <Timeline.Item
                    color="orange"
                    dot={<GatewayIcon name="ExclamationCircleOutlined" className="console-type-section" />}
                  >
                    <Space direction="vertical" className="console-width-full" size="small">
                      <Text strong className="console-type-control">
                        Skipped
                      </Text>
                      <Text type="secondary">{scriptSkipReason}</Text>
                    </Space>
                  </Timeline.Item>
                )}

                {hasScriptLogs && (
                  <Timeline.Item
                    color={scriptLogs.some((l: any) => l.level === 'error') ? 'red' : 'blue'}
                    dot={<GatewayIcon name="CodeOutlined" className="console-type-section" />}
                  >
                    <Space direction="vertical" className="console-width-full" size="small">
                      <div className="console-flex-between-center">
                        <Text strong className="console-type-control">
                          Script Console Output
                        </Text>
                        <Button
                          size="small"
                          icon={<GatewayIcon name="CopyOutlined" />}
                          onClick={() =>
                            copyToClipboard(
                              scriptLogs
                                .map(
                                  (l: any) =>
                                    `[${new Date(l.ts).toLocaleTimeString()}] ${l.level.toUpperCase()} ${l.message}`
                                )
                                .join('\n')
                            )
                          }
                        >
                          Copy
                        </Button>
                      </div>
                      <Text type="secondary">{scriptLogs.length} log line(s) captured during execution</Text>
                      <div
                        className="console-script-output console-script-output--detail"
                      >
                        {scriptLogs.map((entry: any, i: number) => (
                          <div
                            key={i}
                            className="console-script-output__line"
                          >
                            <span
                              className="console-script-output__time"
                            >
                              {new Date(entry.ts).toLocaleTimeString()}
                            </span>
                            <span
                              className="console-script-output__level console-script-output__level--detail"
                              data-level={String(entry.level).toLowerCase()}
                            >
                              {entry.level}
                            </span>
                            <span className="console-script-output__message">
                              {entry.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Space>
                  </Timeline.Item>
                )}

                {metadata.recordsFetched !== undefined && (
                  <Timeline.Item
                    color="blue"
                    dot={<GatewayIcon name="CheckCircleOutlined" className="console-type-section" />}
                  >
                    <Space direction="vertical" className="console-width-full" size="small">
                      <Text strong className="console-type-control">
                        Step 1: Data Fetched from Source
                      </Text>
                      <Text type="secondary">Retrieved {metadata.recordsFetched} record(s) from data source</Text>
                      {hasDataFetched && (
                        <Collapse size="small" ghost>
                          <Panel header={<Text strong>View Data</Text>} key="dataFetched">
                            <div className="console-position-relative">
                              <Button
                                size="small"
                                icon={<GatewayIcon name="CopyOutlined" />}
                                onClick={() => copyToClipboard(JSON.stringify(dataFetched, null, 2))}
                                className="console-position-absolute-inset-1"
                              />
                              <pre className="log-detail-code-preview log-detail-code-preview--compact log-detail-code-preview--copyable">
                                {JSON.stringify(dataFetched, null, 2)}
                              </pre>
                            </div>
                          </Panel>
                        </Collapse>
                      )}
                    </Space>
                  </Timeline.Item>
                )}

                {hasTransformedPayload && (
                  <Timeline.Item
                    color="green"
                    dot={<GatewayIcon name="CheckCircleOutlined" className="console-type-section" />}
                  >
                    <Space direction="vertical" className="console-width-full" size="small">
                      <Text strong className="console-type-control">
                        Step 2: Data Transformed
                      </Text>
                      <Text type="secondary">Applied transformation script to prepare payload for delivery</Text>
                      <Collapse size="small" ghost>
                        <Panel header={<Text strong>View Transformed Payload</Text>} key="transformed">
                          <div className="console-position-relative">
                            <Button
                              size="small"
                              icon={<GatewayIcon name="CopyOutlined" />}
                              onClick={() => copyToClipboard(JSON.stringify(transformedPayload, null, 2))}
                              className="console-position-absolute-inset-1"
                            />
                            <pre className="log-detail-code-preview log-detail-code-preview--compact log-detail-code-preview--copyable">
                              {JSON.stringify(transformedPayload, null, 2)}
                            </pre>
                          </div>
                        </Panel>
                      </Collapse>
                    </Space>
                  </Timeline.Item>
                )}

                {metadata.httpRequest && (
                  <Timeline.Item
                    color={responseOk ? 'green' : 'red'}
                    dot={
                      responseOk ? (
                        <GatewayIcon name="CheckCircleOutlined" className="console-type-section" />
                      ) : (
                        <GatewayIcon name="ExclamationCircleOutlined" className="console-type-section" />
                      )
                    }
                  >
                    <Space direction="vertical" className="console-width-full" size="small">
                      <Text strong className="console-type-control">
                        Step 3: HTTP Request Sent
                      </Text>
                      <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2, xxl: 2 }} bordered>
                        <Descriptions.Item label="Method">
                          <Text code>{metadata.httpRequest.method}</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="URL">
                          <Text code className="console-type-caption">
                            {metadata.httpRequest.url}
                          </Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Response Status">
                          {hasResponseStatus ? renderHttpStatus(responseStatus) : <Text type="secondary">N/A</Text>}
                        </Descriptions.Item>
                        <Descriptions.Item label="Response Time">
                          {data.responseTimeMs ? `${data.responseTimeMs} ms` : 'N/A'}
                        </Descriptions.Item>
                      </Descriptions>

                      <Collapse size="small" ghost>
                        {hasCurlCommand && (
                          <Panel
                            header={
                              <Space>
                                <Text strong>cURL Command</Text>
                                <Button
                                  size="small"
                                  icon={<GatewayIcon name="CopyOutlined" />}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(curlCommand || '');
                                  }}
                                >
                                  Copy
                                </Button>
                              </Space>
                            }
                            key="curl"
                          >
                            <pre className="log-detail-code-preview log-detail-code-preview--curl log-detail-code-preview--compact">
                              {curlCommand}
                            </pre>
                          </Panel>
                        )}
                        <Panel header={<Text strong>Request Headers</Text>} key="headers">
                          <pre className="log-detail-code-preview log-detail-code-preview--compact">
                            {JSON.stringify(metadata.httpRequest.headers, null, 2)}
                          </pre>
                        </Panel>
                        <Panel header={<Text strong>Request Body</Text>} key="body">
                          <pre className="log-detail-code-preview log-detail-code-preview--compact">
                            {JSON.stringify(metadata.httpRequest.body, null, 2)}
                          </pre>
                        </Panel>
                      </Collapse>
                    </Space>
                  </Timeline.Item>
                )}

                {data.responseBody && (
                  <Timeline.Item color={responseOk ? 'green' : 'red'}>
                    <Space direction="vertical" className="console-width-full" size="small">
                      <Text strong className="console-type-control">
                        Step 4: Response Received
                      </Text>
                      <Collapse size="small" ghost>
                        <Panel
                          header={
                            <Space>
                              <Text strong>View Response</Text>
                              <Button
                                size="small"
                                icon={<GatewayIcon name="CopyOutlined" />}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(formatResponseBody(data.responseBody));
                                }}
                              >
                                Copy
                              </Button>
                            </Space>
                          }
                          key="response"
                        >
                          <pre className="log-detail-code-preview log-detail-code-preview--compact log-detail-code-preview--response">
                            {formatResponseBody(data.responseBody) || 'No response captured'}
                          </pre>
                        </Panel>
                      </Collapse>
                    </Space>
                  </Timeline.Item>
                )}

                {data.errorMessage && (
                  <Timeline.Item
                    color="red"
                    dot={<GatewayIcon name="ExclamationCircleOutlined" className="console-type-section" />}
                  >
                    <Space direction="vertical" className="console-width-full" size="small">
                      <Text strong style={{ fontSize: 'var(--console-type-control)', color: colors.error[600] }}>
                        Error Occurred
                      </Text>
                      <div
                        style={{
                          background: withAlpha(colors.error[100], 0.3),
                          padding: spacing[2],
                          borderRadius: token.borderRadiusLG,
                          border: `1px solid ${colors.error[300]}`,
                        }}
                      >
                        <Text type="danger">{data.errorMessage}</Text>
                        {metadata.errorContext && (
                          <div className="console-margin-top-2">
                            <Text type="secondary" className="console-display-block">
                              Failed at step: <Text strong>{metadata.errorContext.stage}</Text>
                            </Text>
                          </div>
                        )}
                      </div>
                    </Space>
                  </Timeline.Item>
                )}
              </Timeline>
            </Card>
          )}

          {/* Request & Response Details */}
          <Collapse>
            {hasHl7Details && (
              <Panel
                header={
                  <Title level={5} className="console-margin-none">
                    HL7 Message Details
                  </Title>
                }
                key="hl7"
              >
                <Hl7LogPanel
                  httpMethod={data.httpMethod}
                  metadata={metadata}
                  status={data.status}
                  errorMessage={data.errorMessage}
                  responseStatus={data.responseStatus}
                  responseTimeMs={data.responseTimeMs}
                  targetUrl={data.targetUrl}
                  createdAt={data.createdAt}
                  originalPayload={(data as any).originalPayload}
                  requestPayload={data.requestPayload}
                  responseBody={data.responseBody}
                  canReplay={['FAILED', 'ABANDONED'].includes(data.status)}
                  onReplayPayload={handleReplayWithPayload}
                />
              </Panel>
            )}

            <Panel
              header={
                <div className="console-flex-between-center">
                  <Title level={5} className="console-margin-none">
                    Request Details
                  </Title>
                  <Button
                    size="small"
                    icon={<GatewayIcon name="CopyOutlined" />}
                    onClick={() => copyToClipboard(JSON.stringify(data.requestPayload, null, 2))}
                  >
                    Copy JSON
                  </Button>
                </div>
              }
              key="request"
            >
              <Space direction="vertical" className="console-width-full" size="middle">
                <div>
                  <Title level={5}>Request Payload</Title>
                  <div className="console-position-relative">
                    <Button
                      size="small"
                      icon={<GatewayIcon name="CopyOutlined" />}
                      onClick={() => copyToClipboard(JSON.stringify(data.requestPayload, null, 2))}
                      className="console-position-absolute-inset-1"
                    />
                    <pre className="clamped-code-block log-detail-code-preview log-detail-code-preview--large log-detail-code-preview--copyable">
                      {JSON.stringify(data.requestPayload, null, 2)}
                    </pre>
                  </div>
                </div>

                {integration && data.direction === 'COMMUNICATION' ? (
                  <div>
                    <Title level={5}>Email Test cURL</Title>
                    <div className="console-position-relative">
                      <Button
                        size="small"
                        icon={<GatewayIcon name="CopyOutlined" />}
                        onClick={() => {
                          const payload = data.requestPayload as any;
                          const smtpConfig = integration?.actions?.[data.actionIndex ?? 0]?.communicationConfig?.smtp;
                          const resolvedFrom =
                            (data as any).metadata?.senderRouting?.senderProfile?.fromEmail ||
                            payload?.from ||
                            smtpConfig?.fromEmail;
                          const apiBase = getApiBaseUrl();
                          const integrationSlug = integration?.type || 'EMAIL';
                          const toVal = Array.isArray(payload?.to)
                            ? payload.to.join(', ')
                            : payload?.to || 'recipient@example.com';
                          const subjectVal = payload?.subject || 'Test Email';
                          const htmlVal = payload?.html || '<h1>Test</h1><p>This is a test email.</p>';
                          const bodyObj: any = { to: toVal, subject: subjectVal, html: htmlVal };
                          if (payload?.text) bodyObj.text = payload.text;
                          bodyObj.attachments = [
                            {
                              filename: 'document.pdf',
                              content: '<BASE64_ENCODED_PDF>',
                              encoding: 'base64',
                              contentType: 'application/pdf',
                            },
                          ];
                          const curl = [
                            `# From: ${resolvedFrom || 'SMTP'} → To: ${toVal}`,
                            `# Host: ${smtpConfig?.host || ''}:${smtpConfig?.port || ''}`,
                            `# Remove the "attachments" block if no PDF is needed`,
                            ``,
                            `curl --location '${apiBase}/integrations/${integrationSlug}?orgId=${orgId}' \\`,
                            `  --header 'X-API-Key: YOUR_API_KEY' \\`,
                            `  --header 'Content-Type: application/json' \\`,
                            `  --data-raw '${JSON.stringify(bodyObj, null, 2)}'`,
                          ].join('\n');
                          copyToClipboard(curl);
                        }}
                        className="console-overlay-copy-action"
                      >
                        Copy cURL
                      </Button>
                      <pre className="clamped-code-block log-detail-code-preview log-detail-code-preview--large log-detail-code-preview--curl">
                        {(() => {
                          const payload = data.requestPayload as any;
                          const smtpConfig = integration?.actions?.[data.actionIndex ?? 0]?.communicationConfig?.smtp;
                          const apiBase = getApiBaseUrl();
                          const integrationSlug = integration?.type || 'EMAIL';
                          const toVal = Array.isArray(payload?.to)
                            ? payload.to.join(', ')
                            : payload?.to || 'recipient@example.com';
                          const subjectVal = payload?.subject || 'Test Email';
                          const htmlVal = payload?.html || '<h1>Test</h1><p>This is a test email.</p>';
                          const bodyObj: any = { to: toVal, subject: subjectVal, html: htmlVal };
                          if (payload?.text) bodyObj.text = payload.text;
                          bodyObj.attachments = [
                            {
                              filename: 'document.pdf',
                              content: '<BASE64_ENCODED_PDF>',
                              encoding: 'base64',
                              contentType: 'application/pdf',
                            },
                          ];
                          return [
                            `# From: ${smtpConfig?.fromEmail || 'SMTP'} → To: ${toVal}`,
                            `# Host: ${smtpConfig?.host || ''}:${smtpConfig?.port || ''}`,
                            `# Remove the "attachments" block if no PDF is needed`,
                            ``,
                            `curl --location '${apiBase}/integrations/${integrationSlug}?orgId=${orgId}' \\`,
                            `  --header 'X-API-Key: YOUR_API_KEY' \\`,
                            `  --header 'Content-Type: application/json' \\`,
                            `  --data-raw '${JSON.stringify(bodyObj, null, 2)}'`,
                          ].join('\n');
                        })()}
                      </pre>
                    </div>
                  </div>
                ) : (
                  integration && (
                    <div>
                      <Title level={5}>cURL Command</Title>
                      <div className="console-position-relative">
                        <Button
                          size="small"
                          icon={<GatewayIcon name="CopyOutlined" />}
                          onClick={() =>
                            copyToClipboard(
                              generateCurlCommand(
                                integration,
                                data.requestPayload,
                                data.requestHeaders,
                                data.direction,
                                data.request
                              )
                            )
                          }
                          className="console-overlay-copy-action"
                        >
                          Copy cURL
                        </Button>
                        <pre className="clamped-code-block log-detail-code-preview log-detail-code-preview--medium log-detail-code-preview--curl">
                          {generateCurlCommand(
                            integration,
                            data.requestPayload,
                            data.requestHeaders,
                            data.direction,
                            data.request
                          )}
                        </pre>
                      </div>
                    </div>
                  )
                )}
              </Space>
            </Panel>

            <Panel
              header={
                <div className="console-flex-between-center">
                  <Title level={5} className="console-margin-none">
                    Response Details
                  </Title>
                  {data.responseBody && (
                    <Button
                      size="small"
                      icon={<GatewayIcon name="CopyOutlined" />}
                      onClick={() => copyToClipboard(formatResponseBody(data.responseBody))}
                    >
                      Copy Response
                    </Button>
                  )}
                </div>
              }
              key="response"
            >
              <Space direction="vertical" className="console-width-full" size="middle">
                <Descriptions column={1} bordered size="small">
                  {hasResponseStatus && (
                    <Descriptions.Item label="HTTP Status">{renderHttpStatus(responseStatus)}</Descriptions.Item>
                  )}
                  {data.responseTimeMs && (
                    <Descriptions.Item label="Response Time">{data.responseTimeMs} ms</Descriptions.Item>
                  )}
                  {data.errorMessage && (
                    <Descriptions.Item label="Error Message">
                      <Text type="danger" code>
                        {data.errorMessage}
                      </Text>
                    </Descriptions.Item>
                  )}
                </Descriptions>

                <div>
                  <Title level={5}>Response Body</Title>
                  <div className="console-position-relative">
                    {data.responseBody && (
                      <Button
                        size="small"
                        icon={<GatewayIcon name="CopyOutlined" />}
                        onClick={() => copyToClipboard(formatResponseBody(data.responseBody))}
                        className="console-position-absolute-inset-1"
                      />
                    )}
                    <pre
                      className="clamped-code-block log-detail-code-preview log-detail-code-preview--large log-detail-code-preview--response"
                      data-copyable={Boolean(data.responseBody)}
                    >
                      {formatResponseBody(data.responseBody) || 'No response captured'}
                    </pre>
                  </div>
                </div>
              </Space>
            </Panel>

            {/* Detailed Retry Timeline */}
            {data.retryAttempts && data.retryAttempts.length > 0 && (
              <Panel
                header={
                  <div className="console-flex-center-gap-2">
                    <Title level={5} className="console-margin-none">
                      Delivery Attempts Timeline
                    </Title>
                    <Text type="secondary">{data.retryAttempts.length} attempts</Text>
                    <StatusBadge status={data.status} label={`Final: ${data.status}`} />
                  </div>
                }
                key="retry-timeline"
              >
                <div className="log-detail-retry-summary">
                  <Space direction="vertical" size="small">
                    <Text strong>Delivery Summary:</Text>
                    <Space split={<Divider type="vertical" />}>
                      <Text>
                        Total Attempts: <Text>{data.attemptCount}</Text>
                      </Text>
                      <Text>
                        Duration:{' '}
                        {data.retryAttempts.length > 1
                          ? `${Math.round((new Date(data.retryAttempts[data.retryAttempts.length - 1].attemptedAt).getTime() - new Date(data.retryAttempts[0].attemptedAt).getTime()) / 1000)}s`
                          : 'N/A'}
                      </Text>
                      <Text>
                        Final Status: <StatusBadge status={data.status} />
                      </Text>
                    </Space>
                  </Space>
                </div>

                <Timeline
                  mode="left"
                  className="console-margin-top-3"
                  items={data.retryAttempts.map((attempt, index) => ({
                    key: attempt.attemptNumber,
                    children: <AttemptTimelineItem attempt={attempt} __KEEP_integrationConfig__={integration} />,
                  }))}
                />
              </Panel>
            )}

            {/* Legacy Retry Information Panel for logs without detailed attempts */}
            {!data.retryAttempts && data.attemptCount > 1 && (
              <Panel
                header={
                  <div className="console-flex-center-gap-2">
                    <Title level={5} className="console-margin-none">
                      Retry Information
                    </Title>
                    <Text type="secondary">{data.attemptCount} total attempts</Text>
                    <Text type="secondary">Legacy view</Text>
                  </div>
                }
                key="retries"
              >
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Total Attempts">
                    <Text>{data.attemptCount}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Final Status">
                    <StatusBadge status={data.status} />
                  </Descriptions.Item>
                  <Descriptions.Item label="Integration Max Retries">
                    {integration?.retryCount || 'N/A'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Retry Strategy">
                    <Text code>Exponential backoff with jitter</Text>
                  </Descriptions.Item>
                </Descriptions>

                <div className="console-margin-top-3">
                  <Text type="secondary">
                    <strong>Note:</strong> This log shows aggregated retry information. New logs will include detailed
                    information for each individual attempt with request/response details.
                  </Text>
                </div>
              </Panel>
            )}
          </Collapse>
        </Space>
      )}
    </PageTemplate>
  );
};
