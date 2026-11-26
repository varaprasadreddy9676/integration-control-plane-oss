import { Space } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import { ConfigSection } from '../../../../../components/common/ConfigSection';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import type { DeliveryPanelProps } from './DeliveryPanel.types';
import { StatusBadge } from '../../../../../components/common/StatusBadge';

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
    <Space direction="vertical" size={16} className="console-width-full">
      <ConfigSection icon={<GatewayIcon name="ClockCircleOutlined" />} title="Retries and timeout">
        <Space direction="vertical" size="small" className="console-width-full">
          <div className="console-flex-gap-2">
            <Text type="secondary" className="console-label-min-width">
              Request Timeout:
            </Text>
            <Text strong>{timeoutMs} ms</Text>
          </div>
          <div className="console-flex-gap-2">
            <Text type="secondary" className="console-label-min-width">
              Retry Attempts:
            </Text>
            <Text strong>{retryCount}</Text>
          </div>
        </Space>
      </ConfigSection>

      <ConfigSection icon={<GatewayIcon name="ThunderboltOutlined" />} title="Rate limiting">
        <Space direction="vertical" size="small" className="console-width-full">
          <div className="console-flex-gap-2">
            <Text type="secondary" className="console-label-min-width">
              Status:
            </Text>
            <StatusBadge
              label={rateLimitEnabled ? 'Enabled' : 'Disabled'}
              variant={rateLimitEnabled ? 'success' : 'neutral'}
            />
          </div>
          {rateLimitEnabled && (
            <>
              <div className="console-flex-gap-2">
                <Text type="secondary" className="console-label-min-width">
                  Max Requests:
                </Text>
                <Text strong>{maxRequests || 100}</Text>
              </div>
              <div className="console-flex-gap-2">
                <Text type="secondary" className="console-label-min-width">
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
