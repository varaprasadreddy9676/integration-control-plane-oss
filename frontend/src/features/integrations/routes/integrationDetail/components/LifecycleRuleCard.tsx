import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { Col, Form, Row, Select, Space } from '@/components/common/LegacyAntdControls';
import { useEffect } from 'react';
import { SingleEventTypeSelectField } from './SingleEventTypeSelectField';
import { Button } from '../../../../../components/common/LegacyButton';
import { Row as ItemRow } from '../../../../../design-system/primitives';

const ACTION_OPTIONS = [
  { label: 'Cancel pending delivery', value: 'CANCEL_PENDING' },
  { label: 'Reschedule pending delivery', value: 'RESCHEDULE_PENDING' },
  { label: 'Replace existing pending delivery', value: 'REPLACE_EXISTING' },
  { label: 'Ignore it', value: 'IGNORE' },
];

interface LifecycleRuleCardProps {
  field: { key: React.Key; name: number };
  index?: number;
  eventTypeOptions: Array<{ label: string; value: string }>;
  onRemove: (index: number) => void;
  token?: unknown;
  colors?: unknown;
}

export const LifecycleRuleCard = ({ field, index, eventTypeOptions, onRemove }: LifecycleRuleCardProps) => {
  const form = Form.useFormInstance();
  const ruleNumber = (index ?? field.name) + 1;

  useEffect(() => {
    if (!form.getFieldValue(['lifecycleRules', field.name, 'action'])) {
      form.setFieldValue(['lifecycleRules', field.name, 'action'], 'CANCEL_PENDING');
    }
  }, [field.name, form]);

  return (
    <ItemRow
      title={
        <Space>
          <GatewayIcon name="ClockCircleOutlined" />
          <span>Lifecycle rule {ruleNumber}</span>
        </Space>
      }
      actions={
        <Button
          danger
          title="Remove"
          aria-label="Remove lifecycle rule"
          icon={<GatewayIcon name="DeleteOutlined" />}
          onClick={() => onRemove(field.name)}
        />
      }
    >
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <SingleEventTypeSelectField
            formItemName={[field.name, 'eventTypes']}
            storePath={['lifecycleRules', field.name, 'eventTypes']}
            label="Follow-up event"
            placeholder="Choose later event"
            options={eventTypeOptions}
            requiredMessage="Select a follow-up event"
            onSelect={(eventType) => {
              form.setFieldValue(['lifecycleRules', field.name, 'eventTypes'], eventType ? [eventType] : []);
            }}
          />
        </Col>
        <Col xs={24} lg={10}>
          <Form.Item
            name={[field.name, 'action']}
            label="Then"
            initialValue="CANCEL_PENDING"
            rules={[{ required: true, message: 'Action is required' }]}
            className="console-margin-bottom-none"
          >
            <Select options={ACTION_OPTIONS} />
          </Form.Item>
        </Col>
      </Row>
    </ItemRow>
  );
};
