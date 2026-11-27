import { Radio, Space, Tooltip } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { cssVar } from '../../../../../design-system/utils';
import type { DeliveryLayout } from '../utils/deliveryLayout';

/** Which way to edit what happens around a delivery: the familiar tabs, or steps in one diagram. */
export const DeliveryLayoutSwitch = ({
  value,
  onChange,
}: {
  value: DeliveryLayout;
  onChange: (value: DeliveryLayout) => void;
}) => (
  <div className="configuration-view-control">
    <Space size={6}>
      <Text weight="semibold">Layout</Text>
      <Tooltip title="Classic keeps the familiar tabs: Transformation, Response Transform, Delivery follow-up. Steps puts checks, follow-ups and alerts in one diagram. Same engine either way, and your choice is remembered.">
        <GatewayIcon size="xsm" name="InfoCircleOutlined" style={{ color: cssVar.text.secondary }} />
      </Tooltip>
    </Space>
    <Radio.Group
      value={value}
      onChange={(event) => onChange(event.target.value)}
      optionType="button"
      buttonStyle="solid"
      size="small"
      aria-label="Layout"
    >
      <Radio.Button value="classic">Classic</Radio.Button>
      <Radio.Button value="steps">Steps</Radio.Button>
    </Radio.Group>
  </div>
);
