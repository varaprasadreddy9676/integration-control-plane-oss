import { Divider, Skeleton, Space, Typography } from 'antd';
import { DeliverySettingsSectionEnhanced } from '../../../components/detail/DeliverySettingsSectionEnhanced';
import { RateLimitSection } from '../../../components/detail/RateLimitSection';
import type { DeliveryPanelProps } from './DeliveryPanel.types';

const { Text } = Typography;

export const DeliveryReliabilitySection = ({
  uiConfig,
  spacing,
  form,
  isLoading = false,
}: Pick<DeliveryPanelProps, 'uiConfig' | 'spacing' | 'form' | 'isLoading'>) => {
  if (isLoading) {
    return (
      <div style={{ padding: spacing[3] }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Text strong style={{ fontSize: 15 }}>Retries and timeout</Text>
        <div>
          <Text type="secondary">Control retry attempts and request timeouts for outbound delivery.</Text>
        </div>
        <div style={{ marginTop: 12 }}>
          <DeliverySettingsSectionEnhanced uiConfig={uiConfig} spacing={spacing} />
        </div>
      </div>

      <Divider style={{ margin: 0 }} />

      <div>
        <Text strong style={{ fontSize: 15 }}>Rate limiting</Text>
        <div>
          <Text type="secondary">Throttle outbound calls to protect downstream systems.</Text>
        </div>
        <div style={{ marginTop: 12 }}>
          <RateLimitSection form={form} spacing={spacing} />
        </div>
      </div>
    </Space>
  );
};
