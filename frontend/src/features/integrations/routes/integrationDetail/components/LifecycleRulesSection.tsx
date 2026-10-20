import { PlusOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { Button, Card, Empty, Form, Space } from 'antd';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';
import { LifecycleRuleCard } from './LifecycleRuleCard';

interface LifecycleRulesSectionProps extends LifecyclePanelSurfaceProps {
  eventTypeOptions: Array<{ label: string; value: string }>;
  defaultMatchKeys: string[];
}

export const LifecycleRulesSection = ({
  eventTypeOptions,
  defaultMatchKeys,
  token,
  colors,
}: LifecycleRulesSectionProps) => {
  const form = Form.useFormInstance();
  const lifecycleRules = Form.useWatch('lifecycleRules') || [];

  useEffect(() => {
    if (defaultMatchKeys.length === 0 || !Array.isArray(lifecycleRules) || lifecycleRules.length === 0) {
      return;
    }

    let changed = false;
    const nextRules = lifecycleRules.map((rule: any) => {
      if (Array.isArray(rule?.matchKeys) && rule.matchKeys.length > 0) {
        return rule;
      }
      changed = true;
      return {
        ...rule,
        matchKeys: defaultMatchKeys,
      };
    });

    if (changed) {
      form.setFieldValue('lifecycleRules', nextRules);
    }
  }, [defaultMatchKeys, form, lifecycleRules]);

  return (
    <Card
      size="small"
      title="Does this event later get cancelled or rescheduled?"
      style={{ borderRadius: token.borderRadiusLG }}
    >
      <Form.List name="lifecycleRules">
        {(fields, { add, remove }) => (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {fields.length === 0 && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Add a follow-up event if it should cancel, reschedule, replace, or ignore pending deliveries."
              />
            )}
            {fields.map((field) => {
              return (
                <LifecycleRuleCard
                  key={field.key}
                  field={field}
                  eventTypeOptions={eventTypeOptions}
                  onRemove={remove}
                  token={token}
                  colors={colors}
                />
              );
            })}
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() =>
                add({
                  eventTypes: [],
                  action: 'CANCEL_PENDING',
                  matchKeys: defaultMatchKeys,
                  ruleMode: 'SIMPLE',
                  script: '',
                })
              }
            >
              {fields.length === 0 ? 'Add follow-up event' : 'Add another follow-up event'}
            </Button>
          </Space>
        )}
      </Form.List>
    </Card>
  );
};
