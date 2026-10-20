import { Col, Form, InputNumber, Radio, Row, Select, Space, Typography } from 'antd';

const { Text } = Typography;

interface DateFieldOption {
  label: string;
  value: string;
}

interface ConditionReleaseTimingFieldsProps {
  ruleName: number;
  dateFieldOptions: DateFieldOption[];
}

export const ConditionReleaseTimingFields = ({ ruleName, dateFieldOptions }: ConditionReleaseTimingFieldsProps) => {
  const form = Form.useFormInstance();
  const modePath = ['conditionRules', ruleName, 'releaseTiming', 'mode'] as const;
  const mode = Form.useWatch(modePath, form) || 'IMMEDIATE';

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Form.Item label="When should it release?" style={{ marginBottom: 0 }}>
        <Radio.Group
          buttonStyle="solid"
          optionType="button"
          style={{ width: '100%' }}
          value={mode}
          onChange={(event) => {
            const nextMode = event?.target?.value || 'IMMEDIATE';
            form.setFieldValue(modePath, nextMode);

            if (nextMode !== 'OFFSET_FROM_EVENT_FIELD') {
              form.setFieldValue(['conditionRules', ruleName, 'releaseTiming', 'eventFieldPath'], '');
            }
          }}
        >
          <Radio.Button value="IMMEDIATE" style={{ width: '50%', textAlign: 'center' }}>
            Immediately
          </Radio.Button>
          <Radio.Button value="OFFSET_FROM_EVENT_FIELD" style={{ width: '50%', textAlign: 'center' }}>
            Later from follow-up date
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      {mode === 'OFFSET_FROM_EVENT_FIELD' && (
        <>
          <Row gutter={[8, 8]}>
            <Col xs={24} lg={12}>
              <Form.Item
                name={[ruleName, 'releaseTiming', 'eventFieldPath']}
                label="Use date from follow-up event"
                rules={[{ required: true, message: 'Select a date or datetime field' }]}
                style={{ marginBottom: 0 }}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="Choose date field"
                  options={dateFieldOptions}
                />
              </Form.Item>
            </Col>
            <Col xs={24} lg={6}>
              <Form.Item
                name={[ruleName, 'releaseTiming', 'offsetValue']}
                label="Wait"
                rules={[{ required: true, message: 'Enter offset' }]}
                style={{ marginBottom: 0 }}
              >
                <InputNumber min={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} lg={6}>
              <Form.Item name={[ruleName, 'releaseTiming', 'offsetUnit']} label="Unit" style={{ marginBottom: 0 }}>
                <Select
                  options={[
                    { label: 'Minutes', value: 'MINUTES' },
                    { label: 'Hours', value: 'HOURS' },
                    { label: 'Days', value: 'DAYS' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          {dateFieldOptions.length === 0 && (
            <Text type="secondary">No date or datetime fields were found in the selected follow-up event.</Text>
          )}
        </>
      )}
    </Space>
  );
};
