import { useMemo, useState } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import { Space, Tooltip, Progress } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { cssVar, useDesignTokens, withAlpha } from '../../../../../design-system/utils';
import { Button } from '../../../../../components/common/LegacyButton';
import { StatusBadge } from '../../../../../components/common/StatusBadge';

const { Text } = Typography;

interface RuleStatusBarProps {
  isCreate: boolean;
  isActive?: boolean;
  isDraft?: boolean;

  // Validation state
  missingRequiredCount: number;
  validationErrors: string[];
  isValid: boolean;

  // Optional
  className?: string;
  style?: React.CSSProperties;
}

export const RuleStatusBar = ({
  isCreate,
  isActive = false,
  isDraft = true,
  missingRequiredCount,
  validationErrors,
  isValid,
  className,
  style,
}: RuleStatusBarProps) => {
  const [showAllErrors, setShowAllErrors] = useState(false);
  const { spacing, token } = useDesignTokens();
  const colors = cssVar.legacy;

  // Calculate completion percentage (inverse of missing fields)
  const totalFields = 10; // Approximate total critical fields
  const completedFields = Math.max(0, totalFields - missingRequiredCount);
  const completionPercentage = Math.round((completedFields / totalFields) * 100);

  // Determine status color and icon
  const getStatusDisplay = () => {
    // If already active and valid, show active status
    if (isActive && isValid && missingRequiredCount === 0 && validationErrors.length === 0) {
      return {
        icon: <GatewayIcon name="CheckCircleOutlined" />,
        text: isCreate ? 'Ready to activate' : 'All changes saved',
        color: colors.success[600],
        bgColor: withAlpha(colors.success[100], 0.5),
      };
    }

    // If valid but not active, ready to activate
    if (isValid && missingRequiredCount === 0 && validationErrors.length === 0) {
      return {
        icon: <GatewayIcon name="CheckCircleOutlined" />,
        text: 'Ready to activate',
        color: colors.success[600],
        bgColor: withAlpha(colors.success[100], 0.5),
      };
    }

    if (validationErrors.length > 0) {
      return {
        icon: <GatewayIcon name="CloseCircleOutlined" />,
        text: `${validationErrors.length} error${validationErrors.length > 1 ? 's' : ''} to fix`,
        color: colors.error[600],
        bgColor: withAlpha(colors.error[100], 0.5),
      };
    }

    if (missingRequiredCount > 0) {
      return {
        icon: <GatewayIcon name="ExclamationCircleOutlined" />,
        text: `${missingRequiredCount} required field${missingRequiredCount > 1 ? 's' : ''} missing`,
        color: colors.warning[600],
        bgColor: withAlpha(colors.warning[100], 0.5),
      };
    }

    return {
      icon: <GatewayIcon name="ExclamationCircleOutlined" />,
      text: 'In progress',
      color: cssVar.text.secondary,
      bgColor: withAlpha(cssVar.bg.subtle, 0.8),
    };
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div
      className={className}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: cssVar.bg.surface,
        borderBottom: `1px solid ${cssVar.border.default}`,
        padding: `${spacing[3]} ${spacing[4]}`,
        marginBottom: spacing[4],
        boxShadow: token.boxShadow,
        ...style,
      }}
    >
      <div
        className="ui-extracted-ec156c7494"
      >
        {/* Left: Status and validation indicators */}
        <Space size="large">
          {/* Status Tag */}
          <Space size="small">
            <StatusBadge
              label={isCreate ? 'Draft' : isActive ? 'Active' : 'Paused'}
              variant={isCreate ? 'neutral' : isActive ? 'success' : 'warning'}
            />
          </Space>

          {/* Validation Status */}
          <Space size="small">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: spacing[2],
                padding: `${spacing[1]} ${spacing[3]}`,
                borderRadius: 4,
                background: statusDisplay.bgColor,
                border: `1px solid ${withAlpha(statusDisplay.color, 0.2)}`,
              }}
            >
              <span style={{ color: statusDisplay.color, fontSize: 'var(--console-type-control)' }}>
                {statusDisplay.icon}
              </span>
              <Text style={{ fontSize: 'var(--console-type-body)', fontWeight: 500, color: statusDisplay.color }}>
                {statusDisplay.text}
              </Text>
            </div>
          </Space>

          {/* Progress Bar (only show when in progress) */}
          {!isValid && missingRequiredCount > 0 && (
            <Tooltip title={`${completionPercentage}% complete`}>
              <div className="console-width-compact-control">
                <Progress
                  percent={completionPercentage}
                  size="small"
                  showInfo={false}
                  strokeColor={colors.primary[500]}
                  trailColor={cssVar.border.default}
                />
              </div>
            </Tooltip>
          )}
        </Space>

        <span />
      </div>

      {/* Validation Errors List (expandable) */}
      {validationErrors.length > 0 && (
        <div
          style={{
            maxWidth: 1400,
            margin: `${spacing[2]} auto 0`,
            padding: spacing[2],
            background: withAlpha(colors.error[50], 0.5),
            borderRadius: 4,
            border: `1px solid ${withAlpha(colors.error[200], 0.5)}`,
          }}
        >
          <div className="console-flex-between-center">
            <Text style={{ fontSize: 'var(--console-type-caption)', color: colors.error[700] }}>
              <strong>Validation errors:</strong>
            </Text>
            {validationErrors.length > 3 && (
              <Button
                type="text"
                size="small"
                icon={showAllErrors ? <GatewayIcon name="UpOutlined" /> : <GatewayIcon name="DownOutlined" />}
                onClick={() => setShowAllErrors(!showAllErrors)}
                style={{
                  fontSize: 'var(--console-type-caption)',
                  color: colors.error[500],
                  height: 'auto',
                  padding: '0 var(--spacing-1)',
                }}
              >
                {showAllErrors ? 'Show less' : `+${validationErrors.length - 3} more`}
              </Button>
            )}
          </div>
          <ul style={{ margin: `${spacing[1]} 0 0`, paddingLeft: spacing[4], fontSize: 'var(--console-type-caption)' }}>
            {(showAllErrors ? validationErrors : validationErrors.slice(0, 3)).map((error, idx) => (
              <li key={idx} className="console-text-error">
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
