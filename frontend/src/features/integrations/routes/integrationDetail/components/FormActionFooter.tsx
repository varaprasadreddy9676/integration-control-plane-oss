import { Space, Tooltip } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from "../../../../../components/common/Icon";
import { FormActions } from '../../../components/common';
import { spacingToNumber, cssVar } from '../../../../../design-system/utils';
import { Button } from '../../../../../components/common/LegacyButton';

interface FormActionFooterProps {
  visible: boolean;
  isCreate: boolean;
  isSaving: boolean;
  isActiveValue?: boolean;
  canTest: boolean;
  canSave: boolean;
  onSave: () => void;
  onTest: () => void;
  onCancel: () => void;
  saveText: string;
  testText: string;
  testDisabledTooltip: string;
  testEnabledTooltip: string;
  spacing: Record<string, string>;
  // Activate action
  onActivate?: () => void;
  showActivate?: boolean;
}

export const FormActionFooter = ({
  visible,
  isCreate,
  isSaving,
  isActiveValue,
  canTest,
  canSave,
  onSave,
  onTest,
  onCancel,
  saveText,
  testText,
  testDisabledTooltip,
  testEnabledTooltip,
  spacing,
  onActivate,
  showActivate = false,
}: FormActionFooterProps) => {
  if (!visible) return null;
  const colors = cssVar.legacy;

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 10,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: spacingToNumber(spacing[2]),
        padding: `${spacing[3]} 0`,
        borderTop: `1px solid ${cssVar.border.default}`,
        background: cssVar.bg.base,
        boxShadow: 'none',
      }}
    >
      <Space size={spacingToNumber(spacing[2])} wrap>
        <FormActions
          mode={isCreate ? 'create' : 'edit'}
          isSaving={isSaving}
          isActive={isActiveValue}
          canTest={canTest}
          canSave={canSave}
          onSave={onSave}
          onTest={onTest}
          onCancel={onCancel}
          saveText={saveText}
          testText={testText}
          testDisabledTooltip={testDisabledTooltip}
          testEnabledTooltip={testEnabledTooltip}
          spacing={spacing}
          colors={colors}
          size="middle"
        />
        {showActivate && onActivate && (
          <Tooltip
            title={
              canSave ? 'Save and activate this event rule immediately' : 'Complete required fields before activating'
            }
          >
            <Button
              type="primary"
              icon={<GatewayIcon name="ThunderboltOutlined" />}
              onClick={onActivate}
              loading={isSaving}
              disabled={isSaving || !canSave}
              size="middle"
            >
              {isCreate ? 'Create & Activate' : 'Activate'}
            </Button>
          </Tooltip>
        )}
      </Space>
    </div>
  );
};
