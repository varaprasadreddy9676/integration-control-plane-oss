import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { useEffect } from 'react';
import { Card, Form, Space } from '@/components/common/LegacyAntdControls';
import { RowList } from '../../../../../design-system/primitives';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';
import { LifecycleRuleCard } from './LifecycleRuleCard';
import { StatePanel } from '../../../../../components/common/StatePanel';
import { Button } from '../../../../../components/common/LegacyButton';

interface LifecycleRulesSectionProps extends LifecyclePanelSurfaceProps {
  eventTypeOptions: Array<{ label: string; value: string }>;
  defaultMatchKeys: string[];
}

export const LifecycleRulesSection = ({ eventTypeOptions, defaultMatchKeys }: LifecycleRulesSectionProps) => {
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
    <Card size="small" title="Does this event later get cancelled or rescheduled?" className="console-card-radius">
      <Form.List name="lifecycleRules">
        {(fields, { add, remove }) => (
          <Space direction="vertical" size={12} className="console-width-full">
            {fields.length === 0 && (
              <StatePanel
                size="compact"
                glyph="searching"
                title="No lifecycle rules"
                description="Add a rule to manage held deliveries."
              />
            )}
            <RowList label="Lifecycle rules">
              {fields.map((field, index) => (
                <LifecycleRuleCard
                  key={field.key}
                  field={field}
                  index={index}
                  eventTypeOptions={eventTypeOptions}
                  onRemove={remove}
                />
              ))}
            </RowList>
            <Button
              type="dashed"
              icon={<GatewayIcon name="PlusOutlined" />}
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
