import type { TabsProps } from 'antd';
import type { ReactNode } from 'react';
import { Form, Space, Card, Alert, Divider, Typography, Tag, Switch } from 'antd';
import {
  ApiOutlined,
  LockOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  RadarChartOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';

const { Text } = Typography;
import { ConfigSection } from '../../../../../components/common/ConfigSection';
import { ConfigurationPanelContent } from './ConfigurationPanel';
import { AuthenticationPanelContent } from './AuthenticationPanel';
import { MultiActionHeader } from './MultiActionHeader';
import { MultiActionList } from './MultiActionList';
import { DeliveryReliabilitySection } from './DeliveryReliabilitySection';
import { DeliveryReliabilitySummary } from './DeliveryReliabilitySummary';
import { DeliveryTimingSection } from './DeliveryTimingSection';
import { LifecyclePanelContent } from './LifecyclePanel';
import { TransformationPanelContent } from './TransformationPanel';
import { getDeliveryModeChipLabel } from '../utils/deliveryMode';

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
  transformationTab: 'SIMPLE' | 'SCRIPT';
  selectedEventType?: string;
  mappingState: { mappings: any[]; staticFields: any[] };
  scriptValue: string;
  lastPreviewMeta?: { durationMs?: number; status?: number };
  tagTone: (base: string) => any;
  onPreview: () => void;
  onOpenDesigner: () => void;
  isReadOnly?: boolean;
  isLoading?: boolean;
  integrationId?: string;
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
  transformationTab,
  selectedEventType,
  mappingState,
  scriptValue,
  lastPreviewMeta,
  tagTone,
  onPreview,
  onOpenDesigner,
  isReadOnly = false,
  isLoading = false,
  integrationId,
  onSave,
  onCancel,
  isSaving = false,
  isActiveValue,
  hasPersistedFollowUpConfig = false,
  responseTransformEnabled = false,
  responseTransformScript = '',
  onResponseTransformEnabledChange,
  onResponseTransformScriptChange,
}: IntegrationSectionsContentProps): TabsProps['items'] => {
  const wrapContent = (content: ReactNode) => (
    <fieldset disabled={isReadOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
      <Card style={{ marginTop: spacing[2] }} size="small">
        {content}
      </Card>
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
    <ConfigSection icon={<ApiOutlined />} title="Basic Information">
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <div style={{ display: 'flex', gap: spacing[2] }}>
          <Text type="secondary" style={{ minWidth: 150 }}>
            Rule Name:
          </Text>
          <Text strong>{values.name || <Text type="secondary">Not set</Text>}</Text>
        </div>
        <div style={{ display: 'flex', gap: spacing[2] }}>
          <Text type="secondary" style={{ minWidth: 150 }}>
            Event Type:
          </Text>
          <Text strong>
            <code>{values.eventType || <Text type="secondary">Not set</Text>}</code>
          </Text>
        </div>
        <div style={{ display: 'flex', gap: spacing[2] }}>
          <Text type="secondary" style={{ minWidth: 150 }}>
            Target URL:
          </Text>
          <Text strong>{values.targetUrl || <Text type="secondary">Not set</Text>}</Text>
        </div>
        <div style={{ display: 'flex', gap: spacing[2] }}>
          <Text type="secondary" style={{ minWidth: 150 }}>
            HTTP Method:
          </Text>
          <Tag color="blue">{values.httpMethod || 'POST'}</Tag>
        </div>
        {values.scope && (
          <div style={{ display: 'flex', gap: spacing[2] }}>
            <Text type="secondary" style={{ minWidth: 150 }}>
              Scope:
            </Text>
            <Tag>{values.scope === 'GLOBAL' ? 'All Tenants' : 'Current Tenant'}</Tag>
          </div>
        )}
      </Space>
    </ConfigSection>
  );

  const renderMultiActionSummary = () => (
    <ConfigSection icon={<ThunderboltOutlined />} title="Multi-Action Configuration">
      <div style={{ display: 'flex', gap: spacing[2] }}>
        <Text type="secondary" style={{ minWidth: 150 }}>
          Actions Configured:
        </Text>
        <Text strong>
          {actionsCount} action{actionsCount !== 1 ? 's' : ''}
        </Text>
      </div>
    </ConfigSection>
  );

  const renderAuthSummary = () => (
    <ConfigSection icon={<LockOutlined />} title="Authentication">
      <div style={{ display: 'flex', gap: spacing[2] }}>
        <Text type="secondary" style={{ minWidth: 150 }}>
          Auth Type:
        </Text>
        <Tag color={!values.outgoingAuthType || values.outgoingAuthType === 'NONE' ? 'default' : 'blue'}>
          {values.outgoingAuthType || 'NONE'}
        </Tag>
      </div>
    </ConfigSection>
  );

  const renderDeliveryModeSummary = () => (
    <ConfigSection icon={<ClockCircleOutlined />} title="Delivery Mode">
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <div style={{ display: 'flex', gap: spacing[2] }}>
          <Text type="secondary" style={{ minWidth: 150 }}>
            Mode:
          </Text>
          <Tag
            color={
              deliveryModeValue === 'IMMEDIATE'
                ? 'green'
                : deliveryModeValue === 'DELAYED'
                  ? 'orange'
                  : deliveryModeValue === 'RECURRING'
                    ? 'purple'
                    : deliveryModeValue === 'WAIT_FOR_CONDITION' || deliveryModeValue === 'WAIT_FOR_EVENT'
                      ? 'cyan'
                      : 'default'
            }
          >
            {getDeliveryModeChipLabel(deliveryModeValue)}
          </Tag>
        </div>
        {deliveryModeValue === 'DELAYED' && values.schedulingConfig?.script && (
          <div style={{ display: 'flex', gap: spacing[2] }}>
            <Text type="secondary" style={{ minWidth: 150 }}>
              Scheduling Script:
            </Text>
            <Text type="secondary">Configured</Text>
          </div>
        )}
        {deliveryModeValue === 'RECURRING' && values.schedulingConfig?.script && (
          <div style={{ display: 'flex', gap: spacing[2] }}>
            <Text type="secondary" style={{ minWidth: 150 }}>
              Recurring Script:
            </Text>
            <Text type="secondary">Configured</Text>
          </div>
        )}
      </Space>
    </ConfigSection>
  );

  const renderTransformationSummary = () => (
    <ConfigSection icon={<CodeOutlined />} title="Transformation">
      <Space direction="vertical" size="small" style={{ width: '100%' }}>
        <div style={{ display: 'flex', gap: spacing[2] }}>
          <Text type="secondary" style={{ minWidth: 150 }}>
            Mode:
          </Text>
          <Tag>{transformationTab === 'SIMPLE' ? 'Field Mapping' : 'JavaScript Transform'}</Tag>
        </div>
        {transformationTab === 'SIMPLE' && mappingState && (
          <div style={{ display: 'flex', gap: spacing[2] }}>
            <Text type="secondary" style={{ minWidth: 150 }}>
              Mappings:
            </Text>
            <Text strong>
              {mappingState.mappings?.length || 0} field{mappingState.mappings?.length !== 1 ? 's' : ''} mapped,{' '}
              {mappingState.staticFields?.length || 0} static field{mappingState.staticFields?.length !== 1 ? 's' : ''}
            </Text>
          </div>
        )}
        {transformationTab === 'SCRIPT' && scriptValue && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[1] }}>
            <Text type="secondary">Script ({scriptValue.split('\n').length} lines):</Text>
            <Editor
              height={Math.min(scriptValue.split('\n').length * 19 + 16, 400)}
              defaultLanguage="javascript"
              value={scriptValue}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                folding: true,
                wordWrap: 'off',
                scrollbar: { vertical: 'auto', horizontal: 'auto' },
                renderLineHighlight: 'none',
              }}
            />
          </div>
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

  const items: TabsProps['items'] = [
    {
      key: 'configuration',
      label: (
        <Space size={6}>
          <ApiOutlined />
          Basic Info
          {configComplete && <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />}
        </Space>
      ),
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
      label: (
        <Space size={6}>
          <ThunderboltOutlined />
          Multi-Action
          {isTabComplete('multiAction') && <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />}
        </Space>
      ),
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
      label: (
        <Space size={6}>
          <LockOutlined />
          Authentication
          {isTabComplete('authentication') && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
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
      label: (
        <Space size={6}>
          <ClockCircleOutlined />
          Timing & Follow-up
          {isTabComplete('timingFollowUp') && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        isReadOnly ? (
          renderDeliveryModeSummary()
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
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
      label: (
        <Space size={6}>
          <RadarChartOutlined />
          Reliability
          {isTabComplete('reliability') && <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />}
        </Space>
      ),
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

  if (!isMultiAction) {
    items.push({
      key: 'transformation',
      label: (
        <Space size={6}>
          <CodeOutlined />
          Transformation
          {isTabComplete('transformation') && (
            <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />
          )}
        </Space>
      ),
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        isReadOnly ? (
          renderTransformationSummary()
        ) : (
          <TransformationPanelContent
            isCreate={isCreate}
            isEditMode={isEditMode}
            transformationTab={transformationTab}
            selectedEventType={selectedEventType}
            mappingState={mappingState}
            scriptValue={scriptValue}
            lastPreviewMeta={lastPreviewMeta}
            spacing={spacing}
            token={token}
            colors={colors}
            tagTone={tagTone}
            onPreview={onPreview}
            onOpenDesigner={onOpenDesigner}
            formatScriptForDisplay={formatScriptForDisplay}
            isLoading={isLoading}
          />
        )
      ),
    });

    items.push({
      key: 'responseTransform',
      label: (
        <Space size={6}>
          <SwapOutlined />
          Response Transform
          {responseTransformEnabled && <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />}
        </Space>
      ),
      disabled: !configComplete,
      children: wrapContent(
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Validate & normalize the remote API's response"
            description={
              <span>
                Use a JavaScript script to inspect the response body. Call <code>skip(reason)</code> to signal a
                business-level failure (optionally pass <code>{'{ shouldRetry: true }'}</code> to schedule a retry).
                Return a value or <code>undefined</code> to let the delivery succeed normally.
              </span>
            }
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text strong>Enable Response Transformation</Text>
            {isReadOnly ? (
              <Tag color={responseTransformEnabled ? 'green' : 'default'}>
                {responseTransformEnabled ? 'Enabled' : 'Disabled'}
              </Tag>
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
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Function signature: <code>{'async function transform(responseBody, context) { ... }'}</code>
              </Text>
              <Editor
                height="320px"
                language="javascript"
                theme="vs-dark"
                value={responseTransformScript}
                onChange={(value) => onResponseTransformScriptChange?.(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  readOnly: isReadOnly,
                }}
              />
            </Space>
          ) : (
            <Alert
              type="info"
              showIcon
              message="Response transformation is disabled"
              description="Responses will be treated as successful if the HTTP status is 2xx. Enable to add a script that inspects the response body."
            />
          )}
        </Space>
      ),
    });
  }

  // Add Review tab for create/edit mode
  if ((isCreate || isEditMode) && onSave && onCancel) {
    const allTabsComplete =
      configComplete &&
      isTabComplete('authentication') &&
      isTabComplete('timingFollowUp') &&
      isTabComplete('reliability');

    items.push({
      key: 'review',
      label: (
        <Space size={6}>
          <EyeOutlined />
          Review & Submit
          {allTabsComplete && <CheckCircleOutlined style={{ color: colors.success[600], fontSize: 14 }} />}
        </Space>
      ),
      disabled: !configComplete, // Requires Basic Info to be complete
      children: wrapContent(
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="Review Your Configuration"
            description="Please review all settings before saving the event rule. You can click on any tab above to make changes."
          />

          {renderBasicInfoSummary()}

          {isMultiAction && (
            <>
              <Divider style={{ margin: 0 }} />
              {renderMultiActionSummary()}
            </>
          )}

          <Divider style={{ margin: 0 }} />
          {renderAuthSummary()}

          <Divider style={{ margin: 0 }} />
          {renderDeliveryModeSummary()}

          {!isMultiAction && (
            <>
              <Divider style={{ margin: 0 }} />
              {renderTransformationSummary()}
            </>
          )}
        </Space>
      ),
    });
  }

  return items;
};
