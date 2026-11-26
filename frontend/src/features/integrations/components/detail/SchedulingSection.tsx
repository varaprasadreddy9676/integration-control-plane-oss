import { useState, useEffect } from 'react';
import { Row, Col, Form, Input, Select, Space, Popover, App } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import Editor from '@monaco-editor/react';
import { Icon as GatewayIcon } from '../../../../components/common/Icon';
import { editorFontSize, useDesignTokens, cssVar } from '../../../../design-system/utils';
import { useThemeMode } from '../../../../app/theme-provider';
import { HelpPopover, SchedulingScriptHelp, UtilityFunctionsHelp, ScriptSyntaxHelp } from './shared';
import { type SchedulingTestResult } from '../../../../services/api';
import { SchedulingPreview } from './SchedulingPreview';
import { SchedulingTemplates } from './SchedulingTemplates';
import {
  getDeliveryModeLabel,
  isHoldDeliveryMode,
  isScheduledDeliveryMode,
} from '../../routes/integrationDetail/utils/deliveryMode';
// import { SchedulingQuickBuilder } from './SchedulingQuickBuilder';
import { formatDateTime } from '../../../../utils/format';
import { Button } from '../../../../components/common/LegacyButton';
import { StatusBadge } from '../../../../components/common/StatusBadge';
import { InlineNotice as Notice } from '../../../../components/common';

// Monaco Editor wrapper component for Form.Item compatibility
const MonacoEditorInput = ({ value, onChange, placeholder, height = '300px', onScriptChange }: any) => {
  const { token } = useDesignTokens();
  const { mode } = useThemeMode();
  const colors = cssVar.legacy;

  const handleChange = (newValue: string | undefined) => {
    const val = newValue ?? '';
    onChange?.(val);
    onScriptChange?.(val);
  };

  return (
    <div
      style={{
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
        border: `1px solid ${cssVar.border.default}`,
        boxShadow: token.boxShadowSecondary,
      }}
    >
      <Editor
        height={height}
        language="javascript"
        value={value || placeholder || ''}
        onChange={handleChange}
        options={{
          minimap: { enabled: false },
          fontSize: editorFontSize('control'),
          lineNumbers: 'on',
          wordWrap: 'on',
        }}
        theme={mode === 'dark' ? 'vs-dark' : 'light'}
      />
    </div>
  );
};

interface SchedulingSectionProps {
  deliveryModeValue?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING' | 'WAIT_FOR_CONDITION' | 'WAIT_FOR_EVENT';
  schedulingScriptValidation: { status: 'idle' | 'success' | 'error'; message?: string };
  isValidatingScript: boolean;
  onValidateScript: () => void;
  onCopyExampleScript: (mode: 'DELAYED' | 'RECURRING') => void;
  onValidationClose: () => void;
  spacing: any;
  token: any;
  colors: any;
  currentEventType?: string;
  form?: any;
  integrationId?: string;
}

const spacingToNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseInt(value, 10) || 0;
  return 0;
};

/**
 * SchedulingSection - Delivery scheduling configuration
 *
 * Compact design with help popovers for progressive disclosure.
 * Replaces verbose alerts with inline help and popover documentation.
 */
export const SchedulingSection = ({
  deliveryModeValue,
  schedulingScriptValidation,
  isValidatingScript,
  onValidateScript,
  onCopyExampleScript,
  onValidationClose,
  spacing,
  token,
  colors,
  currentEventType,
  form,
  integrationId,
}: SchedulingSectionProps) => {
  const { message } = App.useApp();
  const [utilityDocsOpen, setUtilityDocsOpen] = useState(false);
  const [currentScript, setCurrentScript] = useState<string>('');
  const [previewState, setPreviewState] = useState<{
    preview: SchedulingTestResult | null;
    error: string | null;
    loading: boolean;
  }>({ preview: null, error: null, loading: false });
  const timezoneValue = Form.useWatch(['schedulingConfig', 'timezone']);

  // Initialize currentScript from form value when component mounts or form changes
  useEffect(() => {
    const script = form?.getFieldValue(['schedulingConfig', 'script']);
    if (script && script !== currentScript) {
      setCurrentScript(script);
    }
  }, [form, integrationId]); // Re-run when integrationId changes (new integration loaded)

  const handleTemplateSelect = (script: string) => {
    form?.setFieldValue(['schedulingConfig', 'script'], script);
    setCurrentScript(script);
    message.success('Template applied - you can customize it now');
  };

  // const handleQuickScriptApply = (script: string, label: string) => {
  //   form?.setFieldValue(['schedulingConfig', 'script'], script);
  //   setCurrentScript(script);
  //   message.success(`${label} applied - you can customize it now`);
  // };

  const deliveryModeLabel = getDeliveryModeLabel(deliveryModeValue);

  const scriptStatus = () => {
    if (
      deliveryModeValue === 'IMMEDIATE' ||
      deliveryModeValue === 'WAIT_FOR_CONDITION' ||
      deliveryModeValue === 'WAIT_FOR_EVENT'
    ) {
      return { label: 'Not required', color: 'default' as const };
    }
    if (isValidatingScript) {
      return { label: 'Validating...', color: 'processing' as const };
    }
    if (schedulingScriptValidation.status === 'success') {
      return { label: 'Valid', color: 'success' as const };
    }
    if (schedulingScriptValidation.status === 'error') {
      return { label: 'Invalid', color: 'error' as const };
    }
    return { label: 'Not validated', color: 'default' as const };
  };

  const nextRunLabel = () => {
    if (
      deliveryModeValue === 'IMMEDIATE' ||
      deliveryModeValue === 'WAIT_FOR_CONDITION' ||
      deliveryModeValue === 'WAIT_FOR_EVENT'
    )
      return '—';
    if (previewState.loading) return 'Calculating...';
    if (previewState.error) return 'Preview error';
    if (deliveryModeValue === 'DELAYED') {
      const scheduledFor = previewState.preview?.result?.scheduledFor;
      return scheduledFor ? formatDateTime(scheduledFor) : '—';
    }
    const firstOccurrence =
      previewState.preview?.result?.firstOccurrenceDate ||
      previewState.preview?.result?.sampleOccurrences?.[0]?.scheduledFor;
    return firstOccurrence ? formatDateTime(firstOccurrence) : '—';
  };

  const scriptStatusValue = scriptStatus();
  const nextRunText = nextRunLabel();
  const isScheduledMode = isScheduledDeliveryMode(deliveryModeValue);
  const isHoldMode = isHoldDeliveryMode(deliveryModeValue);
  const scheduledDeliveryMode = isScheduledMode ? deliveryModeValue : undefined;
  const summaryItems = isScheduledMode
    ? [
        { label: 'Mode', value: deliveryModeLabel },
        { label: 'Timezone', value: timezoneValue || 'Asia/Kolkata' },
        { label: 'Next run', value: nextRunText },
        {
          label: 'Script',
          value: (
            <StatusBadge
              label={scriptStatusValue.label}
              variant={
                scriptStatusValue.color === 'success'
                  ? 'success'
                  : scriptStatusValue.color === 'error'
                    ? 'error'
                    : scriptStatusValue.color === 'processing'
                      ? 'info'
                      : 'neutral'
              }
            />
          ),
        },
      ]
    : isHoldMode
      ? [
          { label: 'Mode', value: deliveryModeLabel },
          { label: 'Release', value: 'When a matching follow-up event arrives' },
          { label: 'Scheduling', value: 'Not used' },
        ]
      : [
          { label: 'Mode', value: deliveryModeLabel },
          { label: 'Trigger', value: 'As soon as the event arrives' },
          { label: 'Scheduling', value: 'Not used' },
        ];

  useEffect(() => {
    if (deliveryModeValue === 'IMMEDIATE' || isHoldMode || !currentScript || currentScript.trim().length === 0) {
      setPreviewState({ preview: null, error: null, loading: false });
    }
  }, [deliveryModeValue, currentScript, isHoldMode]);

  return (
    <Row gutter={[spacingToNumber(spacing[4]), 0]}>
      <Col xs={24}>
        <Form.Item
          name="deliveryMode"
          label={
            <Space size={4}>
              When should this send?
              {isScheduledMode && (
                <HelpPopover
                  title="Scheduling Requirements"
                  content={<SchedulingScriptHelp mode={scheduledDeliveryMode} />}
                />
              )}
            </Space>
          }
          tooltip="Choose whether this event should send now, later, repeatedly, or only after a follow-up event"
        >
          <Select size="middle" placeholder="Select delivery timing" optionLabelProp="label">
            <Select.Option value="IMMEDIATE" label="Send immediately">
              <Space>
                <GatewayIcon name="ThunderboltOutlined" className="console-text-success" />
                <div>
                  <div className="console-font-weight-medium">Send immediately</div>
                  <Text type="supporting" size="sm" color="secondary">
                    Send this event as soon as it arrives
                  </Text>
                </div>
              </Space>
            </Select.Option>
            <Select.Option value="DELAYED" label="Send later">
              <Space>
                <GatewayIcon name="ClockCircleOutlined" className="console-text-warning" />
                <div>
                  <div className="console-font-weight-medium">Send later</div>
                  <Text type="supporting" size="sm" color="secondary">
                    Schedule one future delivery for this event
                  </Text>
                </div>
              </Space>
            </Select.Option>
            <Select.Option value="RECURRING" label="Send on a recurring schedule">
              <Space>
                <GatewayIcon name="FieldTimeOutlined" style={{ color: colors.info[600] }} />
                <div>
                  <div className="console-font-weight-medium">Send on a recurring schedule</div>
                  <Text type="supporting" size="sm" color="secondary">
                    Schedule repeated deliveries over time
                  </Text>
                </div>
              </Space>
            </Select.Option>
            <Select.Option value="WAIT_FOR_CONDITION" label="Hold until a follow-up event arrives">
              <Space>
                <GatewayIcon name="RocketOutlined" className="console-text-accent" />
                <div>
                  <div className="console-font-weight-medium">Hold until a follow-up event arrives</div>
                  <Text type="supporting" size="sm" color="secondary">
                    Hold this event now and release it only when a related event matches
                  </Text>
                </div>
              </Space>
            </Select.Option>
          </Select>
        </Form.Item>
      </Col>

      <Col xs={24}>
        <div
          style={{
            background: cssVar.bg.subtle,
            border: `1px solid ${cssVar.border.default}`,
            borderRadius: token.borderRadiusLG,
            padding: `${spacing[2]} ${spacing[3]}`,
            marginBottom: spacingToNumber(spacing[3]),
          }}
        >
          <Space wrap size={spacingToNumber(spacing[3])} className="console-width-full-between">
            {summaryItems.map((item) => (
              <Space key={item.label} size={6}>
                <Text type="supporting" size="sm" color="secondary">
                  {item.label}
                </Text>
                {typeof item.value === 'string' ? (
                  <Text size="base" weight={item.label === 'Mode' ? 'semibold' : 'normal'}>
                    {item.value}
                  </Text>
                ) : (
                  item.value
                )}
              </Space>
            ))}
          </Space>
        </div>
      </Col>

      {isScheduledMode && (
        <>
          <Col xs={24}>
            <Form.Item
              name={['schedulingConfig', 'description']}
              label="Timing Description (Optional)"
              tooltip="Describe the timing you want this schedule to follow"
            >
              <Input.TextArea rows={2} placeholder="e.g., Send 24 hours before the booking starts" size="middle" />
            </Form.Item>
          </Col>

          <Col xs={24} md={12}>
            <Form.Item
              name={['schedulingConfig', 'timezone']}
              label="Timezone"
              initialValue="Asia/Kolkata"
              tooltip="Script timezone"
            >
              <Select size="middle" placeholder="Select timezone">
                <Select.Option value="Asia/Kolkata">Asia/Kolkata (IST)</Select.Option>
                <Select.Option value="UTC">UTC</Select.Option>
                <Select.Option value="America/New_York">America/New_York (EST/EDT)</Select.Option>
                <Select.Option value="Europe/London">Europe/London (GMT/BST)</Select.Option>
                <Select.Option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</Select.Option>
                <Select.Option value="Asia/Tokyo">Asia/Tokyo (JST)</Select.Option>
                <Select.Option value="Australia/Sydney">Australia/Sydney (AEDT/AEST)</Select.Option>
              </Select>
            </Form.Item>
          </Col>

          {/* Quick Scheduler (disabled for now; keep code for future enablement) */}
          {/*
          {(deliveryModeValue === 'DELAYED' || deliveryModeValue === 'RECURRING') && (
            <Col xs={24}>
              <SchedulingQuickBuilder
                deliveryMode={deliveryModeValue}
                timezone={timezoneValue || 'Asia/Kolkata'}
                currentScript={currentScript}
                onApplyScript={handleQuickScriptApply}
              />
            </Col>
          )}
          */}

          {/* Quick Templates */}
          {isScheduledMode && (
            <Col xs={24}>
              <SchedulingTemplates deliveryMode={scheduledDeliveryMode!} onSelectTemplate={handleTemplateSelect} />
            </Col>
          )}

          <Col xs={24}>
            <Form.Item
              name={['schedulingConfig', 'script']}
              label={
                <Space>
                  <span>Scheduling Script</span>
                  <HelpPopover title="Script Syntax" content={<ScriptSyntaxHelp />} />
                  {isScheduledMode && (
                    <Button
                      type="link"
                      size="small"
                      icon={<GatewayIcon name="CopyOutlined" />}
                      onClick={() => scheduledDeliveryMode && onCopyExampleScript(scheduledDeliveryMode)}
                      className="console-control-reset-padding"
                    >
                      Copy example
                    </Button>
                  )}
                  <Popover
                    content={<UtilityFunctionsHelp />}
                    title="Available Utility Functions"
                    trigger="click"
                    open={utilityDocsOpen}
                    onOpenChange={setUtilityDocsOpen}
                    overlayStyle={{ maxWidth: 500 }}
                  >
                    <Button
                      type="link"
                      size="small"
                      icon={<GatewayIcon name="CodeOutlined" />}
                      className="console-control-reset-padding"
                    >
                      View utility docs
                    </Button>
                  </Popover>
                </Space>
              }
              rules={[
                {
                  required: deliveryModeValue === 'DELAYED' || deliveryModeValue === 'RECURRING',
                  message: 'Scheduling script is required for delayed/recurring delivery',
                },
              ]}
              tooltip={
                deliveryModeValue === 'DELAYED'
                  ? 'JavaScript function that returns a single Unix timestamp (number) for when to deliver the integration'
                  : 'JavaScript function that returns a config object with firstOccurrence, intervalMs, and maxOccurrences or endDate'
              }
            >
              <MonacoEditorInput
                height="300px"
                onScriptChange={setCurrentScript}
                placeholder={
                  deliveryModeValue === 'DELAYED'
                    ? `// Example: Send 24 hours before appointment\nconst appointmentTime = parseDate(event.appointmentDateTime);\nconst scheduledTime = subtractHours(appointmentTime, 24);\nreturn toTimestamp(scheduledTime);`
                    : `// Example: Send every 6 hours, max 5 times\nconst firstTime = addHours(now(), 1);\nreturn {\n  firstOccurrence: toTimestamp(firstTime),\n  intervalMs: 6 * 60 * 60 * 1000,\n  maxOccurrences: 5\n};`
                }
              />
            </Form.Item>
          </Col>

          {/* Schedule Preview */}
          {isScheduledMode && (
            <Col xs={24}>
              <SchedulingPreview
                integrationId={integrationId}
                script={currentScript}
                deliveryMode={scheduledDeliveryMode!}
                eventType={currentEventType}
                onPreviewChange={setPreviewState}
              />
            </Col>
          )}
          {isScheduledMode && (
            <Col xs={24}>
              <Button
                icon={<GatewayIcon name="CheckCircleOutlined" />}
                onClick={onValidateScript}
                loading={isValidatingScript}
                disabled={isValidatingScript}
                style={{ marginBottom: spacingToNumber(spacing[3]) }}
              >
                {isValidatingScript ? 'Validating...' : 'Validate Script'}
              </Button>
              {schedulingScriptValidation.status !== 'idle' && (
                <Notice
                  type={schedulingScriptValidation.status === 'success' ? 'success' : 'error'}
                  message={schedulingScriptValidation.status === 'success' ? 'Script Valid' : 'Validation Error'}
                  description={schedulingScriptValidation.message}
                  closable
                  onClose={onValidationClose}
                  style={{ marginTop: spacingToNumber(spacing[2]) }}
                />
              )}
            </Col>
          )}
        </>
      )}
    </Row>
  );
};
