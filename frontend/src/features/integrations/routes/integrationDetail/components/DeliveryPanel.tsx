import { Tag, Typography } from 'antd';
import { FieldTimeOutlined } from '@ant-design/icons';
import { spacingToNumber } from '../../../../../design-system/utils';
import { DeliveryReliabilitySection } from './DeliveryReliabilitySection';
import { DeliveryTimingSection } from './DeliveryTimingSection';
import type { DeliveryPanelProps } from './DeliveryPanel.types';
import { getDeliveryModeChipLabel, isScheduledDeliveryMode } from '../utils/deliveryMode';

export const DeliveryPanelHeader = ({
  deliveryModeValue,
  spacing,
  colors
}: Pick<DeliveryPanelProps, 'deliveryModeValue' | 'spacing' | 'colors'>) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: spacingToNumber(spacing[2]) }}>
    <FieldTimeOutlined style={{ fontSize: 18, color: colors.primary[600] }} />
    <div>
      <Typography.Text strong style={{ fontSize: 15 }}>Delivery</Typography.Text>
      {deliveryModeValue && deliveryModeValue !== 'IMMEDIATE' && (
        <Tag
          color={isScheduledDeliveryMode(deliveryModeValue) ? 'processing' : 'cyan'}
          style={{ marginLeft: spacing[2], fontSize: 11 }}
        >
          {getDeliveryModeChipLabel(deliveryModeValue)}
        </Tag>
      )}
    </div>
  </div>
);

export const DeliveryPanel = ({
  spacing,
  ...props
}: DeliveryPanelProps) => {
  return (
    <div style={{ display: 'grid', gap: spacingToNumber(spacing[4]) }}>
      <DeliveryTimingSection spacing={spacing} {...props} />
      <DeliveryReliabilitySection uiConfig={props.uiConfig} spacing={spacing} form={props.form} isLoading={props.isLoading} />
    </div>
  );
};
