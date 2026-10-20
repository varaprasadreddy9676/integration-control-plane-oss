import { Form, Space, Switch, Typography } from 'antd';
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
  transformationTab: 'SIMPLE' | 'SCRIPT';
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
  transformationTab,
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
  const statusChips = isCreate
    ? [
        { label: 'Draft', color: cssVar.text.secondary },
        { label: isMultiAction ? 'Multi-action' : 'Single' },
        deliveryModeValue && {
          label: getDeliveryModeChipLabel(deliveryModeValue),
        },
      ].filter(Boolean)
    : [
        {
          label: existingIntegration?.isActive ? 'Active' : 'Paused',
          color: existingIntegration?.isActive ? colors.success[600] : colors.warning[600],
        },
        { label: isMultiAction ? 'Multi-action' : 'Single' },
        deliveryModeValue && { label: getDeliveryModeChipLabel(deliveryModeValue) },
        { label: transformationTab === 'SCRIPT' ? 'JavaScript Transform' : 'Simple Mapping' },
        existingIntegration?.updatedAt && { label: `Last updated ${formatDateTime(existingIntegration.updatedAt)}` },
      ].filter(Boolean);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, color: cssVar.text.secondary }}>
              {isActiveValue === false ? 'Paused' : 'Active'}
            </Typography.Text>
            <Form.Item name="isActive" valuePropName="checked" noStyle>
              <Switch size="small" disabled={isPortalSession} />
            </Form.Item>
          </div>
        ) : undefined
      }
      statusChips={statusChips as any}
      actions={
        !isCreate && !isEditMode ? (
          <Space>
          {extraActions}
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
          </Space>
        ) : (
          extraActions
        )
      }
    />
  );
};
