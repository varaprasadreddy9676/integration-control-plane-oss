import { Text } from '@astryxdesign/core/Text';
import type { DeliveryFollowUpStats } from '../../../services/api';
import { followUpStatusLabel } from './followUpStatus';

/**
 * One line of results for the integration being looked at: how many messages
 * ended up in each status, in the words that integration's script uses.
 * Shows nothing until something is followed up.
 */
export const DeliveryFollowUpSummary = ({ stats }: { stats?: DeliveryFollowUpStats | null }) => {
  if (!stats || stats.tracked === 0) return null;
  const parts = Object.entries(stats.byStatus)
    .filter(([status, count]) => status !== 'NOT_TRACKED' && count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${followUpStatusLabel(status)} ${count.toLocaleString()}`);
  const topError = stats.topErrors[0];

  return (
    <div className="console-margin-top-2" aria-label="Follow-up results">
      <Text color="secondary" className="console-type-caption">
        Follow-up results for {stats.tracked.toLocaleString()} {stats.tracked === 1 ? 'message' : 'messages'}:{' '}
        <strong>{parts.join(' · ')}</strong>
        {topError && (
          <>
            {' · most common reason: '}
            {[topError.code, topError.message].filter(Boolean).join(' ') || 'not given'} ({topError.count})
          </>
        )}
      </Text>
    </div>
  );
};
