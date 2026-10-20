import { useEffect, useMemo, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Form, InputNumber, Space } from 'antd';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';
import { ConditionRuleCard } from './ConditionRuleCard';

interface ConditionRulesSectionProps extends LifecyclePanelSurfaceProps {
  eventTypeOptions: Array<{ label: string; value: string }>;
  defaultMatchKeys: string[];
}

export const ConditionRulesSection = ({
  eventTypeOptions,
  defaultMatchKeys,
  token,
  colors,
}: ConditionRulesSectionProps) => {
  const form = Form.useFormInstance();
  const expiresAfterHours = Form.useWatch('conditionExpiresAfterHours');
  const [showExpiry, setShowExpiry] = useState(Boolean(expiresAfterHours));

  useEffect(() => {
    setShowExpiry(typeof expiresAfterHours === 'number' && expiresAfterHours > 0);
  }, [expiresAfterHours]);

  useEffect(() => {
    if (defaultMatchKeys.length === 0) return;
    const currentRules = form.getFieldValue('conditionRules');
    if (!Array.isArray(currentRules) || currentRules.length === 0) return;

    // Patch only the individual rules that are missing matchKeys — never rewrite the whole array.
    currentRules.forEach((rule: any, index: number) => {
      if (!Array.isArray(rule?.matchKeys) || rule.matchKeys.length === 0) {
        form.setFieldValue(['conditionRules', index, 'matchKeys'], defaultMatchKeys);
      }
    });
  }, [defaultMatchKeys, form]);

  const expiryActionLabel = useMemo(() => (showExpiry ? 'Remove expiry' : 'Set expiry'), [showExpiry]);

  return (
    <Card size="small" title="Hold until this happens" style={{ borderRadius: token.borderRadiusLG }}>
      <Form.List name="conditionRules">
        {(fields, { add, remove }) => (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {fields.length === 0 && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Add the follow-up event that should release or discard this held delivery."
              />
            )}
            {fields.map((field) => {
              return (
                <ConditionRuleCard
                  key={field.name}
                  field={field}
                  eventTypeOptions={eventTypeOptions}
                  onRemove={remove}
                  token={token}
                  colors={colors}
                />
              );
            })}
            <Space wrap size={12}>
              {fields.length === 0 && (
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({
                      eventTypes: [],
                      action: 'RELEASE_HELD',
                      matchKeys: defaultMatchKeys,
                      ruleMode: 'SIMPLE',
                      script: '',
                      conditions: [],
                      releaseTiming: {
                        mode: 'IMMEDIATE',
                        eventFieldPath: '',
                        offsetValue: 0,
                        offsetUnit: 'HOURS',
                      },
                    })
                  }
                >
                  Add follow-up event
                </Button>
              )}
              <Button
                type="link"
                onClick={() => {
                  if (showExpiry) {
                    form.setFieldValue('conditionExpiresAfterHours', undefined);
                    setShowExpiry(false);
                    return;
                  }
                  setShowExpiry(true);
                }}
                style={{ paddingInline: 0 }}
              >
                {expiryActionLabel}
              </Button>
            </Space>
            {showExpiry && (
              <Form.Item
                name="conditionExpiresAfterHours"
                label="Expire if nothing happens within (hours)"
                style={{ marginBottom: 0, maxWidth: 320 }}
              >
                <InputNumber min={0.1} step={0.5} style={{ width: '100%' }} placeholder="Optional" />
              </Form.Item>
            )}
          </Space>
        )}
      </Form.List>
    </Card>
  );
};
