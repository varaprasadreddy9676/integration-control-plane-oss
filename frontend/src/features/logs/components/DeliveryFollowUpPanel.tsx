import { Space, Tooltip } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import { Banner } from '@astryxdesign/core/Banner';
import type { DeliveryFollowUp } from '../../../mocks/types';
import { formatDateTimeWithSeconds } from '../../../utils/format';
import { followUpStatusLabel, followUpStatusVariant } from './followUpStatus';
import { cssVar } from '../../../design-system/utils';
import { StatusBadge } from '../../../components/common/StatusBadge';

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
    <Tooltip title={OWN_MEANING[followUp.status]}>
      <span>
        <StatusBadge
          label={followUpStatusLabel(followUp.status)}
          variant={followUpStatusVariant(followUp.status, followUp.done)}
          showIcon={false}
        />
      </span>
    </Tooltip>
  );
};

/** What became of an accepted send, at a glance. Each check's request and response are in the Follow-up tab. */
export const DeliveryFollowUpPanel = ({ followUp }: { followUp?: DeliveryFollowUp | null }) => {
  if (!followUp) return null;
  const when = (value?: string | null) => (value ? formatDateTimeWithSeconds(value) : null);

  return (
    <div
      aria-label="Delivery follow-up"
      style={{ border: `1px solid ${cssVar.border.subtle}`, borderRadius: 4, padding: 'var(--spacing-3)' }}
    >
      <Space direction="vertical" size={6} className="console-width-full">
        <Space wrap>
          <Text strong>Delivery follow-up</Text>
          <StatusBadge
            label={followUpStatusLabel(followUp.status)}
            variant={followUpStatusVariant(followUp.status, followUp.done)}
            showIcon={false}
          />
        </Space>
        {OWN_MEANING[followUp.status] && <Text type="secondary">{OWN_MEANING[followUp.status]}</Text>}

        {followUp.deliveredAt && <Text>Delivered {when(followUp.deliveredAt)}</Text>}
        {followUp.readAt && <Text>Read {when(followUp.readAt)}</Text>}

        {(followUp.errorCode || followUp.errorMessage) && (
          <Banner
            status="error"
            title={followUp.errorCode ? `Reason ${followUp.errorCode}` : 'Reason'}
            description={followUp.errorMessage || undefined}
          />
        )}
        {followUp.reason && <Text type="secondary">{followUp.reason}</Text>}
        {followUp.lastError && (
          <Banner status="warning" title="The last check did not complete" description={followUp.lastError} />
        )}

        <Text type="secondary" className="console-type-caption">
          {followUp.checks} {followUp.checks === 1 ? 'check' : 'checks'} so far
          {followUp.lastCheckedAt ? `, last ${when(followUp.lastCheckedAt)}` : ''}
          {!followUp.done && followUp.nextCheckAt ? `, next ${when(followUp.nextCheckAt)}` : ''}
          {followUp.done ? ', finished' : ''}
        </Text>
      </Space>
    </div>
  );
};
