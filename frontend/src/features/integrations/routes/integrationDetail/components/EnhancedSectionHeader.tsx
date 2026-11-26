import { Badge, Space, Tooltip } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import type { ReactNode } from 'react';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { spacingToNumber, withAlpha, cssVar } from '../../../../../design-system/utils';

const { Text } = Typography;

export interface SectionCompletionStatus {
  isComplete: boolean;
  requiredFieldsCount: number;
  missingRequiredCount: number;
  errors: string[];
}

interface EnhancedSectionHeaderProps {
  icon: ReactNode;
  title: string;
  description?: string;
  spacing: Record<string, string>;
  completionStatus?: SectionCompletionStatus;
  badge?: {
    count?: number;
    text?: string;
    color?: string;
  };
}

export const EnhancedSectionHeader = ({
  icon,
  title,
  description,
  spacing,
  completionStatus,
  badge,
}: EnhancedSectionHeaderProps) => {
  const colors = cssVar.legacy;

  // Determine status icon and color
  const getStatusIndicator = () => {
    if (!completionStatus) return null;

    if (completionStatus.errors.length > 0) {
      return {
        icon: <GatewayIcon name="CloseCircleOutlined" />,
        color: colors.error[500],
        tooltip: `${completionStatus.errors.length} error${completionStatus.errors.length > 1 ? 's' : ''}`,
      };
    }

    if (completionStatus.missingRequiredCount > 0) {
      return {
        icon: <GatewayIcon name="ExclamationCircleOutlined" />,
        color: colors.warning[500],
        tooltip: `${completionStatus.missingRequiredCount} required field${completionStatus.missingRequiredCount > 1 ? 's' : ''} missing`,
      };
    }

    if (completionStatus.isComplete) {
      return {
        icon: <GatewayIcon name="CheckCircleOutlined" />,
        color: colors.success[500],
        tooltip: 'Section complete',
      };
    }

    return null;
  };

  const statusIndicator = getStatusIndicator();

  return (
    <div
      className="ui-extracted-83bc32acad"
    >
      {/* Left: Icon, Title, Description */}
      <Space size={spacingToNumber(spacing[2])} align="start">
        <div className="ui-extracted-be5bfff7e4">{icon}</div>
        <div className="console-flex-fill">
          <Space size={spacingToNumber(spacing[2])}>
            <Text strong className="console-type-section">
              {title}
            </Text>
            {badge && (
              <Text type="secondary" className="console-type-caption">
                {badge.text || badge.count}
              </Text>
            )}
          </Space>
          {description && (
            <div style={{ marginTop: spacingToNumber(spacing[1]) }}>
              <Text type="secondary" className="console-caption-secondary">
                {description}
              </Text>
            </div>
          )}
        </div>
      </Space>

      {/* Right: Status Indicator */}
      {statusIndicator && (
        <Tooltip title={statusIndicator.tooltip} placement="left">
          <div
            style={{
              fontSize: 'var(--console-type-section)',
              color: statusIndicator.color,
              display: 'flex',
              alignItems: 'center',
              paddingRight: spacing[2],
            }}
          >
            {statusIndicator.icon}
          </div>
        </Tooltip>
      )}
    </div>
  );
};

/**
 * Helper function to compute section completion status
 * @param formValues - The current form values
 * @param requiredFields - Array of required field names for this section
 * @param validationErrors - Array of validation error messages for this section
 * @returns SectionCompletionStatus object
 */
export const computeSectionCompletion = (
  formValues: any,
  requiredFields: string[],
  validationErrors: string[] = []
): SectionCompletionStatus => {
  const missingRequiredCount = requiredFields.filter((field) => {
    const value = getNestedValue(formValues, field);
    return value === undefined || value === null || value === '';
  }).length;

  const isComplete = missingRequiredCount === 0 && validationErrors.length === 0;

  return {
    isComplete,
    requiredFieldsCount: requiredFields.length,
    missingRequiredCount,
    errors: validationErrors,
  };
};

/**
 * Get nested value from object using dot notation
 * @param obj - The object to get value from
 * @param path - Dot-separated path (e.g., 'auth.apiKey')
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
