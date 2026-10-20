import { Radio, Space, Tooltip, Typography } from 'antd';
import type { RadioChangeEvent } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}
    >
      <Space size={6}>
        <Typography.Text strong>Delivery mode</Typography.Text>
        <Tooltip title="Choose single delivery for one target endpoint, or multi-action for sequential requests.">
          <InfoCircleOutlined style={{ color: cssVar.text.secondary, fontSize: 12 }} />
        </Tooltip>
      </Space>
      <Radio.Group value={value} onChange={handleChange} optionType="button" buttonStyle="solid" size="small">
        <Radio.Button value="single">Single delivery</Radio.Button>
        <Radio.Button value="multi">Multi-action</Radio.Button>
      </Radio.Group>
    </div>
  );
};
