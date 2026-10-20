import { Form, Select } from 'antd';
import { getPrimaryEventType, toSingleEventTypeList } from '../utils/followUpRule';

interface SingleEventTypeSelectFieldProps {
  /**
   * Relative path for Form.Item name — relative to the nearest Form.List context.
   * E.g. [field.name, 'eventTypes'] when inside Form.List name="conditionRules".
   */
  formItemName: (string | number)[];
  /**
   * Absolute path for form store operations (setFieldValue / useWatch).
   * E.g. ['conditionRules', field.name, 'eventTypes'].
   */
  storePath: (string | number)[];
  label: string;
  placeholder: string;
  options: Array<{ label: string; value: string }>;
  requiredMessage: string;
  /**
   * Called when the selected event type changes.
   * `prevEventType` is captured from the render closure before any store
   * mutation — safe to use even if Form.Item updates the store before onChange.
   */
  onSelect?: (eventType: string | undefined, prevEventType: string | undefined) => void;
}

export const SingleEventTypeSelectField = ({
  formItemName,
  storePath,
  label,
  placeholder,
  options,
  requiredMessage,
  onSelect,
}: SingleEventTypeSelectFieldProps) => {
  const form = Form.useFormInstance();
  const rawValue = Form.useWatch(storePath, form);
  const selectedValue = getPrimaryEventType(rawValue);

  const handleChange = (value?: string) => {
    const nextValue = typeof value === 'string' ? value : undefined;
    // `selectedValue` is from the render closure — it is the value before this
    // interaction. Ant Design's Form.Item may update the store before our
    // callback fires, so we must NOT call form.getFieldValue here.
    onSelect?.(nextValue, selectedValue);
    form.setFieldValue(storePath, toSingleEventTypeList(nextValue));
  };

  return (
    <Form.Item
      name={formItemName}
      label={label}
      style={{ marginBottom: 0 }}
      rules={[
        {
          validator: async (_rule, value) => {
            if (getPrimaryEventType(value)) {
              return;
            }

            throw new Error(requiredMessage);
          },
        },
      ]}
    >
      <Select
        allowClear
        showSearch
        placeholder={placeholder}
        options={options}
        optionFilterProp="label"
        value={selectedValue}
        onChange={(value) => handleChange(typeof value === 'string' ? value : undefined)}
      />
    </Form.Item>
  );
};
