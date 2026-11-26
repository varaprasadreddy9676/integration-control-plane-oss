import { Tooltip } from "@/components/common/LegacyAntdControls";
import { StatusBadge } from '../../../../../components/common/StatusBadge';

interface SecureBadgeProps {
  type?: 'encrypted' | 'masked' | 'secure';
  tooltip?: string;
  size?: 'small' | 'default';
}

export const SecureBadge = ({ type = 'secure', tooltip }: SecureBadgeProps) => {
  const text = type === 'encrypted' ? 'Encrypted' : type === 'masked' ? 'Last 4 shown' : 'Stored securely';
  const description = tooltip || (type === 'masked'
    ? 'Only the last 4 characters are shown for security'
    : type === 'encrypted'
      ? 'This value is encrypted before storage'
      : 'This sensitive value is encrypted and stored securely');

  return (
    <Tooltip title={description} placement="right">
      <span className="console-margin-left-2">
        <StatusBadge label={text} variant={type === 'masked' ? 'neutral' : 'success'} showIcon={false} />
      </span>
    </Tooltip>
  );
};

/**
 * Wrapper component to add secure badge to Form.Item labels
 */
interface SecureLabelProps {
  label: string;
  badgeType?: 'encrypted' | 'masked' | 'secure';
  badgeTooltip?: string;
}

export const SecureLabel = ({ label, badgeType, badgeTooltip }: SecureLabelProps) => (
  <span>
    {label}
    <SecureBadge type={badgeType} tooltip={badgeTooltip} />
  </span>
);
