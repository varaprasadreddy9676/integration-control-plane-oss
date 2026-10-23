import { Typography } from 'antd';
import type { DeliveryFollowUpStats } from '../../../services/api';

const { Text } = Typography;

/**
 * One line under the delivery counts: of the sends that are followed up, how
 * many were delivered, read or failed. Shows nothing until something is tracked.
 */
export const DeliveryFollowUpSummary = ({ stats }: { stats?: DeliveryFollowUpStats | null }) => {
  if (!stats || stats.tracked === 0) return null;
  const percent = (count: number) => `${Math.round((count / stats.tracked) * 100)}%`;
  const topError = stats.topErrors[0];

  return (
    <div style={{ marginTop: 8 }} aria-label="Delivery follow-up summary">
      <Text type="secondary" style={{ fontSize: 12 }}>
        Delivery reports for {stats.tracked.toLocaleString()} {stats.tracked === 1 ? 'message' : 'messages'}:{' '}
        <strong>{stats.delivered.toLocaleString()} delivered ({percent(stats.delivered)})</strong>
        {' · '}
        {stats.read.toLocaleString()} read ({percent(stats.read)})
        {' · '}
        <span style={{ color: stats.failed > 0 ? 'var(--error-text, #b91c1c)' : undefined }}>
          {stats.failed.toLocaleString()} not delivered
        </span>
        {stats.pending > 0 && ` · ${stats.pending.toLocaleString()} still being checked`}
        {stats.unknown > 0 && ` · ${stats.unknown.toLocaleString()} unknown`}
        {topError && stats.failed > 0 && (
          <>
            {' · most common reason: '}
            {[topError.code, topError.message].filter(Boolean).join(' ') || 'not given'} ({topError.count})
          </>
        )}
      </Text>
    </div>
  );
};
