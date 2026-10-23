import { Alert, Space, Tag, Typography } from 'antd';
import type { DeliveryFollowUp, FollowUpStatus } from '../../../mocks/types';
import { formatDateTimeWithSeconds } from '../../../utils/format';

const { Text } = Typography;

const LABEL: Record<FollowUpStatus, string> = {
  PENDING: 'Checking',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Not delivered',
  UNKNOWN: 'Unknown',
  NOT_TRACKED: 'Not tracked',
};

const COLOR: Record<FollowUpStatus, string> = {
  PENDING: 'default',
  SENT: 'blue',
  DELIVERED: 'green',
  READ: 'green',
  FAILED: 'red',
  UNKNOWN: 'orange',
  NOT_TRACKED: 'default',
};

const MEANING: Record<FollowUpStatus, string> = {
  PENDING: 'The provider has not reported on this message yet.',
  SENT: 'The provider has sent the message on; it has not reached the phone yet.',
  DELIVERED: 'The message reached the recipient.',
  READ: 'The recipient has read the message.',
  FAILED: 'The provider reported that the message could not be delivered.',
  UNKNOWN: 'No answer came before the last check. The message may or may not have arrived.',
  NOT_TRACKED: 'This delivery is not being followed up.',
};

/** The follow-up outcome as a small tag, for the delivery list. Nothing when there is none to show. */
export const FollowUpTag = ({ followUp }: { followUp?: DeliveryFollowUp | null }) => {
  if (!followUp || followUp.status === 'NOT_TRACKED') return null;
  return (
    <Tag color={COLOR[followUp.status]} title={MEANING[followUp.status]} style={{ margin: 0 }}>
      {LABEL[followUp.status]}
    </Tag>
  );
};

/** What became of an accepted send, for the delivery detail. */
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
          <Tag color={COLOR[followUp.status]} style={{ margin: 0 }}>
            {LABEL[followUp.status]}
          </Tag>
        </Space>
        <Text type="secondary">{MEANING[followUp.status]}</Text>

        {followUp.deliveredAt && <Text>Delivered {when(followUp.deliveredAt)}</Text>}
        {followUp.readAt && <Text>Read {when(followUp.readAt)}</Text>}

        {followUp.status === 'FAILED' && (followUp.errorCode || followUp.errorMessage) && (
          <Alert
            type="error"
            showIcon
            message={followUp.errorCode ? `Error ${followUp.errorCode}` : 'Delivery failed'}
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
