import { Space, Tag, Typography } from 'antd';
import { ConfigSection } from '../../../../../components/common/ConfigSection';
import { ThunderboltOutlined, ClockCircleOutlined } from '@ant-design/icons';
import type { DeliveryPanelProps } from './DeliveryPanel.types';

const { Text } = Typography;

/**
 * Read-only view of Retries/Timeout and Rate Limiting settings — shown
 * when viewing an integration without Edit mode active. Mirrors what the
 * form would submit, but as plain values instead of disabled inputs, so
 * "you're looking at data" is unambiguous rather than "this control isn't
 * responding."
 */
export const DeliveryReliabilitySummary = ({
  uiConfig,
  spacing,
  form,
}: Pick<DeliveryPanelProps, 'uiConfig' | 'spacing' | 'form'>) => {
  // Reliability's edit-mode Form.Items aren't mounted while this read-only
  // summary is showing, so Form.useWatch has nothing to subscribe to and
  // silently returns undefined. getFieldValue reads directly from the form
  // store regardless of whether the field has ever been mounted.
  const timeoutMs = form?.getFieldValue('timeoutMs') ?? uiConfig?.validationRules?.timeout?.default ?? 30000;
  const retryCount = form?.getFieldValue('retryCount') ?? uiConfig?.validationRules?.retry?.default ?? 3;
  const rateLimitEnabled = form?.getFieldValue(['rateLimits', 'enabled']);
  const maxRequests = form?.getFieldValue(['rateLimits', 'maxRequests']);
  const windowSeconds = form?.getFieldValue(['rateLimits', 'windowSeconds']);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <ConfigSection icon={<ClockCircleOutlined />} title="Retries and timeout">
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: spacing[2] }}>
            <Text type="secondary" style={{ minWidth: 150 }}>
              Request Timeout:
            </Text>
            <Text strong>{timeoutMs} ms</Text>
          </div>
          <div style={{ display: 'flex', gap: spacing[2] }}>
            <Text type="secondary" style={{ minWidth: 150 }}>
              Retry Attempts:
            </Text>
            <Text strong>{retryCount}</Text>
          </div>
        </Space>
      </ConfigSection>

      <ConfigSection icon={<ThunderboltOutlined />} title="Rate limiting">
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <div style={{ display: 'flex', gap: spacing[2] }}>
            <Text type="secondary" style={{ minWidth: 150 }}>
              Status:
            </Text>
            <Tag color={rateLimitEnabled ? 'green' : 'default'}>{rateLimitEnabled ? 'Enabled' : 'Disabled'}</Tag>
          </div>
          {rateLimitEnabled && (
            <>
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Text type="secondary" style={{ minWidth: 150 }}>
                  Max Requests:
                </Text>
                <Text strong>{maxRequests || 100}</Text>
              </div>
              <div style={{ display: 'flex', gap: spacing[2] }}>
                <Text type="secondary" style={{ minWidth: 150 }}>
                  Window (seconds):
                </Text>
                <Text strong>{windowSeconds || 60}</Text>
              </div>
            </>
          )}
        </Space>
      </ConfigSection>
    </Space>
  );
};
