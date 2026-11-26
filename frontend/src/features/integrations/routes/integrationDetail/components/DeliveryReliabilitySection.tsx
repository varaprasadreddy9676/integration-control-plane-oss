import { Divider, Space } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import { DeliverySettingsSectionEnhanced } from '../../../components/detail/DeliverySettingsSectionEnhanced';
import { RateLimitSection } from '../../../components/detail/RateLimitSection';
import { PreDeliveryChecksSection } from '../../../components/detail/PreDeliveryChecksSection';
import type { DeliveryPanelProps } from './DeliveryPanel.types';
import { StatePanel } from '../../../../../components/common/StatePanel';

const { Text } = Typography;

export const DeliveryReliabilitySection = ({
  uiConfig,
  spacing,
  form,
  isLoading = false,
}: Pick<DeliveryPanelProps, 'uiConfig' | 'spacing' | 'form' | 'isLoading'>) => {
  if (isLoading) {
    return <StatePanel glyph="connecting" tone="busy" size="compact" title="Loading delivery controls" />;
  }

  return (
    <Space direction="vertical" size={16} className="console-width-full">
      <div>
        <Text strong className="console-type-section">
          Retries and timeout
        </Text>
        <div>
          <Text type="secondary">Control retry attempts and request timeouts for outbound delivery.</Text>
        </div>
        <div className="console-margin-top-3">
          <DeliverySettingsSectionEnhanced uiConfig={uiConfig} spacing={spacing} />
        </div>
      </div>

      <Divider className="console-margin-none" />

      <div>
        <Text strong className="console-type-section">
          Rate limiting
        </Text>
        <div>
          <Text type="secondary">Throttle outbound calls to protect downstream systems.</Text>
        </div>
        <div className="console-margin-top-3">
          <RateLimitSection form={form} spacing={spacing} />
        </div>
      </div>

      <Divider className="console-margin-none" />

      <div>
        <Text strong className="console-type-section">
          Pre-delivery URL checks
        </Text>
        <div>
          <Text type="secondary">
            Fetch URLs the target downloads on its own (such as a document link) before sending, so a slow or broken
            link is retried or failed here instead of being reported later by the target.
          </Text>
        </div>
        <div className="console-margin-top-3">
          <PreDeliveryChecksSection spacing={spacing} />
        </div>
      </div>
    </Space>
  );
};
