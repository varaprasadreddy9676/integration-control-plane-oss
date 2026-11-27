import { useEffect, useMemo, useState } from 'react';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { Card, Form, InputNumber, Space } from '@/components/common/LegacyAntdControls';
import { RowList } from '../../../../../design-system/primitives';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';
import { ConditionRuleCard } from './ConditionRuleCard';
import { StatePanel } from '../../../../../components/common/StatePanel';
import { Button } from '../../../../../components/common/LegacyButton';

interface ConditionRulesSectionProps extends LifecyclePanelSurfaceProps {
  eventTypeOptions: Array<{ label: string; value: string }>;
  defaultMatchKeys: string[];
}

export const ConditionRulesSection = ({ eventTypeOptions, defaultMatchKeys }: ConditionRulesSectionProps) => {
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
    <Card size="small" title="Hold until this happens" className="console-card-radius">
      <Form.List name="conditionRules">
        {(fields, { add, remove }) => (
          <Space direction="vertical" size={12} className="console-width-full">
            {fields.length === 0 && (
              <StatePanel
                size="compact"
                glyph="searching"
                title="No condition rules"
                description="Add a release condition below."
              />
            )}
            <RowList label="Condition rules">
              {fields.map((field, index) => (
                <ConditionRuleCard
                  key={field.name}
                  field={field}
                  index={index}
                  eventTypeOptions={eventTypeOptions}
                  onRemove={remove}
                />
              ))}
            </RowList>
            <Space wrap size={12}>
              {fields.length === 0 && (
                <Button
                  type="dashed"
                  icon={<GatewayIcon name="PlusOutlined" />}
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
                className="ui-extracted-a5e72678a9"
              >
                {expiryActionLabel}
              </Button>
            </Space>
            {showExpiry && (
              <Form.Item
                name="conditionExpiresAfterHours"
                label="Expire if nothing happens within (hours)"
                className="ui-extracted-32ed79c63d"
              >
                <InputNumber min={0.1} step={0.5} className="console-width-full" placeholder="Optional" />
              </Form.Item>
            )}
          </Space>
        )}
      </Form.List>
    </Card>
  );
};
