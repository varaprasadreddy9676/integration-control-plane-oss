import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Skeleton, Space, Typography } from 'antd';
import { ConditionRulesSection } from './ConditionRulesSection';
import { LifecycleRulesSection } from './LifecycleRulesSection';
import { LifecycleSubjectSection } from './LifecycleSubjectSection';
import type { LifecyclePanelContentProps } from './LifecyclePanel.types';

const { Text } = Typography;

export const LifecyclePanelContent = ({
  form,
  eventTypes,
  hasPersistedConfig = false,
  deliveryModeValue,
  spacing,
  token,
  colors,
  isLoading = false,
  isReadOnly = false,
}: LifecyclePanelContentProps) => {
  const lifecycleRules = Form.useWatch('lifecycleRules') || [];
  const conditionRules = Form.useWatch('conditionRules') || [];
  const extractionScript = Form.useWatch('subjectExtractionScript') || '';
  const isConditionMode = deliveryModeValue === 'WAIT_FOR_CONDITION' || deliveryModeValue === 'WAIT_FOR_EVENT';

  const [showInactiveImmediateConfig, setShowInactiveImmediateConfig] = useState(false);
  const [showMatchingDetails, setShowMatchingDetails] = useState(false);

  const ruleCount =
    (Array.isArray(lifecycleRules) ? lifecycleRules.length : 0) +
    (Array.isArray(conditionRules) ? conditionRules.length : 0);

  const hasSavedConfig = hasPersistedConfig || ruleCount > 0 || Boolean(extractionScript);

  const eventTypeOptions = useMemo(
    () =>
      (eventTypes || []).map((eventType) => ({
        label: eventType.eventType,
        value: eventType.eventType,
      })),
    [eventTypes]
  );

  // All unique matchKeys configured across lifecycle rules
  const allMatchKeys = useMemo(() => {
    const keys = new Set<string>();
    (Array.isArray(lifecycleRules) ? lifecycleRules : []).forEach((rule: any) => {
      (Array.isArray(rule?.matchKeys) ? rule.matchKeys : []).filter(Boolean).forEach((k: string) => keys.add(k));
    });
    return Array.from(keys);
  }, [lifecycleRules]);

  // Show compact summary when rules have matchKeys and user hasn't expanded the detail view (not in IMMEDIATE mode)
  const showCompactMatchingSummary =
    deliveryModeValue !== 'IMMEDIATE' && !showMatchingDetails && allMatchKeys.length > 0;

  useEffect(() => {
    // Reset "show advanced" state when switching away from IMMEDIATE or when config disappears
    if (deliveryModeValue !== 'IMMEDIATE' || !hasSavedConfig) {
      setShowInactiveImmediateConfig(false);
    }
  }, [deliveryModeValue, hasSavedConfig]);

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  if (deliveryModeValue === 'IMMEDIATE' && !hasSavedConfig) {
    return null;
  }

  return (
    <Space direction="vertical" size={Number.parseInt(spacing[4], 10) || 16} style={{ width: '100%' }}>
      {deliveryModeValue === 'IMMEDIATE' && hasSavedConfig && (
        <>
          <Alert
            type="info"
            showIcon
            message="These matching and follow-up settings are saved but inactive for immediate delivery."
            description="Switch to Send later, Recurring, or Hold until a follow-up event if you want these settings to take effect."
          />
          {!showInactiveImmediateConfig && (
            <Button onClick={() => setShowInactiveImmediateConfig(true)}>Show advanced matching</Button>
          )}
        </>
      )}

      {(deliveryModeValue !== 'IMMEDIATE' || showInactiveImmediateConfig) &&
        (isConditionMode ? (
          <ConditionRulesSection
            eventTypeOptions={eventTypeOptions}
            defaultMatchKeys={[]}
            token={token}
            colors={colors}
          />
        ) : (
          <>
            {showCompactMatchingSummary ? (
              <Space>
                <Text>Using {allMatchKeys.join(', ')} to match the same record.</Text>
                <Button size="small" onClick={() => setShowMatchingDetails(true)}>
                  Change matching fields
                </Button>
              </Space>
            ) : (
              <LifecycleSubjectSection
                token={token}
                colors={colors}
                isReadOnly={isReadOnly}
                onSwitchToDefault={() => setShowMatchingDetails(false)}
              />
            )}
            <LifecycleRulesSection
              eventTypeOptions={eventTypeOptions}
              defaultMatchKeys={[]}
              token={token}
              colors={colors}
            />
          </>
        ))}
    </Space>
  );
};
