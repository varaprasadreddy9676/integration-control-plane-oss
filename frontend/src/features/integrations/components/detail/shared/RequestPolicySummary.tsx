import { Space, Tag, Tooltip, Typography } from 'antd';
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
        <Tag color="orange">Open access</Tag>
      </Tooltip>
    ) : (
      <Text type="secondary">{emptyLabel}</Text>
    );
  }

  return (
    <Space size={compact ? 4 : 6} wrap>
      {ipCount > 0 && (
        <Tooltip title={policy?.allowedIpCidrs?.join(', ')}>
          <Tag color="blue">
            {ipCount} IP rule{ipCount === 1 ? '' : 's'}
          </Tag>
        </Tooltip>
      )}
      {originCount > 0 && (
        <Tooltip title={policy?.allowedBrowserOrigins?.join(', ')}>
          <Tag color="gold">
            {originCount} origin{originCount === 1 ? '' : 's'}
          </Tag>
        </Tooltip>
      )}
      {rateEnabled && <Tag color="purple">{getRateLimitLabel(policy)}</Tag>}
      {!compact && <Text type="secondary">Inbound request guardrails</Text>}
    </Space>
  );
};
