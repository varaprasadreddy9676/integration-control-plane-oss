import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { spacingToNumber } from '../../../../../design-system/utils';
import { DeliveryReliabilitySection } from './DeliveryReliabilitySection';
import { DeliveryTimingSection } from './DeliveryTimingSection';
import type { DeliveryPanelProps } from './DeliveryPanel.types';
import { getDeliveryModeChipLabel, isScheduledDeliveryMode } from '../utils/deliveryMode';
import { StatusBadge } from '../../../../../components/common/StatusBadge';

export const DeliveryPanelHeader = ({
  deliveryModeValue,
  spacing,
  colors,
}: Pick<DeliveryPanelProps, 'deliveryModeValue' | 'spacing' | 'colors'>) => (
  <div className="console-flex-center-gap-2">
    <GatewayIcon
      name="FieldTimeOutlined"
      className="console-title-accent"
    />
    <div>
      <Text weight="semibold">Delivery</Text>
      {deliveryModeValue && deliveryModeValue !== 'IMMEDIATE' && (
        <StatusBadge
          label={getDeliveryModeChipLabel(deliveryModeValue)}
          variant={isScheduledDeliveryMode(deliveryModeValue) ? 'info' : 'neutral'}
          size="small"
          showIcon={false}
        />
      )}
    </div>
  </div>
);

export const DeliveryPanel = ({ spacing, ...props }: DeliveryPanelProps) => {
  return (
    <div style={{ display: 'grid', gap: spacingToNumber(spacing[4]) }}>
      <DeliveryTimingSection spacing={spacing} {...props} />
      <DeliveryReliabilitySection
        uiConfig={props.uiConfig}
        spacing={spacing}
        form={props.form}
        isLoading={props.isLoading}
      />
    </div>
  );
};
