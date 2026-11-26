import { Space, Tooltip } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import { StatusBadge } from '../../../../../components/common/StatusBadge';
import type { RequestPolicyConfig } from '../../../../../services/api';

const { Text } = Typography;

const getRateLimitLabel = (policy?: RequestPolicyConfig | null) => {
  if (!policy?.rateLimit?.enabled) return 'Rate off';
  const maxRequests = policy.rateLimit.maxRequests ?? 100;
  const windowSeconds = policy.rateLimit.windowSeconds ?? 60;
  return `${maxRequests}/${windowSeconds}s`;
};

interface RequestPolicySummaryProps {
  policy?: RequestPolicyConfig | null;
  compact?: boolean;
  emptyLabel?: string;
}

export const RequestPolicySummary = ({
  policy,
  compact = false,
  emptyLabel = 'No request policy',
}: RequestPolicySummaryProps) => {
  const ipCount = policy?.allowedIpCidrs?.length || 0;
  const originCount = policy?.allowedBrowserOrigins?.length || 0;
  const rateEnabled = policy?.rateLimit?.enabled === true;

  if (!ipCount && !originCount && !rateEnabled) {
    return compact ? (
      <Tooltip title="No IP/origin restrictions or rate limiting configured — accepts requests from any source">
        <span>
          <StatusBadge label="Open access" variant="warning" size="small" />
        </span>
      </Tooltip>
    ) : (
      <Text type="secondary">{emptyLabel}</Text>
    );
  }

  return (
    <Space size={compact ? 4 : 6} wrap>
      {ipCount > 0 && (
        <Tooltip title={policy?.allowedIpCidrs?.join(', ')}>
          <Text>
            {ipCount} IP rule{ipCount === 1 ? '' : 's'}
          </Text>
        </Tooltip>
      )}
      {originCount > 0 && (
        <Tooltip title={policy?.allowedBrowserOrigins?.join(', ')}>
          <Text>
            {originCount} origin{originCount === 1 ? '' : 's'}
          </Text>
        </Tooltip>
      )}
      {rateEnabled && <Text>{getRateLimitLabel(policy)}</Text>}
      {!compact && <Text type="secondary">Inbound request guardrails</Text>}
    </Space>
  );
};
