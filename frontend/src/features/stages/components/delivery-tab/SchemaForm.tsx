import { Checkbox, Input, InputNumber, Select, Space } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import { Icon as GatewayIcon } from '../../../../components/common/Icon';
import type { SchemaField } from '../../../../services/stages-api';
import { MonacoEditorInput } from '../../../integrations/components/MonacoEditorInput';
import { CheckScheduleEditor } from '../../../integrations/components/detail/DeliveryFollowUpSection';
import { Button } from '../../../../components/common/LegacyButton';

const { Text } = Typography;

/**
 * A runner's settings form, generated from its configSchema with the fixed set
 * of widgets (text, select, checkbox, code, key-value, rows, tags,
 * duration-list). A new runner needs no new screen.
 */

/** "status.from" reads value.status.from. */
export const getPath = (value: Record<string, any> | undefined, path: string) =>
  path
    .split('.')
    .reduce<any>((current, key) => (current === undefined || current === null ? undefined : current[key]), value);

/** A copy of `value` with `path` set; nested objects are created as needed. */
export const setPath = (value: Record<string, any> | undefined, path: string, next: unknown): Record<string, any> => {
  const [head, ...rest] = path.split('.');
  const base = { ...(value || {}) };
  if (rest.length === 0) {
    if (next === undefined) delete base[head];
    else base[head] = next;
    return base;
  }
  base[head] = setPath(base[head], rest.join('.'), next);
  return base;
};

interface WidgetProps {
  field: SchemaField;
  value: any;
  onChange: (value: any) => void;
  label: string;
  disabled?: boolean;
}

/** Rows of name -> value; an object to the runner. */
export const KeyValueEditor = ({ value, onChange, label, disabled }: Omit<WidgetProps, 'field'>) => {
  const entries: Array<[string, string]> = Object.entries(value || {});
  const write = (next: Array<[string, string]>) => onChange(next.length ? Object.fromEntries(next) : undefined);
  return (
    <Space direction="vertical" size={6} className="console-width-full">
      {entries.map(([key, val], index) => (
        <Space key={index} className="console-width-full" align="start">
          <Input
            aria-label={`${label} name ${index + 1}`}
            value={key}
            placeholder="Name"
            disabled={disabled}
            className="ui-extracted-3bb9bbf2f0"
            onChange={(e) => write(entries.map((entry, i) => (i === index ? [e.target.value, entry[1]] : entry)))}
          />
          <Input
            aria-label={`${label} value ${index + 1}`}
            value={val}
            placeholder="Value, may use {{ }}"
            disabled={disabled}
            className="ui-extracted-9852709426"
            onChange={(e) => write(entries.map((entry, i) => (i === index ? [entry[0], e.target.value] : entry)))}
          />
          <Button
            type="text"
            danger
            icon={<GatewayIcon name="DeleteOutlined" />}
            aria-label={`Remove ${label} ${index + 1}`}
            disabled={disabled}
            onClick={() => write(entries.filter((_, i) => i !== index))}
          />
        </Space>
      ))}
      <Button
        icon={<GatewayIcon name="PlusOutlined" />}
        size="small"
        disabled={disabled}
        aria-label={`Add ${label}`}
        onClick={() => write([...entries, ['', '']])}
      >
        Add
      </Button>
    </Space>
  );
};

const RowsEditor = ({ field, value, onChange, label, disabled }: WidgetProps) => {
  const rows: Array<Record<string, any>> = Array.isArray(value) ? value : [];
  const columns = field.columns || [];
  const write = (next: Array<Record<string, any>>) => onChange(next.length ? next : undefined);
  return (
    <Space direction="vertical" size={6} className="console-width-full">
      {rows.map((row, index) => (
        <Space key={index} wrap align="center">
          {columns.map((column) => (
            <Widget
              key={column.name}
              field={column}
              label={`${label} ${index + 1} ${column.label}`}
              value={row[column.name]}
              disabled={disabled}
              onChange={(next) =>
                write(rows.map((current, i) => (i === index ? setPath(current, column.name, next) : current)))
              }
            />
          ))}
          <Button
            type="text"
            danger
            icon={<GatewayIcon name="DeleteOutlined" />}
            aria-label={`Remove ${label} ${index + 1}`}
            disabled={disabled}
            onClick={() => write(rows.filter((_, i) => i !== index))}
          />
        </Space>
      ))}
      <Button
        icon={<GatewayIcon name="PlusOutlined" />}
        size="small"
        disabled={disabled}
        onClick={() =>
          write([
            ...rows,
            Object.fromEntries(columns.filter((c) => c.default !== undefined).map((c) => [c.name, c.default])),
          ])
        }
      >
        Add a row
      </Button>
    </Space>
  );
};

/** JSON when it parses, text otherwise (a body may be a template string). */
const CodeText = ({ value, onChange, label, disabled, field }: WidgetProps) => {
  if (field.language === 'javascript') {
    return (
      <MonacoEditorInput
        value={value || ''}
        onChange={(next) => onChange(next)}
        height="280px"
        readOnly={disabled || field.readOnly}
      />
    );
  }
  const text =
    value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <Input.TextArea
      aria-label={label}
      value={text}
      disabled={disabled}
      readOnly={field.readOnly}
      autoSize={{ minRows: 4, maxRows: 16 }}
      className="ui-extracted-a32b7ba7ed"
      onChange={(e) => {
        const next = e.target.value;
        if (next.trim() === '') return onChange(undefined);
        try {
          return onChange(JSON.parse(next));
        } catch {
          return onChange(next);
        }
      }}
    />
  );
};

export const Widget = ({ field, value, onChange, label, disabled }: WidgetProps) => {
  switch (field.widget) {
    case 'select':
      return (
        <Select
          aria-label={label}
          value={value ?? field.default}
          disabled={disabled}
          className="ui-extracted-3292a37181"
          options={(field.options || []).map((option) => ({ value: option, label: option }))}
          onChange={onChange}
        />
      );
    case 'checkbox':
      return (
        <Checkbox
          aria-label={label}
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked || undefined)}
        >
          {field.label}
        </Checkbox>
      );
    case 'code':
      return <CodeText field={field} value={value} onChange={onChange} label={label} disabled={disabled} />;
    case 'key-value':
      return <KeyValueEditor value={value} onChange={onChange} label={label} disabled={disabled} />;
    case 'rows':
      return <RowsEditor field={field} value={value} onChange={onChange} label={label} disabled={disabled} />;
    case 'tags':
      return (
        <Select
          aria-label={label}
          mode="tags"
          value={Array.isArray(value) ? value.map(String) : []}
          disabled={disabled}
          className="ui-extracted-a399b9f5e4"
          tokenSeparators={[',']}
          onChange={(next: string[]) => {
            const list = field.valueType === 'number' ? next.map(Number).filter((n) => Number.isFinite(n)) : next;
            onChange(list.length ? list : undefined);
          }}
        />
      );
    case 'duration-list':
      return <CheckScheduleEditor value={value} onChange={onChange} />;
    default: // text
      return field.valueType === 'number' ? (
        <InputNumber
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(next) => onChange(next ?? undefined)}
        />
      ) : (
        <Input
          aria-label={label}
          value={value ?? ''}
          placeholder={field.placeholder}
          disabled={disabled}
          readOnly={field.readOnly}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      );
  }
};

interface SchemaFormProps {
  fields: SchemaField[];
  value?: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

export const SchemaForm = ({ fields, value, onChange, errors = {}, disabled }: SchemaFormProps) => (
  <Space direction="vertical" size={14} className="console-width-full">
    {fields.map((field) => {
      const id = `stage-field-${field.name}`;
      const error = errors[field.name];
      return (
        <div key={field.name}>
          {field.widget !== 'checkbox' && (
            <label htmlFor={id} className="ui-extracted-30b80cec02">
              <Text strong>
                {field.label}
                {field.required ? ' *' : ''}
              </Text>
            </label>
          )}
          <div id={id}>
            <Widget
              field={field}
              label={field.label}
              value={getPath(value, field.name)}
              disabled={disabled}
              onChange={(next) => onChange(setPath(value, field.name, next))}
            />
          </div>
          {field.hint && !error && (
            <Text type="secondary" className="console-type-caption">
              {field.hint}
            </Text>
          )}
          {error && (
            <Text type="danger" role="alert" className="console-caption-block">
              {error}
            </Text>
          )}
        </div>
      );
    })}
  </Space>
);
