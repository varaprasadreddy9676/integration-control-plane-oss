import { Space } from "@/components/common/LegacyAntdControls";
import type { ReactNode } from 'react';
import type { IntegrationSectionItem } from './IntegrationSections';
import { spacingToNumber } from '../../../../../design-system/utils';
import { DeliveryModeSelector } from './DeliveryModeSelector';
import { DeliveryLayoutSwitch } from './DeliveryLayoutSwitch';
import type { DeliveryLayout } from '../utils/deliveryLayout';
import { FormActionFooter } from './FormActionFooter';
import { IntegrationSections } from './IntegrationSections';
import { RuleStatusBar } from './RuleStatusBar';

interface IntegrationFormBodyProps {
  isCreate: boolean;
  isEditMode: boolean;
  isMultiAction: boolean;
  isSaving: boolean;
  isActiveValue?: boolean;
  canTest: boolean;
  canSave: boolean;
  spacing: Record<string, string>;
  token: any;
  colors: any;
  deliveryModeChoice: 'single' | 'multi';
  onChangeDeliveryMode: (value: 'single' | 'multi') => void;
  deliveryLayout: DeliveryLayout;
  onChangeDeliveryLayout: (value: DeliveryLayout) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  activePanels: string[];
  onPanelsChange: (keys: string[]) => void;
  onSave: () => void;
  onTest: () => void;
  onCancel: () => void;
  saveText: string;
  testText: string;
  formAlerts: ReactNode;
  sectionItems: IntegrationSectionItem[];

  // RuleStatusBar props
  missingRequiredCount?: number;
  validationErrors?: string[];
  // Activate action (shown in footer)
  onActivate?: () => void;
}

export const IntegrationFormBody = ({
  isCreate,
  isEditMode,
  isMultiAction,
  isSaving,
  isActiveValue,
  canTest,
  canSave,
  spacing,
  token,
  colors,
  deliveryModeChoice,
  onChangeDeliveryMode,
  deliveryLayout,
  onChangeDeliveryLayout,
  onExpandAll,
  onCollapseAll,
  activePanels,
  onPanelsChange,
  onSave,
  onTest,
  onCancel,
  saveText,
  testText,
  formAlerts,
  sectionItems,
  missingRequiredCount = 0,
  validationErrors = [],
  onActivate,
}: IntegrationFormBodyProps) => {
  // Show status bar in create mode (progress toward a not-yet-existing integration is
  // new information) or in edit mode only while there's something to flag — an already-valid,
  // unchanged integration duplicates the Active/status chips already shown in the page header.
  const hasIssues = missingRequiredCount > 0 || validationErrors.length > 0;
  const showStatusBar = isCreate || (isEditMode && hasIssues);
  const isValid = canSave && missingRequiredCount === 0 && validationErrors.length === 0;

  // Only show activate button when editing an inactive integration.
  // Create flow uses the review drawer to choose draft vs activate.
  const shouldShowActivate = !isCreate && !isActiveValue;

  return (
    <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
      {formAlerts}

      {/* Status Bar - Sticky status indicator only (no action buttons) */}
      {showStatusBar && (
        <RuleStatusBar
          isCreate={isCreate}
          isActive={isActiveValue}
          isDraft={!isActiveValue}
          missingRequiredCount={missingRequiredCount}
          validationErrors={validationErrors}
          isValid={isValid}
        />
      )}

      <DeliveryLayoutSwitch value={deliveryLayout} onChange={onChangeDeliveryLayout} />
      {(isCreate || isEditMode) && <DeliveryModeSelector value={deliveryModeChoice} onChange={onChangeDeliveryMode} />}

      <IntegrationSections
        activePanels={activePanels}
        onChange={onPanelsChange}
        items={sectionItems}
      />

      <FormActionFooter
        visible={isCreate || isEditMode}
        isCreate={isCreate}
        isSaving={isSaving}
        isActiveValue={isActiveValue}
        canTest={canTest}
        canSave={canSave}
        onSave={onSave}
        onTest={onTest}
        onCancel={onCancel}
        saveText={saveText}
        testText={testText}
        testDisabledTooltip="Fix validation errors before testing"
        testEnabledTooltip="Send a test event to this event rule"
        spacing={spacing}
        onActivate={shouldShowActivate ? onActivate : undefined}
        showActivate={shouldShowActivate}
      />
    </Space>
  );
};
