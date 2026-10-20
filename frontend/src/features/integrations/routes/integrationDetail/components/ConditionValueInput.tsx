import { DatePicker, Input, Select } from 'antd';
import dayjs from 'dayjs';
import type { ConditionPredicateValueType } from '../../../../../mocks/types';

interface ConditionValueInputProps {
  value?: string | number | boolean | null;
  onChange?: (value: string | number | boolean | null) => void;
  valueType: ConditionPredicateValueType;
  fieldType?: string;
}

const usesDateTime = (fieldType?: string) => {
  const normalized = String(fieldType || '').toLowerCase();
  return normalized === 'datetime' || normalized === 'timestamp';
};

export const ConditionValueInput = ({ value, onChange, valueType, fieldType }: ConditionValueInputProps) => {
  if (valueType === 'NUMBER') {
    // Use a plain text input so the user can type any decimal value without
    // Ant Design InputNumber's default integer-only precision restriction.
    // Parse to a number on each change; null when the field is empty or invalid.
    return (
      <Input
        placeholder="Value"
        value={value == null ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange?.(null);
            return;
          }
          const parsed = parseFloat(raw);
          onChange?.(isNaN(parsed) ? null : parsed);
        }}
      />
    );
  }

  if (valueType === 'BOOLEAN') {
    return (
      <Select
        options={[
          { label: 'true', value: true },
          { label: 'false', value: false },
        ]}
        placeholder="Value"
        value={typeof value === 'boolean' ? value : undefined}
        onChange={(nextValue) => onChange?.(typeof nextValue === 'boolean' ? nextValue : null)}
      />
    );
  }

  if (valueType === 'DATE') {
    const showTime = usesDateTime(fieldType);
    const parsedValue = typeof value === 'string' && value ? dayjs(value) : null;

    return (
      <DatePicker
        style={{ width: '100%' }}
        showTime={showTime}
        format={showTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'}
        placeholder={showTime ? 'Select date and time' : 'Select date'}
        value={parsedValue?.isValid() ? parsedValue : null}
        onChange={(nextValue) =>
          onChange?.(nextValue ? (showTime ? nextValue.toISOString() : nextValue.format('YYYY-MM-DD')) : null)
        }
      />
    );
  }

  return (
    <Input
      placeholder="Value"
      value={value == null ? '' : String(value)}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
};
