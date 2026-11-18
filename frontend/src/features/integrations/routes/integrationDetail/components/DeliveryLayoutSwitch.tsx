import { Radio, Space, Tooltip, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { cssVar } from '../../../../../design-system/utils';
import type { DeliveryLayout } from '../utils/deliveryLayout';

/** Which way to edit what happens around a delivery: the familiar tabs, or steps in one diagram. */
export const DeliveryLayoutSwitch = ({ value, onChange }: { value: DeliveryLayout; onChange: (value: DeliveryLayout) => void }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
    <Space size={6}>
      <Typography.Text strong>Layout</Typography.Text>
      <Tooltip title="Classic keeps the familiar tabs: Transformation, Response Transform, Delivery follow-up. Steps puts checks, follow-ups and alerts in one diagram. Same engine either way, and your choice is remembered.">
        <InfoCircleOutlined style={{ color: cssVar.text.secondary, fontSize: 12 }} />
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
