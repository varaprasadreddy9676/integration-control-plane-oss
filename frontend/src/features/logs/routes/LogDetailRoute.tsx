import { useState } from 'react';
import {
  Card,
  Descriptions,
  Space,
  Tag,
  Collapse,
  Typography,
  Button,
  message,
  Timeline,
  Divider,
  Skeleton,
} from 'antd';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CopyOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { PageHeader } from '../../../components/common/PageHeader';
import { getLogById, getIntegrationById, retryLog, getApiBaseUrl } from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { resolveGatewayUrl } from '../../../utils/curl';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { useDesignTokens, spacingToNumber, withAlpha, cssVar } from '../../../design-system/utils';
import { isCredentialField } from '../../../utils/curl';
import { DeliveryAttempt } from '../../../mocks/types';
import { useTenant } from '../../../app/tenant-context';
import { RequestPolicySummary } from '../../integrations/components/detail/shared/RequestPolicySummary';
import { Hl7LogPanel, isHl7LogLike } from '../components/Hl7LogPanel';

const { Panel } = Collapse;
const { Text, Title } = Typography;

export const LogDetailRoute = () => {
  const { spacing, token, borderRadius } = useDesignTokens();
  const colors = cssVar.legacy;
  const { id } = useParams();
  const navigate = useNavigate();
  const { orgId } = useTenant();
  const { data, isLoading, refetch } = useQuery({
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
        return <CheckCircleOutlined style={{ color: colors.success[600] }} />;
      case 'FAILED':
        return <ExclamationCircleOutlined style={{ color: colors.error[600] }} />;
      case 'RETRYING':
        return <LoadingOutlined style={{ color: colors.warning[600] }} />;
      default:
        return <ClockCircleOutlined style={{ color: colors.info[600] }} />;
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
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Title level={5} style={{ margin: 0, color: getAttemptColor(attempt) }}>
              Attempt {attempt.attemptNumber}
            </Title>
            <Tag
              color={attempt.status === 'SUCCESS' ? 'success' : attempt.status === 'FAILED' ? 'error' : 'processing'}
            >
              {attempt.status}
            </Tag>
          </Space>
          <Text type="secondary">{formatDateTime(attempt.attemptedAt)}</Text>
        </div>

        {attempt.retryReason && (
          <Text type="secondary" style={{ fontStyle: 'italic' }}>
            Reason: {attempt.retryReason}
          </Text>
        )}

        <Descriptions size="small" column={3} bordered>
          {attempt.responseStatus && (
            <Descriptions.Item label="HTTP Status">
              <Tag color={attempt.responseStatus >= 200 && attempt.responseStatus < 300 ? 'green' : 'red'}>
                {attempt.responseStatus}
              </Tag>
            </Descriptions.Item>
          )}
          {attempt.responseTimeMs && (
            <Descriptions.Item label="Response Time">{attempt.responseTimeMs} ms</Descriptions.Item>
          )}
          <Descriptions.Item label="Target">
            <Text code style={{ fontSize: '11px' }}>
              {attempt.targetUrl}
            </Text>
          </Descriptions.Item>
        </Descriptions>

        {attempt.errorMessage && (
          <div style={{ marginTop: spacing[1] }}>
            <Text type="danger" strong>
              Error:
            </Text>
            <Text code style={{ display: 'block', marginTop: spacing[0.5], fontSize: '12px' }}>
              {attempt.errorMessage}
            </Text>
          </div>
        )}

        <Collapse size="small" ghost>
          <Panel
            header={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>Request Details</Text>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
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
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div>
                <Text strong>cURL Command:</Text>
                <div style={{ position: 'relative' }}>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(generateCurlCommandForAttempt(attempt, __KEEP_integrationConfig__))}
                    style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                  />
                  <pre
                    style={{
                      background: 'var(--color-code-bg)',
                      color: 'var(--color-text-primary)',
                      padding: spacing[2],
                      paddingRight: spacing[5],
                      borderRadius: token.borderRadiusLG,
                      fontSize: '11px',
                      lineHeight: '1.4',
                      maxHeight: '150px',
                      overflow: 'auto',
                      fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                      marginTop: spacing[1],
                    }}
                  >
                    {generateCurlCommandForAttempt(attempt, __KEEP_integrationConfig__)}
                  </pre>
                </div>
              </div>

              <div>
                <Space>
                  <Text strong>Request Payload:</Text>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(JSON.stringify(attempt.requestPayload, null, 2))}
                  >
                    Copy JSON
                  </Button>
                </Space>
                <pre
                  style={{
                    background: withAlpha(token.colorTextBase, 0.06),
                    color: token.colorText,
                    padding: spacing[2],
                    borderRadius: token.borderRadiusLG,
                    fontSize: '11px',
                    lineHeight: '1.4',
                    maxHeight: '150px',
                    overflow: 'auto',
                    marginTop: spacing[1],
                  }}
                >
                  {JSON.stringify(attempt.requestPayload, null, 2)}
                </pre>
              </div>
            </Space>
          </Panel>

          <Panel
            header={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>Response Details</Text>
                {attempt.responseBody && (
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
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
              <div style={{ position: 'relative' }}>
                {attempt.responseBody && (
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(formatResponseBody(attempt.responseBody))}
                    style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                  />
                )}
                <pre
                  style={{
                    background: withAlpha(token.colorTextBase, 0.04),
                    color: token.colorText,
                    padding: spacing[2],
                    paddingRight: attempt.responseBody ? spacing[5] : spacing[2],
                    borderRadius: token.borderRadiusLG,
                    fontSize: '11px',
                    lineHeight: '1.4',
                    maxHeight: '150px',
                    overflow: 'auto',
                    marginTop: spacing[1],
                  }}
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

  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.4),
    background: withAlpha(base, 0.14),
    color: base,
    fontWeight: 700,
    paddingInline: spacing['2.5'],
    paddingBlock: spacing['0.5'],
  });

  return (
    <div>
      <PageHeader
        title="Delivery log"
        breadcrumb={[{ label: 'Logs', path: '/logs' }, { label: id ?? '' }]}
        compact
        actions={<Link to="/logs">Back to logs</Link>}
      />
      {isLoading || !data ? (
        <Space direction="vertical" style={{ width: '100%' }} size={spacingToNumber(spacing[3])}>
          <Card title="Overview" size="small">
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
          <Card title="Integration Configuration" size="small">
            <Skeleton active paragraph={{ rows: 5 }} />
          </Card>
          <Card title="Delivery Timeline" size="small">
            <Skeleton active paragraph={{ rows: 7 }} />
          </Card>
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={spacingToNumber(spacing[3])}>
          {/* Overview Card */}
          <Card title="Overview" size="small">
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Integration">{data.__KEEP_integrationName__}</Descriptions.Item>
              <Descriptions.Item label="Event type">{data.eventType}</Descriptions.Item>
              <Descriptions.Item label="Flow">
                {data.direction === 'OUTBOUND' && data.triggerType === 'SCHEDULED'
                  ? 'SCHEDULED'
                  : data.direction || 'OUTBOUND'}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <span
                  style={tagTone(
                    data.status === 'SUCCESS'
                      ? colors.success[600]
                      : data.status === 'FAILED'
                        ? colors.error[600]
                        : data.status === 'RETRYING'
                          ? colors.warning[600]
                          : colors.info[600]
                  )}
                >
                  {data.status}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="Attempt Count">
                <Tag color={data.attemptCount > 1 ? 'orange' : 'blue'}>
                  {data.attemptCount} {data.attemptCount === 1 ? 'attempt' : 'attempts'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Created">{formatDateTime(data.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Response status">
                {hasResponseStatus ? <Tag color={responseOk ? 'green' : 'red'}>{responseStatus}</Tag> : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Response time">
                {data.responseTimeMs ? `${data.responseTimeMs} ms` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Error Message">
                {data.errorMessage ? (
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
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
                  icon={<ReloadOutlined />}
                  onClick={() => navigate(`/integrations/${integration.id}`)}
                >
                  View Integration
                </Button>
              }
            >
              <Descriptions column={2} bordered size="small">
                <Descriptions.Item label="Target URL">{integration.targetUrl}</Descriptions.Item>
                <Descriptions.Item label="HTTP Method">
                  <Tag color="blue">{integration.httpMethod}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Authentication">
                  <Tag color={integration.outgoingAuthType === 'NONE' ? 'green' : 'orange'}>
                    {integration.outgoingAuthType}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Timeout">{integration.timeoutMs} ms</Descriptions.Item>
                <Descriptions.Item label="Max Retries">{integration.retryCount}</Descriptions.Item>
                <Descriptions.Item label="Active">
                  <Tag color={integration.isActive ? 'green' : 'red'}>{integration.isActive ? 'Yes' : 'No'}</Tag>
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
                      <Tag color="blue">{senderRoutingMetadata.routingDecision || 'resolved'}</Tag>
                      {senderRoutingMetadata.requestedFrom && (
                        <Tag>{`requested: ${senderRoutingMetadata.requestedFrom}`}</Tag>
                      )}
                      {senderRoutingMetadata.senderProfile?.fromEmail && (
                        <Tag color="green">{`resolved: ${senderRoutingMetadata.senderProfile.fromEmail}`}</Tag>
                      )}
                      {senderRoutingMetadata.senderProfile?.provider && (
                        <Tag>{senderRoutingMetadata.senderProfile.provider}</Tag>
                      )}
                      {senderRoutingMetadata.senderProfile?.isDefault && <Tag color="gold">Default profile</Tag>}
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
                  <Timeline.Item color="orange" dot={<ExclamationCircleOutlined style={{ fontSize: '16px' }} />}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>
                        Skipped
                      </Text>
                      <Text type="secondary">{scriptSkipReason}</Text>
                    </Space>
                  </Timeline.Item>
                )}

                {hasScriptLogs && (
                  <Timeline.Item
                    color={scriptLogs.some((l: any) => l.level === 'error') ? 'red' : 'blue'}
                    dot={<CodeOutlined style={{ fontSize: '16px' }} />}
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text strong style={{ fontSize: '14px' }}>
                          Script Console Output
                        </Text>
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
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
                        style={{
                          background: 'var(--color-code-bg)',
                          borderRadius: token.borderRadiusLG,
                          padding: spacing[2],
                          fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                          fontSize: '12px',
                          maxHeight: 320,
                          overflow: 'auto',
                        }}
                      >
                        {scriptLogs.map((entry: any, i: number) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              gap: spacing[2],
                              padding: '3px 0',
                              borderBottom: i < scriptLogs.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                            }}
                          >
                            <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, fontSize: '11px' }}>
                              {new Date(entry.ts).toLocaleTimeString()}
                            </span>
                            <span
                              style={{
                                color:
                                  entry.level === 'error' ? 'var(--color-error-text)' : entry.level === 'warn' ? 'var(--color-warning-text)' : 'var(--color-text-secondary)',
                                fontWeight: 600,
                                flexShrink: 0,
                                textTransform: 'uppercase',
                                fontSize: '10px',
                                minWidth: 36,
                              }}
                            >
                              {entry.level}
                            </span>
                            <span style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>{entry.message}</span>
                          </div>
                        ))}
                      </div>
                    </Space>
                  </Timeline.Item>
                )}

                {metadata.recordsFetched !== undefined && (
                  <Timeline.Item color="blue" dot={<CheckCircleOutlined style={{ fontSize: '16px' }} />}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>
                        Step 1: Data Fetched from Source
                      </Text>
                      <Text type="secondary">Retrieved {metadata.recordsFetched} record(s) from data source</Text>
                      {hasDataFetched && (
                        <Collapse size="small" ghost>
                          <Panel header={<Text strong>View Data</Text>} key="dataFetched">
                            <div style={{ position: 'relative' }}>
                              <Button
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={() => copyToClipboard(JSON.stringify(dataFetched, null, 2))}
                                style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                              />
                              <pre
                                style={{
                                  background: withAlpha(token.colorTextBase, 0.06),
                                  color: token.colorText,
                                  padding: spacing[2],
                                  paddingRight: spacing[5],
                                  borderRadius: token.borderRadiusLG,
                                  fontSize: '11px',
                                  lineHeight: '1.4',
                                  maxHeight: '200px',
                                  overflow: 'auto',
                                  marginTop: spacing[1],
                                }}
                              >
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
                  <Timeline.Item color="green" dot={<CheckCircleOutlined style={{ fontSize: '16px' }} />}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>
                        Step 2: Data Transformed
                      </Text>
                      <Text type="secondary">Applied transformation script to prepare payload for delivery</Text>
                      <Collapse size="small" ghost>
                        <Panel header={<Text strong>View Transformed Payload</Text>} key="transformed">
                          <div style={{ position: 'relative' }}>
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => copyToClipboard(JSON.stringify(transformedPayload, null, 2))}
                              style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                            />
                            <pre
                              style={{
                                background: withAlpha(token.colorTextBase, 0.06),
                                color: token.colorText,
                                padding: spacing[2],
                                paddingRight: spacing[5],
                                borderRadius: token.borderRadiusLG,
                                fontSize: '11px',
                                lineHeight: '1.4',
                                maxHeight: '200px',
                                overflow: 'auto',
                                marginTop: spacing[1],
                              }}
                            >
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
                        <CheckCircleOutlined style={{ fontSize: '16px' }} />
                      ) : (
                        <ExclamationCircleOutlined style={{ fontSize: '16px' }} />
                      )
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>
                        Step 3: HTTP Request Sent
                      </Text>
                      <Descriptions size="small" column={2} bordered>
                        <Descriptions.Item label="Method">
                          <Tag color="blue">{metadata.httpRequest.method}</Tag>
                        </Descriptions.Item>
                        <Descriptions.Item label="URL">
                          <Text code style={{ fontSize: '11px' }}>
                            {metadata.httpRequest.url}
                          </Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="Response Status">
                          <Tag color={responseOk ? 'green' : 'red'}>{hasResponseStatus ? responseStatus : 'N/A'}</Tag>
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
                                  icon={<CopyOutlined />}
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
                            <pre
                              style={{
                                background: 'var(--color-code-bg)',
                                color: 'var(--color-text-primary)',
                                padding: spacing[2],
                                borderRadius: token.borderRadiusLG,
                                fontSize: '11px',
                                lineHeight: '1.4',
                                maxHeight: '200px',
                                overflow: 'auto',
                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                              }}
                            >
                              {curlCommand}
                            </pre>
                          </Panel>
                        )}
                        <Panel header={<Text strong>Request Headers</Text>} key="headers">
                          <pre
                            style={{
                              background: withAlpha(token.colorTextBase, 0.06),
                              color: token.colorText,
                              padding: spacing[2],
                              borderRadius: token.borderRadiusLG,
                              fontSize: '11px',
                              lineHeight: '1.4',
                              maxHeight: '150px',
                              overflow: 'auto',
                            }}
                          >
                            {JSON.stringify(metadata.httpRequest.headers, null, 2)}
                          </pre>
                        </Panel>
                        <Panel header={<Text strong>Request Body</Text>} key="body">
                          <pre
                            style={{
                              background: withAlpha(token.colorTextBase, 0.06),
                              color: token.colorText,
                              padding: spacing[2],
                              borderRadius: token.borderRadiusLG,
                              fontSize: '11px',
                              lineHeight: '1.4',
                              maxHeight: '200px',
                              overflow: 'auto',
                            }}
                          >
                            {JSON.stringify(metadata.httpRequest.body, null, 2)}
                          </pre>
                        </Panel>
                      </Collapse>
                    </Space>
                  </Timeline.Item>
                )}

                {data.responseBody && (
                  <Timeline.Item color={responseOk ? 'green' : 'red'}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px' }}>
                        Step 4: Response Received
                      </Text>
                      <Collapse size="small" ghost>
                        <Panel
                          header={
                            <Space>
                              <Text strong>View Response</Text>
                              <Button
                                size="small"
                                icon={<CopyOutlined />}
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
                          <pre
                            style={{
                              background: withAlpha(token.colorTextBase, 0.04),
                              color: token.colorText,
                              padding: spacing[2],
                              borderRadius: token.borderRadiusLG,
                              fontSize: '11px',
                              lineHeight: '1.4',
                              maxHeight: '200px',
                              overflow: 'auto',
                            }}
                          >
                            {formatResponseBody(data.responseBody) || 'No response captured'}
                          </pre>
                        </Panel>
                      </Collapse>
                    </Space>
                  </Timeline.Item>
                )}

                {data.errorMessage && (
                  <Timeline.Item color="red" dot={<ExclamationCircleOutlined style={{ fontSize: '16px' }} />}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong style={{ fontSize: '14px', color: colors.error[600] }}>
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
                          <div style={{ marginTop: spacing[2] }}>
                            <Text type="secondary" style={{ display: 'block' }}>
                              Failed at stage: <Tag color="red">{metadata.errorContext.stage}</Tag>
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
                  <Title level={5} style={{ margin: 0 }}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Title level={5} style={{ margin: 0 }}>
                    Request Details
                  </Title>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(JSON.stringify(data.requestPayload, null, 2))}
                  >
                    Copy JSON
                  </Button>
                </div>
              }
              key="request"
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div>
                  <Title level={5}>Request Payload</Title>
                  <div style={{ position: 'relative' }}>
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(JSON.stringify(data.requestPayload, null, 2))}
                      style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                    />
                    <pre
                      className="clamped-code-block"
                      style={{
                        background: withAlpha(token.colorTextBase, 0.06),
                        color: token.colorText,
                        padding: spacing[3],
                        paddingRight: spacing[5],
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        fontSize: '12px',
                        lineHeight: '1.5',
                        maxHeight: '300px',
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(data.requestPayload, null, 2)}
                    </pre>
                  </div>
                </div>

                {integration && data.direction === 'COMMUNICATION' ? (
                  <div>
                    <Title level={5}>Email Test cURL</Title>
                    <div style={{ position: 'relative' }}>
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
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
                        style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                      >
                        Copy cURL
                      </Button>
                      <pre
                        className="clamped-code-block"
                        style={{
                          background: 'var(--color-code-bg)',
                          color: 'var(--color-text-primary)',
                          padding: spacing[3],
                          borderRadius: token.borderRadiusLG,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          fontSize: '12px',
                          lineHeight: '1.5',
                          maxHeight: '300px',
                          overflow: 'auto',
                          fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                        }}
                      >
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
                      <div style={{ position: 'relative' }}>
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
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
                          style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
                        >
                          Copy cURL
                        </Button>
                        <pre
                          className="clamped-code-block"
                          style={{
                            background: 'var(--color-code-bg)',
                            color: 'var(--color-text-primary)',
                            padding: spacing[3],
                            borderRadius: token.borderRadiusLG,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            fontSize: '12px',
                            lineHeight: '1.5',
                            maxHeight: '200px',
                            overflow: 'auto',
                            fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                          }}
                        >
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Title level={5} style={{ margin: 0 }}>
                    Response Details
                  </Title>
                  {data.responseBody && (
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(formatResponseBody(data.responseBody))}
                    >
                      Copy Response
                    </Button>
                  )}
                </div>
              }
              key="response"
            >
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Descriptions column={1} bordered size="small">
                  {hasResponseStatus && (
                    <Descriptions.Item label="HTTP Status">
                      <Tag color={responseOk ? 'green' : 'red'}>{responseStatus}</Tag>
                    </Descriptions.Item>
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
                  <div style={{ position: 'relative' }}>
                    {data.responseBody && (
                      <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => copyToClipboard(formatResponseBody(data.responseBody))}
                        style={{ position: 'absolute', top: spacing[1], right: spacing[1], zIndex: 1 }}
                      />
                    )}
                    <pre
                      className="clamped-code-block"
                      style={{
                        background: withAlpha(token.colorTextBase, 0.04),
                        color: token.colorText,
                        padding: spacing[3],
                        paddingRight: data.responseBody ? spacing[5] : spacing[3],
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        fontSize: '12px',
                        lineHeight: '1.5',
                        maxHeight: '300px',
                        overflow: 'auto',
                      }}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                    <Title level={5} style={{ margin: 0 }}>
                      Delivery Attempts Timeline
                    </Title>
                    <Tag color="blue">{data.retryAttempts.length} attempts</Tag>
                    <Tag
                      color={data.status === 'SUCCESS' ? 'success' : data.status === 'FAILED' ? 'error' : 'processing'}
                    >
                      Final: {data.status}
                    </Tag>
                  </div>
                }
                key="retry-timeline"
              >
                <div
                  style={{
                    background: withAlpha(colors.info[100], 0.3),
                    padding: spacing[3],
                    borderRadius: token.borderRadiusLG,
                    marginBottom: spacing[3],
                  }}
                >
                  <Space direction="vertical" size="small">
                    <Text strong>Delivery Summary:</Text>
                    <Space split={<Divider type="vertical" />}>
                      <Text>
                        Total Attempts: <Tag color="blue">{data.attemptCount}</Tag>
                      </Text>
                      <Text>
                        Duration:{' '}
                        {data.retryAttempts.length > 1
                          ? `${Math.round((new Date(data.retryAttempts[data.retryAttempts.length - 1].attemptedAt).getTime() - new Date(data.retryAttempts[0].attemptedAt).getTime()) / 1000)}s`
                          : 'N/A'}
                      </Text>
                      <Text>
                        Final Status: <Tag color={data.status === 'SUCCESS' ? 'success' : 'error'}>{data.status}</Tag>
                      </Text>
                    </Space>
                  </Space>
                </div>

                <Timeline
                  mode="left"
                  style={{ marginTop: spacing[3] }}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
                    <Title level={5} style={{ margin: 0 }}>
                      Retry Information
                    </Title>
                    <Tag color="orange">{data.attemptCount} total attempts</Tag>
                    <Tag color="default">Legacy View</Tag>
                  </div>
                }
                key="retries"
              >
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Total Attempts">
                    <Tag color="orange">{data.attemptCount}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Final Status">
                    <span
                      style={tagTone(
                        data.status === 'SUCCESS'
                          ? colors.success[600]
                          : data.status === 'FAILED'
                            ? colors.error[600]
                            : colors.warning[600]
                      )}
                    >
                      {data.status}
                    </span>
                  </Descriptions.Item>
                  <Descriptions.Item label="Integration Max Retries">
                    {integration?.retryCount || 'N/A'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Retry Strategy">
                    <Text code>Exponential backoff with jitter</Text>
                  </Descriptions.Item>
                </Descriptions>

                <div style={{ marginTop: spacing[3] }}>
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
    </div>
  );
};
