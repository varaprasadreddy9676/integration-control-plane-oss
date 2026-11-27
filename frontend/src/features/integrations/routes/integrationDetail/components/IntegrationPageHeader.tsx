import { Dropdown, Form, Switch } from '@/components/common/LegacyAntdControls';
import { Button } from '../../../../../components/common/LegacyButton';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { IntegrationConfig } from '../../../../../mocks/types';
import { PageHeader } from '../../../../../components/common/PageHeader';
import { FormActions } from '../../../components/common';
import { formatDateTime } from '../../../../../utils/format';
import { getDeliveryModeChipLabel } from '../utils/deliveryMode';
import { StatusBadge } from '../../../../../components/common/StatusBadge';

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
            <StatusBadge
              label={isActiveValue === false ? 'Paused' : 'Active'}
              variant={isActiveValue === false ? 'neutral' : 'success'}
              showIcon={false}
              size="small"
              className={isActiveValue === false ? undefined : 'integration-active-status'}
            />
            <Form.Item name="isActive" valuePropName="checked" noStyle>
              <Switch size="small" disabled={isPortalSession} aria-label="Integration active" />
            </Form.Item>
          </div>
        ) : undefined
      }
      summary={summary}
      actions={
        !isCreate && !isEditMode ? (
          <section className="integration-page-header-actions" aria-label="Integration actions">
            {extraActions && <div className="integration-page-header-secondary-actions">{extraActions}</div>}
            <Dropdown trigger={['click']} menu={{ items: [
              { key: 'export', label: 'Export configuration', icon: <GatewayIcon name="DownloadOutlined" />, onClick: onExport },
              ...(!isPortalSession ? [
                { key: 'duplicate', label: 'Duplicate integration', icon: <GatewayIcon name="CopyOutlined" />, onClick: onDuplicate },
              ] : []),
            ] }}>
              <Button icon={<GatewayIcon name="MoreOutlined" />} aria-label="More integration actions" />
            </Dropdown>
            <div className="integration-page-header-primary-actions ui-extracted-55a6f49ed2">
              <FormActions
                mode="view"
                isEditMode={isEditMode}
                isSaving={isSaving}
                isActive={isActiveValue}
                canTest={!isCreate}
                canSave={false}
                canDuplicate={false}
                canExport={false}
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
          </section>
        ) : (
          extraActions
        )
      }
    />
  );
};
