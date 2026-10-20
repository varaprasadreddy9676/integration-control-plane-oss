import { useState } from 'react';
import { Row, Col, Form, InputNumber, Radio, Space, Typography } from 'antd';
import { spacingToNumber, cssVar } from '../../../../design-system/utils';

const { Text } = Typography;

interface DeliverySettingsSectionEnhancedProps {
  uiConfig?: any;
  spacing: any;
}

/**
 * DeliverySettingsSectionEnhanced - Basic vs Advanced delivery settings
 *
 * Basic mode: Quick presets for common retry/timeout scenarios
 * Advanced mode: Full numerical control
 */
export const DeliverySettingsSectionEnhanced = ({ uiConfig, spacing }: DeliverySettingsSectionEnhancedProps) => {
  const colors = cssVar.legacy;
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  const form = Form.useFormInstance();

  // Preset configurations
  const presets = [
    {
      value: 'fast',
      label: 'Fast & Light',
      description: '5s timeout, 1 retry',
      timeout: 5000,
      retry: 1,
    },
    {
      value: 'standard',
      label: 'Standard',
      description: '30s timeout, 3 retries',
      timeout: 30000,
      retry: 3,
    },
    {
      value: 'reliable',
      label: 'Reliable',
      description: '60s timeout, 5 retries',
      timeout: 60000,
      retry: 5,
    },
  ];

  const handlePresetChange = (presetValue: string) => {
    const preset = presets.find((p) => p.value === presetValue);
    if (preset) {
      form.setFieldsValue({
        timeoutMs: preset.timeout,
        retryCount: preset.retry,
      });
    }
  };

  // Determine current preset (if any)
  const currentTimeout = Form.useWatch('timeoutMs', form);
  const currentRetry = Form.useWatch('retryCount', form);
  const currentPreset = presets.find((p) => p.timeout === currentTimeout && p.retry === currentRetry)?.value;

  return (
    <div>
      {/* Mode Toggle */}
      <div style={{ marginBottom: spacing[4] }}>
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} buttonStyle="solid" size="middle">
          <Radio.Button value="basic">Basic</Radio.Button>
          <Radio.Button value="advanced">Advanced</Radio.Button>
        </Radio.Group>
      </div>

      {/* Basic Mode - Presets */}
      {mode === 'basic' && (
        <div>
          <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: spacing[2] }}>
            Choose a preset retry and timeout strategy based on your use case.
          </Text>

          <Radio.Group
            value={currentPreset}
            onChange={(e) => handlePresetChange(e.target.value)}
            style={{ width: '100%' }}
          >
            <Space direction="vertical" size={spacingToNumber(spacing[1])} style={{ width: '100%' }}>
              {presets.map((preset) => (
                <Radio
                  key={preset.value}
                  value={preset.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    width: '100%',
                    margin: 0,
                    padding: `${spacing[2]} ${spacing[3]}`,
                    borderRadius: 6,
                    border: `1px solid ${currentPreset === preset.value ? colors.primary[400] : colors.neutral[200]}`,
                    background: currentPreset === preset.value ? colors.primary[50] : 'transparent',
                  }}
                >
                  <Space size={6}>
                    <Text strong style={{ fontSize: 13 }}>
                      {preset.label}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {preset.description}
                    </Text>
                  </Space>
                </Radio>
              ))}
            </Space>
          </Radio.Group>

          {/* Hidden fields that actually store the values */}
          <div style={{ display: 'none' }}>
            <Form.Item name="timeoutMs">
              <InputNumber />
            </Form.Item>
            <Form.Item name="retryCount">
              <InputNumber />
            </Form.Item>
          </div>
        </div>
      )}

      {/* Advanced Mode - Full Control */}
      {mode === 'advanced' && (
        <Row gutter={[spacingToNumber(spacing[4]), 0]}>
          <Col xs={24} md={12}>
            <Form.Item
              name="timeoutMs"
              label="Request Timeout"
              rules={[
                { required: true, message: 'Timeout is required' },
                {
                  type: 'number',
                  min: uiConfig?.validationRules.timeout.min ?? 500,
                  max: uiConfig?.validationRules.timeout.max ?? 60000,
                  message: `Must be between ${uiConfig?.validationRules.timeout.min ?? 500}-${uiConfig?.validationRules.timeout.max ?? 60000} ms`,
                },
              ]}
            >
              <InputNumber
                min={uiConfig?.validationRules.timeout.min ?? 500}
                max={uiConfig?.validationRules.timeout.max ?? 60000}
                step={uiConfig?.validationRules.timeout.step ?? 500}
                style={{ width: '100%' }}
                addonAfter="ms"
                size="middle"
                placeholder={String(uiConfig?.validationRules.timeout.default ?? 30000)}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="retryCount"
              label="Retry Attempts"
              rules={[
                { required: true, message: 'Retry count is required' },
                {
                  type: 'number',
                  min: uiConfig?.validationRules.retry.min ?? 0,
                  max: uiConfig?.validationRules.retry.max ?? 10,
                  message: `Must be between ${uiConfig?.validationRules.retry.min ?? 0}-${uiConfig?.validationRules.retry.max ?? 10}`,
                },
              ]}
            >
              <InputNumber
                min={uiConfig?.validationRules.retry.min ?? 0}
                max={uiConfig?.validationRules.retry.max ?? 10}
                style={{ width: '100%' }}
                addonAfter="retries"
                size="middle"
                placeholder={String(uiConfig?.validationRules.retry.default ?? 3)}
              />
            </Form.Item>
          </Col>
        </Row>
      )}
    </div>
  );
};
