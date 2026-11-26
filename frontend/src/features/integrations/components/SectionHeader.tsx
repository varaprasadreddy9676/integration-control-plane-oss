import { Space, Tooltip } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { cssVar } from '../../../design-system/utils';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  complete?: boolean;
  optional?: boolean;
  hasErrors?: boolean;
  errorCount?: number;
  helpText?: string;
  badge?: string;
  badgeColor?: string;
}

export const SectionHeader = ({
  title,
  subtitle,
  complete = false,
  optional = false,
  hasErrors = false,
  errorCount = 0,
  helpText,
  badge,
}: SectionHeaderProps) => {
  const colors = cssVar.legacy;

  const getStatusIcon = () => {
    if (hasErrors) {
      return <GatewayIcon size="md" name="WarningFilled" style={{ color: colors.error[600] }} />;
    }

    if (complete) {
      return <GatewayIcon size="md" name="CheckCircleFilled" style={{ color: colors.success[600] }} />;
    }

    return (
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: `2px solid ${colors.neutral[400]}`,
          background: cssVar.bg.surface,
        }}
      />
    );
  };

  return (
    <Space align="center" size="middle">
      {getStatusIcon()}

      <div>
        <Space align="center" size="small">
          <Text weight="semibold" size="lg">
            {title}
          </Text>

          {optional && (
            <Text type="supporting" color="secondary">
              Optional
            </Text>
          )}

          {badge && (
            <Text type="supporting" color="secondary">
              {badge}
            </Text>
          )}

          {hasErrors && errorCount > 0 && (
            <Text type="supporting" color="secondary" className="console-text-error">
              {errorCount} {errorCount === 1 ? 'error' : 'errors'}
            </Text>
          )}

          {helpText && (
            <Tooltip title={helpText} placement="right">
              <GatewayIcon size="xsm" name="InfoCircleOutlined" className="console-text-info console-cursor-help" />
            </Tooltip>
          )}
        </Space>

        {subtitle && (
          <Text
            display="block"
            type="supporting"
            color="secondary"
            size="sm"
            className="ui-extracted-e0c1796fa1"
          >
            {subtitle}
          </Text>
        )}
      </div>
    </Space>
  );
};
