import { DeleteOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Row, Select, Tooltip } from 'antd';
import { useEffect } from 'react';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';
import { SingleEventTypeSelectField } from './SingleEventTypeSelectField';

const ACTION_OPTIONS = [
  { label: 'Cancel pending delivery', value: 'CANCEL_PENDING' },
  { label: 'Reschedule pending delivery', value: 'RESCHEDULE_PENDING' },
  { label: 'Replace existing pending delivery', value: 'REPLACE_EXISTING' },
  { label: 'Ignore it', value: 'IGNORE' },
];

interface LifecycleRuleCardProps extends LifecyclePanelSurfaceProps {
  field: { key: React.Key; name: number };
  eventTypeOptions: Array<{ label: string; value: string }>;
  onRemove: (index: number) => void;
}

export const LifecycleRuleCard = ({ field, eventTypeOptions, onRemove, token, colors }: LifecycleRuleCardProps) => {
  const form = Form.useFormInstance();

  useEffect(() => {
    if (!form.getFieldValue(['lifecycleRules', field.name, 'action'])) {
      form.setFieldValue(['lifecycleRules', field.name, 'action'], 'CANCEL_PENDING');
    }
  }, [field.name, form]);

  return (
    <Card size="small" style={{ borderRadius: token.borderRadiusLG, borderColor: colors.neutral[200] }}>
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
            style={{ marginBottom: 0 }}
          >
            <Select options={ACTION_OPTIONS} />
          </Form.Item>
        </Col>
        <Col xs={24} lg={2}>
          <Tooltip title="Remove">
            <Button
              danger
              title="Remove"
              aria-label="Remove lifecycle rule"
              icon={<DeleteOutlined />}
              onClick={() => onRemove(field.name)}
            />
          </Tooltip>
        </Col>
      </Row>
    </Card>
  );
};
