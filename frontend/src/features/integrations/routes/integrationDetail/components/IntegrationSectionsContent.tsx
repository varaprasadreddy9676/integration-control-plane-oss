import type { ReactNode } from 'react';
import { editorFontSize } from '../../../../../design-system/utils';
import { Typography } from '@/components/common/LegacyTypography';
import { Form, Space, Divider, Switch } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { Stack } from '@astryxdesign/core/Stack';
import Editor from '@monaco-editor/react';

const { Text } = Typography;
import { ConfigSection } from '../../../../../components/common/ConfigSection';
import { InlineHint } from '../../../../../components/common/InlineHint';
import { ConfigurationPanelContent } from './ConfigurationPanel';
import { AuthenticationPanelContent } from './AuthenticationPanel';
import { MultiActionList } from './MultiActionList';
import { DeliveryReliabilitySection } from './DeliveryReliabilitySection';
import { DeliveryReliabilitySummary } from './DeliveryReliabilitySummary';
import { DeliveryFollowUpSection, DeliveryFollowUpView } from '../../../components/detail/DeliveryFollowUpSection';
import { DeliveryTimingSection } from './DeliveryTimingSection';
import { LifecyclePanelContent } from './LifecyclePanel';
import { TransformationPanelContent } from './TransformationPanel';
import { getDeliveryModeChipLabel } from '../utils/deliveryMode';
import { visibleDeliveryTabs } from '../utils/deliveryLayout';
import { classicFromSteps } from '../utils/classicSteps';
import type { DeliveryLayout } from '../utils/deliveryLayout';
import { DeliveryTab } from '../../../../stages/components/delivery-tab/DeliveryTab';
import type { StepEditors } from '../../../../stages/canvas/stepEditors';
import { deliveriesOf, stageCountOf } from '../../../../stages/deliveryTargets';
import type { IntegrationSectionItem } from './IntegrationSections';

export interface IntegrationSectionsContentProps {
  form: any;
  tenant: any;
  eventTypes: any[];
  uiConfig: any;
  isMultiAction: boolean;
  isCreate: boolean;
  isEditMode: boolean;
  eventTypesLoading: boolean;
  scopeValue?: string;
  excludedOrgUnits?: any[];
  actionsCount: number;
  existingActionsCount: number;
  selectedEventTypeData: any;
  availableFields: any[];
  spacing: Record<string, string>;
  token: any;
  editorTheme: 'vs-dark' | 'light';
  colors: any;
  loadCleverTapTemplate: () => void;
  multiActionValidationErrors: string[];
  formatScriptForDisplay: (script?: string) => string;
  selectedAuthType?: string;
  deliveryModeValue?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING' | 'WAIT_FOR_CONDITION' | 'WAIT_FOR_EVENT';
  samplePayload: string;
  schedulingScriptValidation: { status: 'idle' | 'success' | 'error'; message?: string };
  isValidatingScript: boolean;
  onValidateScript: () => void;
  onCopyExampleScript: (mode: 'DELAYED' | 'RECURRING') => void;
  onValidationClose: () => void;
  selectedEventType?: string;
  scriptValue: string;
  /** The transformation editor, shown in the Transformation tab while editing. */
  transformationEditor: React.ReactNode;
  deliveryLayout: DeliveryLayout;
  isReadOnly?: boolean;
  isLoading?: boolean;
  integrationId?: string;
  /** Open another tab of the page by its key (the workflow canvas links its fixed steps to theirs). */
  onOpenTab?: (key: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  isSaving?: boolean;
  isActiveValue?: boolean;
  hasPersistedFollowUpConfig?: boolean;
  responseTransformEnabled?: boolean;
  responseTransformScript?: string;
  onResponseTransformEnabledChange?: (enabled: boolean) => void;
  onResponseTransformScriptChange?: (script: string) => void;
}

export const buildIntegrationSectionItems = ({
  form,
  tenant,
  eventTypes,
  uiConfig,
  isMultiAction,
  isCreate,
  isEditMode,
  eventTypesLoading,
  scopeValue,
  excludedOrgUnits,
  actionsCount,
  existingActionsCount,
  selectedEventTypeData,
  availableFields,
  spacing,
  token,
  editorTheme,
  colors,
  loadCleverTapTemplate,
  multiActionValidationErrors,
  formatScriptForDisplay,
  selectedAuthType,
  deliveryModeValue,
  samplePayload,
  schedulingScriptValidation,
  isValidatingScript,
  onValidateScript,
  onCopyExampleScript,
  onValidationClose,
  selectedEventType,
  scriptValue,
  transformationEditor,
  deliveryLayout,
  isReadOnly = false,
  isLoading = false,
  integrationId,
  onOpenTab,
  onSave,
  onCancel,
  isSaving = false,
  isActiveValue,
  hasPersistedFollowUpConfig = false,
  responseTransformEnabled = false,
  responseTransformScript = '',
  onResponseTransformEnabledChange,
  onResponseTransformScriptChange,
}: IntegrationSectionsContentProps): IntegrationSectionItem[] => {
  const wrapContent = (content: ReactNode) => (
    <fieldset
      className="integration-tab-content"
      disabled={isReadOnly}
      style={{ border: 'none', padding: 'var(--spacing-0)', margin: `${spacing[2]} 0 0` }}
    >
      {content}
    </fieldset>
  );

  // Read-only summaries — shown instead of the (disabled) edit form when
  // isReadOnly is true, so viewing an integration shows plain data instead
  // of interactive-looking-but-unresponsive controls.
  // getFieldsValue(true) is required here: the edit-mode Form.Items for
  // whichever tab is being summarized are never mounted in read-only mode,
  // and getFieldsValue() with no argument silently omits any field whose
  // Form.Item has never registered — same class of bug as Form.useWatch.
  const values = form.getFieldsValue(true);

  const renderBasicInfoSummary = () => (
    <ConfigSection
      icon={<GatewayIcon name="ApiOutlined" />}
      title="Basic Information"
      className="integration-basic-summary-card"
    >
      <div className="integration-basic-summary">
        <div className="integration-basic-summary__row">
          <Text type="secondary" className="integration-basic-summary__label">
            Rule Name:
          </Text>
          <Text strong>{values.name || <Text type="secondary">Not set</Text>}</Text>
        </div>
        <div className="integration-basic-summary__row">
          <Text type="secondary" className="integration-basic-summary__label">
            Event Type:
          </Text>
          <Text strong>
            <code>{values.eventType || <Text type="secondary">Not set</Text>}</code>
          </Text>
        </div>
        <div className="integration-basic-summary__row">
          <Text type="secondary" className="integration-basic-summary__label">
            Target URL:
          </Text>
          <Text strong className="integration-basic-summary__url">
            {values.targetUrl || <Text type="secondary">Not set</Text>}
          </Text>
        </div>
        <div className="integration-basic-summary__row">
          <Text type="secondary" className="integration-basic-summary__label">
            HTTP Method:
          </Text>
          <Text className="font-mono">{values.httpMethod || 'POST'}</Text>
        </div>
        {values.scope && (
          <div className="integration-basic-summary__row">
            <Text type="secondary" className="integration-basic-summary__label">
              Scope:
            </Text>
            <Text>{values.scope === 'GLOBAL' ? 'All Tenants' : 'Current Tenant'}</Text>
          </div>
        )}
      </div>
    </ConfigSection>
  );

  const renderMultiActionSummary = () => (
    <ConfigSection icon={<GatewayIcon name="ThunderboltOutlined" />} title="Multi-Action Configuration">
      <div className="console-flex-gap-2">
        <Text type="secondary" className="console-label-min-width">
          Actions Configured:
        </Text>
        <Text strong>
          {actionsCount} action{actionsCount !== 1 ? 's' : ''}
        </Text>
      </div>
    </ConfigSection>
  );

  const renderAuthSummary = () => (
    <ConfigSection icon={<GatewayIcon name="LockOutlined" />} title="Authentication">
      <div className="console-flex-gap-2">
        <Text type="secondary" className="console-label-min-width">
          Auth Type:
        </Text>
        <Text>{values.outgoingAuthType || 'NONE'}</Text>
      </div>
    </ConfigSection>
  );

  const renderDeliveryModeSummary = () => (
    <ConfigSection icon={<GatewayIcon name="ClockCircleOutlined" />} title="Delivery Mode">
      <Space direction="vertical" size="small" className="console-width-full">
        <div className="console-flex-gap-2">
          <Text type="secondary" className="console-label-min-width">
            Mode:
          </Text>
          <Text>{getDeliveryModeChipLabel(deliveryModeValue)}</Text>
        </div>
        {deliveryModeValue === 'DELAYED' && values.schedulingConfig?.script && (
          <div className="console-flex-gap-2">
            <Text type="secondary" className="console-label-min-width">
              Scheduling Script:
            </Text>
            <Text type="secondary">Configured</Text>
          </div>
        )}
        {deliveryModeValue === 'RECURRING' && values.schedulingConfig?.script && (
          <div className="console-flex-gap-2">
            <Text type="secondary" className="console-label-min-width">
              Recurring Script:
            </Text>
            <Text type="secondary">Configured</Text>
          </div>
        )}
      </Space>
    </ConfigSection>
  );

  const renderTransformationSummary = () => (
    <ConfigSection icon={<GatewayIcon name="CodeOutlined" />} title="Transformation">
      <Space direction="vertical" size="small" className="console-width-full">
        {!scriptValue && <Text type="secondary">No transformation: the event is sent as it is.</Text>}
        {scriptValue && (
          <Stack gap={1}>
            <Text type="secondary">Script ({scriptValue.split('\n').length} lines):</Text>
            <Editor
              height={Math.min(scriptValue.split('\n').length * 19 + 16, 400)}
              defaultLanguage="javascript"
              value={scriptValue}
              theme={editorTheme}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: editorFontSize('body'),
                lineNumbers: 'on',
                folding: true,
                wordWrap: 'off',
                scrollbar: { vertical: 'auto', horizontal: 'auto' },
                renderLineHighlight: 'none',
              }}
            />
          </Stack>
        )}
      </Space>
    </ConfigSection>
  );

  // Helper to check if a tab is complete
  const isTabComplete = (tabKey: string): boolean => {
    // getFieldsValue(true): Basic Info's fields may not be mounted yet if
    // another tab was opened first (or in read-only mode, never at all),
    // and the plain no-argument form silently drops unmounted fields.
    const values = form.getFieldsValue(true);

    switch (tabKey) {
      case 'configuration':
        // For multi-action integrations, targetUrl is optional (can be defined at action level)
        // For single-action integrations, targetUrl is required
        if (isMultiAction) {
          return !!(values.name && values.eventType);
        }
        return !!(values.name && values.eventType && values.targetUrl);
      case 'authentication':
        return true; // Auth is optional
      case 'timingFollowUp':
        return true;
      case 'reliability':
        return true; // Always has a delivery mode
      case 'transformation':
        return true; // Transformation is optional
      case 'multiAction':
        return true; // Multi-action management
      default:
        return false;
    }
  };

  // Check if configuration tab is complete (required for all other tabs)
  const configComplete = isTabComplete('configuration');
  const runsOnSteps = form.getFieldValue('stageMigration')?.state === 'SWITCHED';
  const classicSteps = classicFromSteps(form.getFieldValue('stages'));

  const items: IntegrationSectionItem[] = [
    {
      key: 'configuration',
      label: 'Basic Info',
      disabled: false, // First tab always enabled
      children: wrapContent(
        isReadOnly ? (
          renderBasicInfoSummary()
        ) : (
          <ConfigurationPanelContent
            form={form}
            eventTypes={eventTypes}
            uiConfig={uiConfig}
            tenant={tenant}
            isMultiAction={isMultiAction}
            eventTypesLoading={eventTypesLoading}
            scopeValue={scopeValue}
            excludedOrgUnits={excludedOrgUnits}
            spacing={spacing}
            token={token}
            colors={colors}
            isLoading={isLoading}
          />
        )
      ),
    },
  ];

  if (isMultiAction) {
    items.push({
      key: 'multiAction',
      label: 'Multi-Action',
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        isReadOnly ? (
          renderMultiActionSummary()
        ) : (
          <MultiActionList
            form={form}
            isCreate={isCreate}
            isEditMode={isEditMode}
            isMultiAction={isMultiAction}
            actionsCount={actionsCount}
            existingActionsCount={existingActionsCount}
            uiConfig={uiConfig}
            selectedEventTypeData={selectedEventTypeData}
            availableFields={availableFields}
            spacing={spacing}
            token={token}
            colors={colors}
            loadCleverTapTemplate={loadCleverTapTemplate}
            multiActionValidationErrors={multiActionValidationErrors}
            formatScriptForDisplay={formatScriptForDisplay}
          />
        )
      ),
    });
  }

  items.push(
    {
      key: 'authentication',
      label: 'Authentication',
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        isReadOnly ? (
          renderAuthSummary()
        ) : (
          <AuthenticationPanelContent
            form={form}
            uiConfig={uiConfig}
            selectedAuthType={selectedAuthType}
            isMultiAction={isMultiAction}
            spacing={spacing}
            colors={colors}
            isLoading={isLoading}
            currentEventType={selectedEventType}
          />
        )
      ),
    },
    {
      key: 'timingFollowUp',
      label: 'Timing & Follow-up',
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        isReadOnly ? (
          renderDeliveryModeSummary()
        ) : (
          <Space direction="vertical" size="middle" className="console-width-full">
            <DeliveryTimingSection
              deliveryModeValue={deliveryModeValue}
              uiConfig={uiConfig}
              schedulingScriptValidation={schedulingScriptValidation}
              isValidatingScript={isValidatingScript}
              onValidateScript={onValidateScript}
              onCopyExampleScript={onCopyExampleScript}
              onValidationClose={onValidationClose}
              spacing={spacing}
              token={token}
              colors={colors}
              form={form}
              currentEventType={selectedEventType}
              isLoading={isLoading}
              integrationId={integrationId}
            />
            <LifecyclePanelContent
              form={form}
              eventTypes={eventTypes}
              hasPersistedConfig={hasPersistedFollowUpConfig}
              deliveryModeValue={deliveryModeValue}
              spacing={spacing}
              token={token}
              colors={colors}
              isLoading={isLoading}
              isReadOnly={isReadOnly}
            />
          </Space>
        )
      ),
    },
    {
      key: 'reliability',
      label: 'Reliability',
      disabled: !configComplete,
      children: wrapContent(
        isReadOnly ? (
          <DeliveryReliabilitySummary uiConfig={uiConfig} spacing={spacing} form={form} />
        ) : (
          <DeliveryReliabilitySection uiConfig={uiConfig} spacing={spacing} form={form} isLoading={isLoading} />
        )
      ),
    }
  );

  // The stages around each delivery (checks before sending, response checks,
  // scheduled follow-ups, failure handling), each named by the user: the
  // integration's own, or each action's.
  const stageCount = stageCountOf(form.getFieldsValue(true));
  items.push({
    key: 'delivery',
    label: stageCount > 0 ? `Delivery (${stageCount} ${stageCount === 1 ? 'step' : 'steps'})` : 'Delivery',
    disabled: !configComplete,
    children: null, // filled in once every tab's content exists (below): the diagram edits their sections in place
  });

  if (!isMultiAction) {
    items.push({
      key: 'transformation',
      label: 'Transformation',
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        isReadOnly ? (
          renderTransformationSummary()
        ) : (
          <TransformationPanelContent
            isCreate={isCreate}
            isEditMode={isEditMode}
            selectedEventType={selectedEventType}
            scriptValue={scriptValue}
            spacing={spacing}
            token={token}
            colors={colors}
            editor={transformationEditor}
            formatScriptForDisplay={formatScriptForDisplay}
            isLoading={isLoading}
          />
        )
      ),
    });

    items.push({
      key: 'responseTransform',
      label: 'Response Transform',
      disabled: !configComplete,
      children: wrapContent(
        <Space direction="vertical" size="middle" className="console-width-full">
          <InlineHint>
            Inspect or normalize the response with JavaScript. Call <code>skip(reason)</code> for a business failure;
            return a value or <code>undefined</code> to accept it.
          </InlineHint>

          <div className="console-flex-between-center">
            <Text strong>Enable Response Transformation</Text>
            {isReadOnly ? (
              <Text type="secondary">{responseTransformEnabled ? 'Enabled' : 'Disabled'}</Text>
            ) : (
              <Switch
                checked={responseTransformEnabled}
                onChange={onResponseTransformEnabledChange}
                size="small"
                aria-label="Enable response transformation"
              />
            )}
          </div>

          {responseTransformEnabled ? (
            <Space direction="vertical" size="small" className="console-width-full">
              <Text type="secondary" className="console-type-caption">
                Function signature: <code>{'async function transform(responseBody, context) { ... }'}</code>
              </Text>
              <Editor
                height="320px"
                language="javascript"
                theme={editorTheme}
                value={responseTransformScript}
                onChange={(value) => onResponseTransformScriptChange?.(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: editorFontSize('control'),
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  readOnly: isReadOnly,
                }}
              />
            </Space>
          ) : (
            <InlineHint>Without a response check, any HTTP 2xx response is treated as successful.</InlineHint>
          )}
        </Space>
      ),
    });

    // After a send is accepted, a script asks the provider what became of it (delivered, read, failed...).
    items.push({
      key: 'deliveryFollowUp',
      label: 'Delivery follow-up',
      disabled: !configComplete,
      children: wrapContent(
        isReadOnly ? (
          <DeliveryFollowUpView form={form} />
        ) : (
          <>
            {runsOnSteps && !classicSteps.followUp.exists && (
              <InlineHint tone="warning">
                Turn on follow-up and save to create its step. If its script is blank, the provider template is used.
              </InlineHint>
            )}
            <DeliveryFollowUpSection form={form} integrationId={integrationId} />
          </>
        )
      ),
    });
  }

  // Add Review tab for create/edit mode
  if ((isCreate || isEditMode) && onSave && onCancel) {
    items.push({
      key: 'review',
      label: 'Review & Submit',
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        <Space direction="vertical" size="middle" className="console-width-full">
          {renderBasicInfoSummary()}

          {isMultiAction && (
            <>
              <Divider className="console-margin-none" />
              {renderMultiActionSummary()}
            </>
          )}

          <Divider className="console-margin-none" />
          {renderAuthSummary()}

          <Divider className="console-margin-none" />
          {renderDeliveryModeSummary()}

          {!isMultiAction && (
            <>
              <Divider className="console-margin-none" />
              {renderTransformationSummary()}
            </>
          )}
        </Space>
      ),
    });
  }

  // The Delivery tab's diagram edits the fixed steps (the event, the transformation, the send, the retries)
  // in place, with the very sections the other tabs show: no leaving the diagram and finding the way back.
  const sectionOf = (key: string) => items.find((item) => item.key === key)?.children;
  const section = (key: string, title: string) => ({ key, title, node: sectionOf(key) });
  const stepEditors: StepEditors = {
    trigger: [section('configuration', 'Event and target')],
    transform: isMultiAction ? [section('multiAction', 'Actions')] : [section('transformation', 'Transformation')],
    send: [
      section('configuration', 'Target'),
      section('authentication', 'Authentication'),
      section('timingFollowUp', 'Timing and follow-up'),
    ],
    retry: [section('reliability', 'Retries and limits')],
  };
  const current = form.getFieldsValue(true);
  const visible = visibleDeliveryTabs({
    layout: deliveryLayout,
    isMultiAction,
    stageCount,
    migrationState: current.stageMigration?.state,
    responseCheckOn: responseTransformEnabled,
    followUpOn: current.deliveryFollowUp?.enabled === true,
  });
  const shown = items.filter(
    (item) =>
      (item.key !== 'delivery' || visible.steps) &&
      (item.key !== 'responseTransform' || visible.responseTransform) &&
      (item.key !== 'deliveryFollowUp' || visible.followUp)
  );
  return shown.map((item) =>
    item.key === 'delivery'
      ? {
          ...item,
          // Not inside the page's disabled fieldset: the tab handles read-only itself, and a
          // disabled fieldset would make the diagram's buttons unclickable.
          children: (
            <div className="integration-tab-content console-margin-top-2">
              {visible.stepsShownAnyway && (
                <InlineHint>
                  Response checks and follow-up are steps here and in the classic tabs; both views edit the same
                  settings.
                </InlineHint>
              )}
              <DeliveryTab
                form={form}
                integrationId={integrationId}
                readOnly={isReadOnly}
                targets={deliveriesOf(form.getFieldsValue(true))}
                onOpenTab={onOpenTab}
                stepEditors={stepEditors}
                context={() => {
                  const current = form.getFieldsValue(true);
                  return {
                    direction: current.direction || 'OUTBOUND',
                    actions: current.actions || [],
                    targetUrl: current.targetUrl,
                  };
                }}
              />
            </div>
          ),
        }
      : item
  );
};
