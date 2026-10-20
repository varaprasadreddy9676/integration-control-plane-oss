import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Select, Space, Tag, Typography } from 'antd';

const { Text } = Typography;

interface RuleMatchKeysFieldProps {
  namePath: (string | number)[];
  label: string;
  requiredMessage: string;
  extractionMode: 'PATHS' | 'SCRIPT';
  matchKeyOptions: Array<{ label: string; value: string }>;
  defaultMatchKeys: string[];
  emptyStateText: string;
  helperText: string;
}

const sameKeySet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
};

export const RuleMatchKeysField = ({
  namePath,
  label,
  requiredMessage,
  extractionMode,
  matchKeyOptions,
  defaultMatchKeys,
  emptyStateText,
  helperText,
}: RuleMatchKeysFieldProps) => {
  const form = Form.useFormInstance();
  const currentValue = Form.useWatch(namePath, form) || [];
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const currentKeys = useMemo(
    () => (Array.isArray(currentValue) ? currentValue.filter(Boolean) : []),
    [currentValue]
  );
  const canUseSummary = matchKeyOptions.length > 0 && currentKeys.length > 0;
  const isUsingDefaultKeys = defaultMatchKeys.length > 0 && sameKeySet(currentKeys, defaultMatchKeys);
  const hasAnyMatchKeys = currentKeys.length > 0 || matchKeyOptions.length > 0;

  useEffect(() => {
    if (!canUseSummary) {
      setCustomizeOpen(true);
      return;
    }

    if (!isUsingDefaultKeys) {
      setCustomizeOpen(true);
    }
  }, [canUseSummary, isUsingDefaultKeys]);

  if (canUseSummary && !customizeOpen) {
    return (
      <Form.Item label={label} required style={{ marginBottom: 0 }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Space wrap>
            {currentKeys.map((key) => (
              <Tag key={key} color="blue">
                {key}
              </Tag>
            ))}
          </Space>
          <Space wrap size={8}>
            <Text type="secondary">{helperText}</Text>
            <Button type="link" size="small" onClick={() => setCustomizeOpen(true)} style={{ padding: 0, height: 'auto' }}>
              Customize
            </Button>
          </Space>
        </Space>
      </Form.Item>
    );
  }

  if (!hasAnyMatchKeys) {
    return (
      <Form.Item label={label} required style={{ marginBottom: 0 }}>
        <Text type="secondary">{emptyStateText}</Text>
      </Form.Item>
    );
  }

  return (
    <Form.Item
      name={namePath}
      label={label}
      rules={[{ required: true, message: requiredMessage }]}
      extra={matchKeyOptions.length === 0 ? emptyStateText : helperText}
      style={{ marginBottom: 0 }}
    >
      <Select
        style={{ width: '100%' }}
        mode={extractionMode === 'SCRIPT' ? 'tags' : 'multiple'}
        options={matchKeyOptions}
        placeholder={extractionMode === 'SCRIPT' ? 'Type or pick fields' : 'Pick fields'}
        allowClear
        notFoundContent={emptyStateText}
        popupRender={(menu) => (
          <div>
            {menu}
            {defaultMatchKeys.length > 0 && (
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--ig-border, #f0f0f0)' }}>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    form.setFieldValue(namePath, defaultMatchKeys);
                    setCustomizeOpen(false);
                  }}
                  style={{ padding: 0, height: 'auto' }}
                >
                  Use suggested matching fields
                </Button>
              </div>
            )}
          </div>
        )}
      />
    </Form.Item>
  );
};
