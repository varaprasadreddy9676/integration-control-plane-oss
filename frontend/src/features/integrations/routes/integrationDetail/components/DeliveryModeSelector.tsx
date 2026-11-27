import { Radio, Space, Tooltip } from '@/components/common/LegacyAntdControls';
import type { RadioChangeEvent } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { cssVar } from '../../../../../design-system/utils';

interface DeliveryModeSelectorProps {
  value: 'single' | 'multi';
  onChange: (value: 'single' | 'multi') => void;
}

export const DeliveryModeSelector = ({ value, onChange }: DeliveryModeSelectorProps) => {
  const handleChange = (e: RadioChangeEvent) => {
    onChange(e.target.value);
  };

  return (
    <div className="configuration-view-control">
      <Space size={6}>
        <Text weight="semibold">Delivery mode</Text>
        <Tooltip title="Choose single delivery for one target endpoint, or multi-action for sequential requests.">
          <GatewayIcon size="xsm" name="InfoCircleOutlined" style={{ color: cssVar.text.secondary }} />
        </Tooltip>
      </Space>
      <Radio.Group value={value} onChange={handleChange} optionType="button" buttonStyle="solid" size="small">
        <Radio.Button value="single">Single delivery</Radio.Button>
        <Radio.Button value="multi">Multi-action</Radio.Button>
      </Radio.Group>
    </div>
  );
};
