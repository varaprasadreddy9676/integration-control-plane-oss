import { Alert, Space, Tag, Typography } from 'antd';
import type { DeliveryFollowUp } from '../../../mocks/types';
import { formatDateTimeWithSeconds } from '../../../utils/format';
import { followUpStatusColor, followUpStatusLabel } from './followUpStatus';

const { Text } = Typography;

// Only the gateway's own statuses need explaining; any other word is the script's own.
const OWN_MEANING: Record<string, string> = {
  PENDING: 'The provider has not reported on this message yet.',
  UNKNOWN: 'No answer came before the last check.',
  NOT_TRACKED: 'This delivery is not being followed up.',
};

/** The follow-up outcome as a small tag, for the delivery list. Nothing when there is none to show. */
export const FollowUpTag = ({ followUp }: { followUp?: DeliveryFollowUp | null }) => {
  if (!followUp || followUp.status === 'NOT_TRACKED') return null;
  return (
    <Tag
      color={followUpStatusColor(followUp.status, followUp.done)}
      title={OWN_MEANING[followUp.status]}
      style={{ margin: 0 }}
    >
      {followUpStatusLabel(followUp.status)}
    </Tag>
  );
};

/** What became of an accepted send, at a glance. Each check's request and response are in the Follow-up tab. */
export const DeliveryFollowUpPanel = ({ followUp }: { followUp?: DeliveryFollowUp | null }) => {
  if (!followUp) return null;
  const when = (value?: string | null) => (value ? formatDateTimeWithSeconds(value) : null);

  return (
    <div
      aria-label="Delivery follow-up"
      style={{ border: '1px solid var(--border-subtle, #e5e7eb)', borderRadius: 8, padding: 12 }}
    >
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space wrap>
          <Text strong>Delivery follow-up</Text>
          <Tag color={followUpStatusColor(followUp.status, followUp.done)} style={{ margin: 0 }}>
            {followUpStatusLabel(followUp.status)}
          </Tag>
        </Space>
        {OWN_MEANING[followUp.status] && <Text type="secondary">{OWN_MEANING[followUp.status]}</Text>}

        {followUp.deliveredAt && <Text>Delivered {when(followUp.deliveredAt)}</Text>}
        {followUp.readAt && <Text>Read {when(followUp.readAt)}</Text>}

        {(followUp.errorCode || followUp.errorMessage) && (
          <Alert
            type="error"
            showIcon
            message={followUp.errorCode ? `Reason ${followUp.errorCode}` : 'Reason'}
            description={followUp.errorMessage || undefined}
          />
        )}
        {followUp.reason && <Text type="secondary">{followUp.reason}</Text>}
        {followUp.lastError && (
          <Alert type="warning" showIcon message="The last check did not complete" description={followUp.lastError} />
        )}

        <Text type="secondary" style={{ fontSize: 12 }}>
          {followUp.checks} {followUp.checks === 1 ? 'check' : 'checks'} so far
          {followUp.lastCheckedAt ? `, last ${when(followUp.lastCheckedAt)}` : ''}
          {!followUp.done && followUp.nextCheckAt ? `, next ${when(followUp.nextCheckAt)}` : ''}
          {followUp.done ? ', finished' : ''}
        </Text>
      </Space>
    </div>
  );
};
