import { Col, Form, InputNumber, Radio, Row, Select, Space } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';

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
    <Space direction="vertical" size={8} className="console-width-full">
      <Form.Item label="When should it release?" className="console-margin-bottom-none">
        <Radio.Group
          buttonStyle="solid"
          optionType="button" className="console-width-full"
          value={mode}
          onChange={(event) => {
            const nextMode = event?.target?.value || 'IMMEDIATE';
            form.setFieldValue(modePath, nextMode);

            if (nextMode !== 'OFFSET_FROM_EVENT_FIELD') {
              form.setFieldValue(['conditionRules', ruleName, 'releaseTiming', 'eventFieldPath'], '');
            }
          }}
        >
          <Radio.Button value="IMMEDIATE" className="ui-extracted-855d6e94b1">
            Immediately
          </Radio.Button>
          <Radio.Button value="OFFSET_FROM_EVENT_FIELD" className="ui-extracted-855d6e94b1">
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
                rules={[{ required: true, message: 'Select a date or datetime field' }]} className="console-margin-bottom-none"
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
                rules={[{ required: true, message: 'Enter offset' }]} className="console-margin-bottom-none"
              >
                <InputNumber min={0} step={1} className="console-width-full" />
              </Form.Item>
            </Col>
            <Col xs={24} lg={6}>
              <Form.Item
                name={[ruleName, 'releaseTiming', 'offsetUnit']}
                label="Unit" className="console-margin-bottom-none"
              >
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
