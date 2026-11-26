import { useMemo } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import { Drawer, Space, Divider, Timeline, Card, Collapse } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { Link } from 'react-router-dom';
import type { EventAuditRecord } from '../../../mocks/types';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../design-system/utils';
import { formatDateTime, formatDateTimeWithSeconds } from '../../../utils/format';
import { useNavigateWithParams, buildUrlWithOrgId } from '../../../utils/navigation';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { Button } from '../../../components/common/LegacyButton';
import { getStatusLabel, StatusBadge } from '../../../components/common/StatusBadge';

const { Text, Title } = Typography;

interface EventAuditDrawerProps {
  event: EventAuditRecord | null;
  open: boolean;
  onClose: () => void;
}

export const EventAuditDrawer = ({ event, open, onClose }: EventAuditDrawerProps) => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const navigate = useNavigateWithParams();

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  };

  const timelineItems = useMemo(() => {
    if (!event?.timeline || event.timeline.length === 0) return [];
    const sorted = [...event.timeline]
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .map((entry, index, all) => {
        const prev = all[index - 1];
        const deltaMs = prev ? new Date(entry.ts).getTime() - new Date(prev.ts).getTime() : null;
        return {
          color:
            entry.stage === 'FAILED' || entry.stage === 'STUCK'
              ? colors.error[500]
              : entry.stage === 'DELIVERED'
                ? colors.success[500]
                : entry.stage === 'SKIPPED'
                  ? colors.warning[500]
                  : colors.primary[500],
          dot:
            entry.stage === 'DELIVERED' ? (
              <GatewayIcon name="CheckCircleOutlined" />
            ) : entry.stage === 'FAILED' || entry.stage === 'STUCK' ? (
              <GatewayIcon name="CloseCircleOutlined" />
            ) : entry.stage === 'SKIPPED' ? (
              <GatewayIcon name="WarningOutlined" />
            ) : (
              <GatewayIcon name="ClockCircleOutlined" />
            ),
          children: (
            <div className="event-audit-timeline-item" data-testid="event-audit-timeline-item">
              <Space size={spacingToNumber(spacing[2])} align="center" wrap>
                <Text type="supporting" color="secondary" weight="semibold">
                  {getStatusLabel(entry.stage)}
                </Text>
                <Text type="secondary" className="console-type-caption">
                  {formatDateTimeWithSeconds(entry.ts)}
                </Text>
                {deltaMs !== null && deltaMs >= 0 && (
                  <Text type="supporting" color="secondary">
                    +{formatDuration(deltaMs)}
                  </Text>
                )}
              </Space>
              {entry.details && (
                <Typography.Paragraph
                  className="console-margin-top-1 console-type-caption console-margin-bottom-0"
                  ellipsis={{ rows: 2, expandable: true, symbol: 'More' }}
                >
                  {entry.details}
                </Typography.Paragraph>
              )}
            </div>
          ),
        };
      });
    return sorted;
  }, [event?.timeline, colors, spacing]);

  if (!event) return null;

  const delivery = event.deliveryStatus || {};
  const processedAt = event.processedAt || event.processingCompletedAt;

  const handleCopy = (value?: string) => {
    if (!value) return;
    void copyTextToClipboard(value);
  };

  const formatJson = (value: unknown) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return String(value);
    }
  };

  const hasFullPayload = event.payload !== undefined && event.payload !== null;
  const hasSummaryPayload = Boolean(event.payloadSummary && Object.keys(event.payloadSummary).length > 0);
  const payloadValue = hasFullPayload ? event.payload : hasSummaryPayload ? event.payloadSummary : null;
  const payloadText = payloadValue !== null && payloadValue !== undefined ? formatJson(payloadValue) : '';

  return (
    <Drawer
      title={
        <Space size={spacingToNumber(spacing[2])}>
          <GatewayIcon name="WarningOutlined" className="console-text-accent" />
          <span>Event Audit</span>
        </Space>
      }
      placement="right"
      width={760}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Button type="text" icon={<GatewayIcon name="CopyOutlined" />} onClick={() => handleCopy(event.eventId)}>
            Copy Event ID
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={spacingToNumber(spacing[4])} className="console-width-full">
        <Card className="event-audit-card" styles={{ body: { padding: spacing[4] } }}>
          <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
            <div className="event-audit-summary-row">
              <div>
                <Text type="secondary" className="console-type-caption">
                  Event ID
                </Text>
                <div className="console-font-mono console-type-caption">{event.eventId}</div>
              </div>
              <div>
                <Text type="secondary" className="console-type-caption">
                  Status
                </Text>
                <div>
                  <StatusBadge
                    label={getStatusLabel(event.status || 'RECEIVED')}
                    status={
                      event.status === 'DELIVERED'
                        ? 'SUCCESS'
                        : event.status === 'SKIPPED'
                          ? 'SKIPPED'
                          : event.status === 'FAILED' || event.status === 'STUCK'
                            ? 'FAILED'
                            : 'PENDING'
                    }
                  />
                </div>
              </div>
              <div>
                <Text type="secondary" className="console-type-caption">
                  Event Type
                </Text>
                <div className="console-font-weight-semibold">{event.eventType || '—'}</div>
              </div>
              <div>
                <Text type="secondary" className="console-type-caption">
                  Source
                </Text>
                <div>
                  {event.source || '—'} {event.sourceId ? `(${event.sourceId})` : ''}
                </div>
              </div>
            </div>

            <Divider className="console-margin-y-2" />

            <div className="event-audit-metadata-grid">
              <div>
                <Text type="secondary" className="console-type-caption">
                  Received
                </Text>
                <div>{event.receivedAt ? formatDateTime(event.receivedAt) : '—'}</div>
              </div>
              <div>
                <Text type="secondary" className="console-type-caption">
                  Processed
                </Text>
                <div>{processedAt ? formatDateTime(processedAt) : '—'}</div>
              </div>
              <div>
                <Text type="secondary" className="console-type-caption">
                  Processing Time
                </Text>
                <div>{typeof event.processingTimeMs === 'number' ? `${event.processingTimeMs} ms` : '—'}</div>
              </div>
              <div>
                <Text type="secondary" className="console-type-caption">
                  Delivery
                </Text>
                <div>
                  {delivery.integrationsMatched ?? 0} matched · {delivery.deliveredCount ?? 0} ok ·{' '}
                  {delivery.failedCount ?? 0} failed
                </div>
                {delivery.deliveryLogIds && delivery.deliveryLogIds.length > 0 && (
                  <Space size={spacingToNumber(spacing[1])} className="event-audit-log-links">
                    {delivery.deliveryLogIds.map((logId) => (
                      <Link
                        key={logId}
                        to={buildUrlWithOrgId(`/logs/${logId}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="console-type-caption"
                      >
                        View log {logId}
                      </Link>
                    ))}
                  </Space>
                )}
              </div>
            </div>

            {(event.skipCategory || event.skipReason || event.errorMessage) && (
              <div className="console-margin-top-2">
                <Text type="secondary" className="console-type-caption">
                  Skip / Failure
                </Text>
                <div className="event-audit-failure-detail">
                  {event.skipCategory && (
                    <Text type="supporting" color="secondary">
                      {event.skipCategory}
                    </Text>
                  )}
                  <Text strong className="console-text-error">
                    {event.skipReason || event.errorMessage || '—'}
                  </Text>
                </div>
                {event.errorStack && (
                  <Collapse
                    ghost
                    size="small"
                    className="console-margin-top-2"
                    items={[
                      {
                        key: 'error-details',
                        label: (
                          <Space size={spacingToNumber(spacing[1])}>
                            <GatewayIcon name="ExclamationCircleOutlined" className="console-text-error" />
                            <Text type="secondary" className="console-type-caption">
                              View Error Stack Trace
                            </Text>
                          </Space>
                        ),
                        children: (
                          <Card size="small" className="event-audit-error-card">
                            <pre className="event-audit-error-stack">{event.errorStack}</pre>
                          </Card>
                        ),
                      },
                    ]}
                  />
                )}
              </div>
            )}
          </Space>
        </Card>

        <div>
          <Title level={5} className="console-margin-bottom-2">
            Timeline
          </Title>
          {timelineItems.length > 0 ? (
            <Timeline items={timelineItems} />
          ) : (
            <Text type="secondary">No timeline data available.</Text>
          )}
        </div>

        <div>
          <div className="event-audit-payload-heading">
            <Title level={5} className="console-margin-none">
              Payload
            </Title>
            <Button
              size="small"
              icon={<GatewayIcon name="CopyOutlined" />}
              onClick={() => handleCopy(payloadText)}
              disabled={!payloadText}
            >
              Copy Payload
            </Button>
          </div>
          <div className="console-margin-top-2">
            <Card className="event-audit-card" styles={{ body: { padding: spacing[3] } }}>
              {payloadText ? (
                <>
                  {!hasFullPayload && hasSummaryPayload && (
                    <Text
                      type="secondary"
                      className="console-type-caption console-display-block console-margin-bottom-2"
                    >
                      Full payload not stored. Showing summary only.
                    </Text>
                  )}
                  <pre className="clamped-code-block console-type-caption event-audit-payload-code">{payloadText}</pre>
                </>
              ) : (
                <Text type="secondary">No payload captured for this event.</Text>
              )}
            </Card>
          </div>
        </div>
      </Space>
    </Drawer>
  );
};
