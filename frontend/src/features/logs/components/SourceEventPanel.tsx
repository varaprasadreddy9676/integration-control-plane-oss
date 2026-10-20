import { Alert, Button, Skeleton, Tag, Typography } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { APIError, getEventAuditById } from '../../../services/api';
import { buildUrlWithOrgId } from '../../../utils/navigation';
import { formatDateTimeWithSeconds } from '../../../utils/format';
import { cssVar, useDesignTokens } from '../../../design-system/utils';

const { Text } = Typography;

const STATUS_COLOR: Record<string, string> = {
  RECEIVED: 'processing',
  PROCESSING: 'processing',
  DELIVERED: 'success',
  SKIPPED: 'warning',
  FAILED: 'error',
  STUCK: 'error',
};

/**
 * A delivery log's `messageId` is the id of the event that triggered it
 * (the Event Audit `eventId`). Replay logs carry synthetic `replay_*` ids and
 * have no source event.
 */
/**
 * A source event is the event the gateway pulled from the event source and delivered onward.
 * Inbound calls (their messageId is just the request id) and script jobs never come from one.
 */
export const hasSourceEvent = (log: { messageId?: string | null; direction?: string | null }): boolean =>
  Boolean(log.messageId) &&
  !String(log.messageId).startsWith('replay_') &&
  log.direction !== 'INBOUND' &&
  log.direction !== 'SCRIPT_JOB';

const formatJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

interface SourceEventPanelProps {
  messageId: string;
  /** The delivery log's own copy of the event payload, used when Event Audit stored none. */
  fallbackPayload?: unknown;
}

export const SourceEventPanel = ({ messageId, fallbackPayload }: SourceEventPanelProps) => {
  const { spacing, token } = useDesignTokens();
  // Same key as the Event Audit page so both screens share one cache entry.
  const {
    data: event,
    error,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['event-audit-detail', messageId],
    queryFn: () => getEventAuditById(messageId),
    retry: false,
  });

  if (isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;

  if (error) {
    if (error instanceof APIError && error.statusCode === 404) {
      return (
        <Alert
          type="info"
          showIcon
          message="Source event is no longer available"
          description="The event audit record for this delivery has aged out of retention."
        />
      );
    }
    return (
      <Alert
        type="error"
        showIcon
        message="Couldn't load the source event"
        action={
          <Button size="small" onClick={() => refetch()}>
            Retry
          </Button>
        }
      />
    );
  }
  if (!event) return null;

  const auditPayload =
    event.payload ?? (event.payloadSummary && Object.keys(event.payloadSummary).length ? event.payloadSummary : null);
  // Event Audit keeps no payload unless eventAudit.storeFullPayload is on, but the
  // delivery log carries its own copy of the event it was triggered by.
  const usingFallback = auditPayload === null && fallbackPayload !== null && fallbackPayload !== undefined;
  const payloadValue = usingFallback ? fallbackPayload : auditPayload;
  const payloadText = payloadValue !== null && payloadValue !== undefined ? formatJson(payloadValue) : '';
  const auditUrl = buildUrlWithOrgId(`/events?eventId=${encodeURIComponent(event.eventId)}`);
  const rows: Array<[string, React.ReactNode]> = [
    ['Event type', <Text strong>{event.eventType}</Text>],
    ['Source', event.source],
    ['Received', event.receivedAt ? formatDateTimeWithSeconds(event.receivedAt) : '—'],
    ['Status', <Tag color={STATUS_COLOR[event.status ?? ''] || 'default'}>{event.status}</Tag>],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: `${spacing[1]} ${spacing[3]}` }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <Text type="secondary">{label}</Text>
            <span>{value}</span>
          </div>
        ))}
      </div>
      {event.skipReason && <Alert type="warning" showIcon message={event.skipReason} />}
      {usingFallback && <Text type="secondary">Payload shown from this delivery's record.</Text>}
      {payloadText ? (
        <pre
          tabIndex={0}
          style={{
            margin: 0,
            maxHeight: 320,
            overflow: 'auto',
            padding: spacing[3],
            fontSize: 12,
            borderRadius: token.borderRadius,
            border: `1px solid ${cssVar.border.default}`,
            background: cssVar.bg.surface,
          }}
        >
          {payloadText}
        </pre>
      ) : (
        <Text type="secondary">No payload captured for this event.</Text>
      )}
      <Link to={auditUrl}>
        <LinkOutlined /> Open in Event Audit
      </Link>
    </div>
  );
};
