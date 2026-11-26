import { useState, useEffect } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import type { ReactNode } from 'react';
import { Tab, TabList } from '@astryxdesign/core';
import { Modal, Timeline, Spin, Descriptions, Card, Space, Statistic } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { getExecutionLogTimeline, ExecutionLogTimeline } from '../../../services/api';
import { useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { StatePanel } from '../../../components/common/StatePanel';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Banner } from '@astryxdesign/core/Banner';

const { Text, Title } = Typography;

export interface TraceViewTab {
  key: string;
  label: string;
  children: ReactNode;
  endContent?: ReactNode;
}

export function TraceRequestResponseTabs({ items }: { items: TraceViewTab[] }) {
  const fallbackKey = items.find((item) => item.key === 'request')?.key || items[0]?.key;
  const [activeKey, setActiveKey] = useState(fallbackKey || '');
  const [visited, setVisited] = useState(() => new Set(fallbackKey ? [fallbackKey] : []));
  const selectedKey = items.some((item) => item.key === activeKey) ? activeKey : fallbackKey;

  useEffect(() => {
    if (selectedKey) {
      setActiveKey(selectedKey);
      setVisited((current) => new Set(current).add(selectedKey));
    }
  }, [selectedKey]);

  if (!selectedKey) return null;

  return (
    <div className="trace-viewer-tabs">
      <TabList
        aria-label="Trace request and response details"
        className="trace-viewer-tab-list"
        hasDivider
        onChange={setActiveKey}
        overflow="visible"
        role="tablist"
        size="md"
        value={selectedKey}
      >
        {items.map((item) => (
          <Tab
            key={item.key}
            id={`trace-view-${item.key}-tab`}
            value={item.key}
            label={item.label}
            panelId={`trace-view-${item.key}-panel`}
            endContent={item.endContent}
          />
        ))}
      </TabList>
      {items.map(
        (item) =>
          visited.has(item.key) && (
            <div
              key={item.key}
              id={`trace-view-${item.key}-panel`}
              role="tabpanel"
              aria-labelledby={`trace-view-${item.key}-tab`}
              hidden={selectedKey !== item.key}
              tabIndex={0}
            >
              {item.children}
            </div>
          )
      )}
    </div>
  );
}

interface TraceViewerProps {
  traceId: string;
  open: boolean;
  onClose: () => void;
}

export const TraceViewer = ({ traceId, open, onClose }: TraceViewerProps) => {
  const { spacing } = useDesignTokens();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExecutionLogTimeline | null>(null);

  useEffect(() => {
    if (open && traceId) {
      loadTrace();
    }
  }, [open, traceId]);

  const loadTrace = async () => {
    setLoading(true);
    setError(null);
    try {
      const timeline = await getExecutionLogTimeline(traceId);
      setData(timeline);
    } catch (err: any) {
      setError(err.message || 'Failed to load execution trace');
    } finally {
      setLoading(false);
    }
  };

  const normalizeStatus = (status: string) => (status || '').toString().toUpperCase();

  const getStatusIcon = (status: string) => {
    switch (normalizeStatus(status)) {
      case 'SUCCESS':
        return <GatewayIcon name="CheckCircleOutlined" className="console-text-success" />;
      case 'ERROR':
      case 'FAILED':
      case 'ABANDONED':
        return <GatewayIcon name="CloseCircleOutlined" className="console-text-error" />;
      case 'WARNING':
        return <GatewayIcon name="WarningOutlined" className="console-text-warning" />;
      case 'PENDING':
      case 'RETRYING':
        return <GatewayIcon name="SyncOutlined" spin className="console-text-accent" />;
      default:
        return <GatewayIcon name="ClockCircleOutlined" />;
    }
  };

  const renderStatus = (status: string) => {
    const normalized = normalizeStatus(status);
    const statusKey = normalized === 'ERROR' ? 'FAILED' : normalized;
    const label = statusKey === 'SUCCESS' ? 'Delivered' : statusKey.charAt(0) + statusKey.slice(1).toLowerCase();
    return (
      <StatusBadge
        status={statusKey}
        label={label}
        variant={statusKey === 'WARNING' ? 'warning' : undefined}
        size="small"
      />
    );
  };

  const renderHttpStatus = (statusCode: number) => (
    <Text code className={statusCode >= 400 ? 'console-text-error' : undefined}>
      {statusCode}
    </Text>
  );

  const formatDuration = (ms: number | null): string => {
    if (ms === null || ms === undefined) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatStageName = (name: string): string => {
    if (!name) return 'Unknown stage';
    return name
      .replace(/_/g, ' ')
      .replace(/:/g, ' - ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const renderTimeline = () => {
    if (!data) return null;

    const items = data.timeline.map((step, index) => ({
      dot: getStatusIcon(step.status),
      color:
        normalizeStatus(step.status) === 'SUCCESS'
          ? 'green'
          : normalizeStatus(step.status) === 'ERROR'
            ? 'red'
            : 'blue',
      children: (
        <div className="trace-step-content">
          <div className="trace-step-heading">
            <Text strong className="console-type-control">
              {formatStageName(step.name)}
            </Text>
            <Space size="small">
              {step.durationMs !== null && (
                <Text type="secondary" className="tabular-nums">
                  {formatDuration(step.durationMs)}
                </Text>
              )}
              {renderStatus(step.status)}
            </Space>
          </div>

          <Text type="secondary" className="console-type-caption">
            {new Date(step.timestamp).toLocaleString()}
          </Text>

          {step.error && (
            <Banner
              status="error"
              title={step.error.message}
              description={step.error.code ? `Error code: ${step.error.code}` : undefined}
              className="console-margin-top-2"
            />
          )}

          {step.metadata && Object.keys(step.metadata).length > 0 && (
            <Card size="small" className="trace-detail-card">
              <pre className="clamped-code-block console-code-scroll-caption console-code-reset-wrap">
                {JSON.stringify(step.metadata, null, 2)}
              </pre>
            </Card>
          )}

          {step.response && (
            <Card size="small" className="trace-detail-card">
              <Space direction="vertical" size={spacingToNumber(spacing[1])} className="console-width-full">
                {step.response.statusCode && (
                  <div>
                    <Text strong>Vendor Status: </Text>
                    {renderHttpStatus(step.response.statusCode)}
                  </div>
                )}
                {step.response.body && (
                  <div>
                    <Text strong>Vendor Response:</Text>
                    <pre className="clamped-code-block trace-code-block trace-code-block--compact">
                      {typeof step.response.body === 'string'
                        ? step.response.body
                        : JSON.stringify(step.response.body, null, 2)}
                    </pre>
                  </div>
                )}
              </Space>
            </Card>
          )}

          {step.gapMs !== null && step.gapMs > 0 && index < data.timeline.length - 1 && (
            <div className="trace-timeline-gap">
              <Text type="secondary" className="console-type-caption">
                ⏱ Gap: {formatDuration(step.gapMs)}
              </Text>
            </div>
          )}
        </div>
      ),
    }));

    return <Timeline mode="left" items={items} className="console-margin-top-4" />;
  };

  const renderSummary = () => {
    if (!data) return null;

    const { summary } = data;

    return (
      <Card className="console-margin-bottom-4">
        <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
          <div className="console-flex-between-center">
            <Title level={5} className="console-margin-none">
              Execution Summary
            </Title>
            {renderStatus(summary.status)}
          </div>

          <div className="trace-summary-grid">
            <Statistic
              title="Total Duration"
              value={formatDuration(summary.totalDuration)}
              prefix={<GatewayIcon name="ThunderboltOutlined" />}
              valueStyle={{ fontSize: 'var(--console-type-title)' }}
            />
            <Statistic
              title="Steps Executed"
              value={summary.stepCount}
              valueStyle={{ fontSize: 'var(--console-type-title)' }}
            />
            <Statistic
              title="Direction"
              value={summary.direction || 'N/A'}
              valueStyle={{ fontSize: 'var(--console-type-title)' }}
            />
            <Statistic
              title="Trigger Type"
              value={summary.triggerType || 'N/A'}
              valueStyle={{ fontSize: 'var(--console-type-title)' }}
            />
          </div>

          <Descriptions column={2} size="small">
            <Descriptions.Item label="Trace ID">
              <Text code copyable className="console-type-caption">
                {summary.traceId}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Started At">
              {summary.startedAt ? new Date(summary.startedAt).toLocaleString() : 'N/A'}
            </Descriptions.Item>
            {summary.finishedAt && (
              <Descriptions.Item label="Finished At">{new Date(summary.finishedAt).toLocaleString()}</Descriptions.Item>
            )}
            {summary.errorStep && (
              <Descriptions.Item label="Failed At Step">
                <Text code>{summary.errorStep}</Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        </Space>
      </Card>
    );
  };

  const renderRequestResponse = () => {
    if (!data) return null;

    const tabs: TraceViewTab[] = [
      {
        key: 'request',
        label: 'Request',
        children: data.request ? (
          <Card>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
              {data.request.url && (
                <div>
                  <Text strong>URL: </Text>
                  <Text code>
                    {data.request.method || 'POST'} {data.request.url}
                  </Text>
                </div>
              )}
              {data.request.headers && Object.keys(data.request.headers).length > 0 && (
                <div>
                  <Text strong>Headers:</Text>
                  <pre className="clamped-code-block trace-code-block">
                    {JSON.stringify(data.request.headers, null, 2)}
                  </pre>
                </div>
              )}
              {data.request.body && (
                <div>
                  <Text strong>Body:</Text>
                  <pre className="clamped-code-block trace-code-block trace-code-block--expanded">
                    {typeof data.request.body === 'string'
                      ? data.request.body
                      : JSON.stringify(data.request.body, null, 2)}
                  </pre>
                </div>
              )}
            </Space>
          </Card>
        ) : (
          <StatePanel size="compact" glyph="searching" title="No request data" />
        ),
      },
      {
        key: 'response',
        label: 'Response',
        children: data.response ? (
          <Card>
            <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
              {data.response.statusCode && (
                <div>
                  <Text strong>Status Code: </Text>
                  {renderHttpStatus(data.response.statusCode)}
                </div>
              )}
              {data.response.headers && Object.keys(data.response.headers).length > 0 && (
                <div>
                  <Text strong>Headers:</Text>
                  <pre className="clamped-code-block trace-code-block">
                    {JSON.stringify(data.response.headers, null, 2)}
                  </pre>
                </div>
              )}
              {data.response.body && (
                <div>
                  <Text strong>Body:</Text>
                  <pre className="clamped-code-block trace-code-block trace-code-block--expanded">
                    {typeof data.response.body === 'string'
                      ? data.response.body
                      : JSON.stringify(data.response.body, null, 2)}
                  </pre>
                </div>
              )}
            </Space>
          </Card>
        ) : (
          <StatePanel size="compact" glyph="searching" title="No response data" />
        ),
      },
    ];

    if (data.error) {
      tabs.push({
        key: 'error',
        label: 'Error Details',
        endContent: <GatewayIcon name="CloseCircleOutlined" aria-hidden="true" className="console-text-error" />,
        children: (
          <Banner
            status="error"
            title={data.error.message}
            description={
              <div className="console-margin-top-2">
                {data.error.code && (
                  <div>
                    <Text strong>Error Code: </Text>
                    <Text code>{data.error.code}</Text>
                  </div>
                )}
                {data.error.stack && (
                  <div className="console-margin-top-2">
                    <Text strong>Stack Trace:</Text>
                    <pre className="clamped-code-block trace-code-block trace-code-block--stack">
                      {data.error.stack}
                    </pre>
                  </div>
                )}
              </div>
            }
          />
        ),
      });
    }

    if (data.vendorResponses && data.vendorResponses.length > 0) {
      tabs.push({
        key: 'vendor-responses',
        label: 'Vendor Responses',
        children: (
          <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
            {data.vendorResponses.map((response, index) => (
              <Card key={`${response.stage}-${response.timestamp || index}`}>
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="Stage">{formatStageName(response.stage)}</Descriptions.Item>
                  <Descriptions.Item label="Status">{renderStatus(response.status)}</Descriptions.Item>
                  {response.timestamp && (
                    <Descriptions.Item label="Timestamp">
                      {new Date(response.timestamp).toLocaleString()}
                    </Descriptions.Item>
                  )}
                  {response.responseStatus !== null && response.responseStatus !== undefined && (
                    <Descriptions.Item label="Vendor HTTP Status">
                      {renderHttpStatus(response.responseStatus)}
                    </Descriptions.Item>
                  )}
                  {response.provider && <Descriptions.Item label="Provider">{response.provider}</Descriptions.Item>}
                  {response.channel && <Descriptions.Item label="Channel">{response.channel}</Descriptions.Item>}
                  {response.messageId && (
                    <Descriptions.Item label="Vendor Message ID">
                      <Text code copyable>
                        {response.messageId}
                      </Text>
                    </Descriptions.Item>
                  )}
                  {response.target && <Descriptions.Item label="Target">{response.target}</Descriptions.Item>}
                </Descriptions>
                {response.responseBody && (
                  <div className="console-margin-top-2">
                    <Text strong>Response Payload:</Text>
                    <pre className="clamped-code-block trace-code-block trace-code-block--compact">
                      {typeof response.responseBody === 'string'
                        ? response.responseBody
                        : JSON.stringify(response.responseBody, null, 2)}
                    </pre>
                  </div>
                )}
              </Card>
            ))}
          </Space>
        ),
      });
    }

    return <TraceRequestResponseTabs key={traceId} items={tabs} />;
  };

  return (
    <Modal
      title={
        <div className="console-flex-center-gap-2">
          <GatewayIcon name="ClockCircleOutlined" className="console-title-accent" />
          <span>Execution Trace Viewer</span>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={1000}
      footer={null}
      className="ui-extracted-725c5b902b"
    >
      {loading && (
        <div className="trace-loading-state">
          <Spin size="large" />
          <div className="console-margin-top-3">
            <Text type="secondary">Loading execution trace...</Text>
          </div>
        </div>
      )}

      {error && (
        <Banner
          status="error"
          title="Failed to load trace"
          description={error}
          isDismissable
          onDismiss={() => setError(null)}
        />
      )}

      {!loading && !error && data && (
        <div>
          {renderSummary()}

          <Card
            title="Execution Timeline"
            className="console-margin-bottom-4"
            styles={{ body: { maxHeight: 500, overflow: 'auto' } }}
          >
            {renderTimeline()}
          </Card>

          {renderRequestResponse()}
        </div>
      )}

      {!loading && !error && !data && <StatePanel size="compact" glyph="searching" title="No trace data" />}
    </Modal>
  );
};
