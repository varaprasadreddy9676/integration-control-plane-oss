import { useEffect, useMemo, useState } from 'react';
import { Button, Col, Form, Input, Row, Select, Space, Spin, Typography } from 'antd';
import { CloseOutlined, PlusOutlined } from '@ant-design/icons';
import type { ConditionPredicateValueType } from '../../../../../mocks/types';
import { ConditionValueInput } from './ConditionValueInput';

const { Text } = Typography;

interface ConditionFieldOption {
  label: string;
  value: string;
  type?: string;
}

interface ConditionPredicateEditorProps {
  ruleName: number;
  fieldOptions: ConditionFieldOption[];
  followUpEventType?: string;
  isLoadingFieldOptions?: boolean;
}

const getValueTypeForField = (fieldType?: string): ConditionPredicateValueType => {
  switch (String(fieldType || '').toLowerCase()) {
    case 'number':
    case 'integer':
    case 'float':
    case 'double':
      return 'NUMBER';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
    case 'datetime':
    case 'timestamp':
      return 'DATE';
    default:
      return 'STRING';
  }
};

const OPERATOR_OPTIONS: Record<ConditionPredicateValueType, Array<{ label: string; value: string }>> = {
  STRING: [
    { label: 'equals', value: 'EQUALS' },
    { label: 'does not equal', value: 'NOT_EQUALS' },
    { label: 'contains', value: 'CONTAINS' },
    { label: 'exists', value: 'EXISTS' },
    { label: 'does not exist', value: 'NOT_EXISTS' },
  ],
  NUMBER: [
    { label: 'equals', value: 'EQUALS' },
    { label: 'is greater than', value: 'GREATER_THAN' },
    { label: 'is greater than or equal to', value: 'GREATER_THAN_OR_EQUAL' },
    { label: 'is less than', value: 'LESS_THAN' },
    { label: 'is less than or equal to', value: 'LESS_THAN_OR_EQUAL' },
    { label: 'does not equal', value: 'NOT_EQUALS' },
    { label: 'exists', value: 'EXISTS' },
    { label: 'does not exist', value: 'NOT_EXISTS' },
  ],
  BOOLEAN: [
    { label: 'is', value: 'EQUALS' },
    { label: 'is not', value: 'NOT_EQUALS' },
    { label: 'exists', value: 'EXISTS' },
    { label: 'does not exist', value: 'NOT_EXISTS' },
  ],
  DATE: [
    { label: 'equals', value: 'EQUALS' },
    { label: 'is after', value: 'GREATER_THAN' },
    { label: 'is on or after', value: 'GREATER_THAN_OR_EQUAL' },
    { label: 'is before', value: 'LESS_THAN' },
    { label: 'is on or before', value: 'LESS_THAN_OR_EQUAL' },
    { label: 'does not equal', value: 'NOT_EQUALS' },
    { label: 'exists', value: 'EXISTS' },
    { label: 'does not exist', value: 'NOT_EXISTS' },
  ],
};

export const ConditionPredicateEditor = ({
  ruleName,
  fieldOptions,
  followUpEventType,
  isLoadingFieldOptions = false,
}: ConditionPredicateEditorProps) => {
  const form = Form.useFormInstance();
  // Absolute paths — used for form.setFieldValue / form.getFieldValue / Form.useWatch.
  // These always reference the root of the form store.
  const conditionsPath = ['conditionRules', ruleName, 'conditions'] as const;
  const conditionPath = ['conditionRules', ruleName, 'conditions', 0] as const;
  // Relative paths — used only for Form.Item name, which is relative to the
  // nearest Form.List context (Form.List name="conditionRules").
  const relativeConditionPath = [ruleName, 'conditions', 0] as const;
  const conditions = Form.useWatch(conditionsPath, form) || [];
  const fieldPath = Form.useWatch([...conditionPath, 'fieldPath'], form);
  const operator = Form.useWatch([...conditionPath, 'operator'], form) || 'EQUALS';
  const enabled = Array.isArray(conditions) && conditions.length > 0;

  const selectedField = useMemo(
    () => fieldOptions.find((option) => option.value === fieldPath),
    [fieldOptions, fieldPath]
  );
  const valueType = getValueTypeForField(selectedField?.type);
  const operators = OPERATOR_OPTIONS[valueType];
  const expectsValue = operator !== 'EXISTS' && operator !== 'NOT_EXISTS';
  const canAddCondition = Boolean(followUpEventType) && fieldOptions.length > 0 && !isLoadingFieldOptions;
  const [fieldDropdownOpen, setFieldDropdownOpen] = useState(false);

  useEffect(() => {
    if (!followUpEventType || !enabled || isLoadingFieldOptions || fieldOptions.length === 0 || fieldPath) {
      setFieldDropdownOpen(false);
      return;
    }

    setFieldDropdownOpen(true);
  }, [enabled, fieldOptions.length, fieldPath, followUpEventType, isLoadingFieldOptions]);

  const enableCondition = (checked: boolean) => {
    if (!checked) {
      form.setFieldValue(conditionsPath, []);
      return;
    }

    form.setFieldValue(conditionsPath, [
      {
        fieldPath: undefined,
        operator: valueType === 'BOOLEAN' ? 'EQUALS' : 'EQUALS',
        valueType,
        value: null,
      },
    ]);
  };

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {!followUpEventType ? (
        <Text type="secondary">Choose the follow-up event first.</Text>
      ) : !enabled && isLoadingFieldOptions ? (
        <Space size={8}>
          <Spin size="small" />
          <Text type="secondary">Loading fields from the selected follow-up event…</Text>
        </Space>
      ) : !enabled && fieldOptions.length === 0 ? (
        <Text type="secondary">No comparable fields were found for the selected follow-up event.</Text>
      ) : !enabled && canAddCondition ? (
        <Button icon={<PlusOutlined />} onClick={() => enableCondition(true)}>
          Add condition
        </Button>
      ) : (
        <>
          <Space size={8} align="center">
            <Text type="secondary">Only if</Text>
            <Button
              type="link"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => form.setFieldValue(conditionsPath, [])}
            >
              Remove condition
            </Button>
          </Space>

          <Row gutter={[8, 8]}>
            <Col xs={24} lg={9}>
              <Form.Item name={[...relativeConditionPath, 'fieldPath']} style={{ marginBottom: 0 }}>
                <Select
                  open={fieldDropdownOpen}
                  showSearch
                  placeholder={followUpEventType ? `Choose field from ${followUpEventType}` : 'Field'}
                  optionFilterProp="label"
                  options={fieldOptions}
                  onOpenChange={setFieldDropdownOpen}
                  onChange={(nextFieldPath) => {
                    setFieldDropdownOpen(false);
                    const nextField = fieldOptions.find((option) => option.value === nextFieldPath);
                    const nextValueType = getValueTypeForField(nextField?.type);
                    form.setFieldValue([...conditionPath, 'valueType'], nextValueType);
                    form.setFieldValue([...conditionPath, 'operator'], OPERATOR_OPTIONS[nextValueType][0].value);
                    form.setFieldValue([...conditionPath, 'value'], null);
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} lg={7}>
              <Form.Item name={[...relativeConditionPath, 'operator']} style={{ marginBottom: 0 }}>
                <Select options={operators} placeholder="Condition" />
              </Form.Item>
            </Col>
            <Col xs={24} lg={8}>
              {expectsValue ? (
                <Form.Item name={[...relativeConditionPath, 'value']} style={{ marginBottom: 0 }}>
                  <ConditionValueInput valueType={valueType} fieldType={selectedField?.type} />
                </Form.Item>
              ) : (
                <div style={{ paddingTop: 6, minHeight: 32 }}>
                  <Text type="secondary">No value needed</Text>
                </div>
              )}
            </Col>
            <Form.Item name={[...relativeConditionPath, 'valueType']} hidden>
              <Input />
            </Form.Item>
          </Row>
        </>
      )}
    </Space>
  );
};
