import { useState, useEffect } from 'react';
import { Row, Col, Form, Input, Select, Button, Space, Alert, Typography, Popover, App, Tag } from 'antd';
import Editor from '@monaco-editor/react';
import {
  ThunderboltOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  RocketOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { useDesignTokens, withAlpha, cssVar } from '../../../../design-system/utils';
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

// Monaco Editor wrapper component for Form.Item compatibility
const MonacoEditorInput = ({ value, onChange, placeholder, height = '300px', onScriptChange }: any) => {
  const { token } = useDesignTokens();
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
        border: `1px solid ${withAlpha(colors.neutral[900], 0.6)}`,
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
          fontSize: 14,
          lineNumbers: 'on',
          wordWrap: 'on',
        }}
        theme="vs-dark"
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
        { label: 'Script', value: <Tag color={scriptStatusValue.color}>{scriptStatusValue.label}</Tag> },
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
                <ThunderboltOutlined style={{ color: colors.success[600] }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Send immediately</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Send this event as soon as it arrives
                  </Typography.Text>
                </div>
              </Space>
            </Select.Option>
            <Select.Option value="DELAYED" label="Send later">
              <Space>
                <ClockCircleOutlined style={{ color: colors.warning[600] }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Send later</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Schedule one future delivery for this event
                  </Typography.Text>
                </div>
              </Space>
            </Select.Option>
            <Select.Option value="RECURRING" label="Send on a recurring schedule">
              <Space>
                <FieldTimeOutlined style={{ color: colors.info[600] }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Send on a recurring schedule</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Schedule repeated deliveries over time
                  </Typography.Text>
                </div>
              </Space>
            </Select.Option>
            <Select.Option value="WAIT_FOR_CONDITION" label="Hold until a follow-up event arrives">
              <Space>
                <RocketOutlined style={{ color: colors.primary[600] }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Hold until a follow-up event arrives</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Hold this event now and release it only when a related event matches
                  </Typography.Text>
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
          <Space wrap size={spacingToNumber(spacing[3])} style={{ width: '100%', justifyContent: 'space-between' }}>
            {summaryItems.map((item) => (
              <Space key={item.label} size={6}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {item.label}
                </Typography.Text>
                {typeof item.value === 'string' ? (
                  <Typography.Text style={{ fontSize: 13, fontWeight: item.label === 'Mode' ? 600 : 400 }}>
                    {item.value}
                  </Typography.Text>
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
                      icon={<CopyOutlined />}
                      onClick={() => scheduledDeliveryMode && onCopyExampleScript(scheduledDeliveryMode)}
                      style={{ padding: 0, height: 'auto' }}
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
                    <Button type="link" size="small" icon={<CodeOutlined />} style={{ padding: 0, height: 'auto' }}>
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
                icon={<CheckCircleOutlined />}
                onClick={onValidateScript}
                loading={isValidatingScript}
                disabled={isValidatingScript}
                style={{ marginBottom: spacingToNumber(spacing[3]) }}
              >
                {isValidatingScript ? 'Validating...' : 'Validate Script'}
              </Button>
              {schedulingScriptValidation.status !== 'idle' && (
                <Alert
                  type={schedulingScriptValidation.status === 'success' ? 'success' : 'error'}
                  showIcon
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
