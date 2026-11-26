import { Form, Switch } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { IntegrationConfig } from '../../../../../mocks/types';
import { PageHeader } from '../../../../../components/common/PageHeader';
import { FormActions } from '../../../components/common';
import { formatDateTime } from '../../../../../utils/format';
import { cssVar } from '../../../../../design-system/utils';
import { getDeliveryModeChipLabel } from '../utils/deliveryMode';

interface IntegrationPageHeaderProps {
  isCreate: boolean;
  isEditMode: boolean;
  existingIntegration?: IntegrationConfig;
  isMultiAction: boolean;
  deliveryModeValue?: string;
  isActiveValue?: boolean;
  isSaving: boolean;
  spacing: Record<string, string>;
  colors: any;
  onSave: () => void;
  onTest: () => void;
  onCancelEdit: () => void;
  onEnterEditMode: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onImport: () => void;
  isPortalSession?: boolean;
  /** Shown in both view and edit mode (e.g. the super admin credential reveal). */
  extraActions?: ReactNode;
}

export const IntegrationPageHeader = ({
  isCreate,
  isEditMode,
  existingIntegration,
  isMultiAction,
  deliveryModeValue,
  isActiveValue,
  isSaving,
  spacing,
  colors,
  onSave,
  onTest,
  onCancelEdit,
  onEnterEditMode,
  onDuplicate,
  onExport,
  onImport,
  isPortalSession = false,
  extraActions,
}: IntegrationPageHeaderProps) => {
  const passedTitle = (useLocation().state as { title?: string } | null)?.title;
  const summary = [
    isCreate ? 'Draft' : null,
    isMultiAction ? 'Multi-action' : 'Single action',
    deliveryModeValue ? getDeliveryModeChipLabel(deliveryModeValue) : null,
    !isCreate && existingIntegration?.updatedAt
      ? `Last updated ${formatDateTime(existingIntegration.updatedAt)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageHeader
      // While the record loads, show the name the list passed along, so the
      // morphing title lands on the right text instead of a placeholder.
      title={isCreate ? 'Create Event Rule' : (existingIntegration?.name ?? passedTitle ?? 'Event Rule Configuration')}
      morphTitle={!isCreate}
      breadcrumb={[
        { label: 'Configuration', path: '/integrations' },
        { label: 'Outbound Integrations', path: '/integrations' },
        { label: isCreate ? 'New' : (existingIntegration?.name ?? 'Details') },
      ]}
      dense
      titleSuffix={
        !isCreate ? (
          <div className="console-flex-center-gap-2">
            <Text color="secondary" className="console-caption-secondary">
              {isActiveValue === false ? 'Paused' : 'Active'}
            </Text>
            <Form.Item name="isActive" valuePropName="checked" noStyle>
              <Switch size="small" disabled={isPortalSession} />
            </Form.Item>
          </div>
        ) : undefined
      }
      summary={summary}
      actions={
        !isCreate && !isEditMode ? (
          <div
            className="integration-page-header-actions"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: spacing[2],
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
            }}
          >
            {extraActions && <div className="integration-page-header-secondary-actions">{extraActions}</div>}
            <div className="integration-page-header-primary-actions ui-extracted-55a6f49ed2" >
              <FormActions
                mode="view"
                isEditMode={isEditMode}
                isSaving={isSaving}
                isActive={isActiveValue}
                canTest={!isCreate}
                canSave={false}
                canDuplicate={!isCreate && !isEditMode}
                canExport={!isCreate && !isEditMode}
                canImport={false}
                onSave={onSave}
                onTest={onTest}
                onCancel={onCancelEdit}
                onToggleEdit={onEnterEditMode}
                onDuplicate={onDuplicate}
                onExport={onExport}
                onImport={onImport}
                saveText={isCreate ? 'Create Event Rule' : 'Save Changes'}
                editText="Edit Integration"
                testText="Test Event Rule"
                testDisabledTooltip="Enable the event rule to test it"
                testEnabledTooltip="Send a test event to this event rule"
                spacing={spacing}
                colors={colors}
                size="middle"
                isPortalSession={isPortalSession}
              />
            </div>
          </div>
        ) : (
          extraActions
        )
      }
    />
  );
};
