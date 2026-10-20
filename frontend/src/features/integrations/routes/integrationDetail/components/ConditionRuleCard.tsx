import { DeleteOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Row, Select, Tooltip } from 'antd';
import { useEffect, useMemo } from 'react';
import { flattenFields } from '../utils/fieldMapping';
import { getPrimaryEventType } from '../utils/followUpRule';
import { inferFollowUpFieldSemantic } from '../utils/followUpFieldSemantics';
import { useEventTypeData } from '../hooks/useEventTypeData';
import type { LifecyclePanelSurfaceProps } from './LifecyclePanel.types';
import { ConditionPredicateEditor } from './ConditionPredicateEditor';
import { ConditionReleaseTimingFields } from './ConditionReleaseTimingFields';
import { SingleEventTypeSelectField } from './SingleEventTypeSelectField';

const ACTION_OPTIONS = [
  { label: 'Release it now', value: 'RELEASE_HELD' },
  { label: 'Discard it', value: 'DISCARD_HELD' },
];

interface ConditionRuleCardProps extends LifecyclePanelSurfaceProps {
  field: { key: React.Key; name: number };
  eventTypeOptions: Array<{ label: string; value: string }>;
  onRemove: (index: number) => void;
}

export const ConditionRuleCard = ({ field, eventTypeOptions, onRemove, token, colors }: ConditionRuleCardProps) => {
  const form = Form.useFormInstance();

  // Form.useWatch can return undefined transiently during store updates.
  // Fall back to a synchronous form.getFieldValue read so the derived value
  // is never incorrect due to transient watcher state.
  const eventTypesWatch = Form.useWatch(['conditionRules', field.name, 'eventTypes'], form);
  const selectedFollowUpEventType =
    eventTypesWatch !== undefined
      ? getPrimaryEventType(eventTypesWatch)
      : getPrimaryEventType(form.getFieldValue(['conditionRules', field.name, 'eventTypes']));

  const action = Form.useWatch(['conditionRules', field.name, 'action'], form) || 'RELEASE_HELD';
  const releaseTimingMode = Form.useWatch(['conditionRules', field.name, 'releaseTiming', 'mode'], form) || 'IMMEDIATE';
  const selectedReleaseField = Form.useWatch(['conditionRules', field.name, 'releaseTiming', 'eventFieldPath'], form);
  const { data: selectedFollowUpEventTypeData, isLoading } = useEventTypeData(selectedFollowUpEventType);

  const conditionFieldOptions = useMemo(
    () =>
      (selectedFollowUpEventTypeData?.fields ? flattenFields(selectedFollowUpEventTypeData.fields as any[]) : [])
        .filter((option: any) => !option.isComplex && option.path)
        .map((option: any) => {
          const semantic = inferFollowUpFieldSemantic(option);
          return {
            label: `${option.path}${semantic.displayType ? ` (${semantic.displayType})` : ''}`,
            value: option.path,
            type: semantic.kind,
            valueType: semantic.valueType,
            priority: semantic.priority,
            supportsOffsetTiming: semantic.supportsOffsetTiming,
          };
        })
        .sort((left, right) => {
          if (right.priority !== left.priority) {
            return right.priority - left.priority;
          }
          return left.label.localeCompare(right.label);
        }),
    [selectedFollowUpEventTypeData]
  );
  const dateFieldOptions = useMemo(
    () => conditionFieldOptions.filter((option) => option.supportsOffsetTiming),
    [conditionFieldOptions]
  );

  // Initialise defaults on mount only.
  useEffect(() => {
    if (!form.getFieldValue(['conditionRules', field.name, 'action'])) {
      form.setFieldValue(['conditionRules', field.name, 'action'], 'RELEASE_HELD');
    }
    if (!form.getFieldValue(['conditionRules', field.name, 'releaseTiming'])) {
      form.setFieldValue(['conditionRules', field.name, 'releaseTiming'], {
        mode: 'IMMEDIATE',
        eventFieldPath: '',
        offsetValue: 0,
        offsetUnit: 'HOURS',
      });
    }
  }, [field.name, form]);

  // Keep conditions in sync with the selected follow-up event.
  // Guard against eventTypesWatch being transiently undefined — in that case
  // selectedFollowUpEventType was derived from the synchronous store read and
  // is reliable, but we must not act on a transient watcher state.
  useEffect(() => {
    if (eventTypesWatch === undefined) {
      return;
    }

    if (!selectedFollowUpEventType) {
      const currentConditions = form.getFieldValue(['conditionRules', field.name, 'conditions']);
      if (Array.isArray(currentConditions) && currentConditions.length > 0) {
        form.setFieldValue(['conditionRules', field.name, 'conditions'], []);
      }
      return;
    }

    const currentConditions = form.getFieldValue(['conditionRules', field.name, 'conditions']);
    if (!Array.isArray(currentConditions) || currentConditions.length === 0) {
      form.setFieldValue(
        ['conditionRules', field.name, 'conditions'],
        [{ fieldPath: undefined, operator: 'EQUALS', valueType: 'STRING', value: null }]
      );
    }

    if (!form.getFieldValue(['conditionRules', field.name, 'releaseTiming'])) {
      form.setFieldValue(['conditionRules', field.name, 'releaseTiming'], {
        mode: 'IMMEDIATE',
        eventFieldPath: '',
        offsetValue: 0,
        offsetUnit: 'HOURS',
      });
    }
  }, [field.name, form, selectedFollowUpEventType, eventTypesWatch]);

  // Auto-select first date field when switching to OFFSET_FROM_EVENT_FIELD timing.
  useEffect(() => {
    if (releaseTimingMode !== 'OFFSET_FROM_EVENT_FIELD' || dateFieldOptions.length === 0 || selectedReleaseField) {
      return;
    }
    form.setFieldValue(['conditionRules', field.name, 'releaseTiming', 'eventFieldPath'], dateFieldOptions[0].value);
  }, [dateFieldOptions, field.name, form, releaseTimingMode, selectedReleaseField]);

  return (
    <Card size="small" style={{ borderRadius: token.borderRadiusLG, borderColor: colors.neutral[200] }}>
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <SingleEventTypeSelectField
            formItemName={[field.name, 'eventTypes']}
            storePath={['conditionRules', field.name, 'eventTypes']}
            label="Follow-up event"
            placeholder="Choose follow-up event"
            options={eventTypeOptions}
            requiredMessage="Select a follow-up event"
            onSelect={(eventType, prevEventType) => {
              // prevEventType is passed from SingleEventTypeSelectField's render
              // closure — safe to use even if Form.Item updated the store first.
              const didChange = eventType !== prevEventType;

              form.setFieldValue(['conditionRules', field.name, 'eventTypes'], eventType ? [eventType] : []);

              if (didChange) {
                form.setFieldValue(
                  ['conditionRules', field.name, 'conditions'],
                  eventType ? [{ fieldPath: undefined, operator: 'EQUALS', valueType: 'STRING', value: null }] : []
                );
                form.setFieldValue(['conditionRules', field.name, 'releaseTiming', 'eventFieldPath'], '');

                if (!eventType) {
                  form.setFieldValue(['conditionRules', field.name, 'releaseTiming'], {
                    mode: 'IMMEDIATE',
                    eventFieldPath: '',
                    offsetValue: 0,
                    offsetUnit: 'HOURS',
                  });
                }
              }
            }}
          />
        </Col>
        <Col xs={24} lg={10}>
          <Form.Item
            name={[field.name, 'action']}
            label="Then"
            rules={[{ required: true, message: 'Action is required' }]}
            style={{ marginBottom: 0 }}
          >
            <Select options={ACTION_OPTIONS} />
          </Form.Item>
        </Col>
        <Col xs={24} lg={2}>
          <Tooltip title="Remove">
            <Button
              danger
              title="Remove"
              aria-label="Remove condition rule"
              icon={<DeleteOutlined />}
              onClick={() => onRemove(field.name)}
            />
          </Tooltip>
        </Col>

        {action === 'RELEASE_HELD' && selectedFollowUpEventType && (
          <Col xs={24}>
            <ConditionReleaseTimingFields ruleName={field.name} dateFieldOptions={dateFieldOptions} />
          </Col>
        )}

        <Col xs={24}>
          <ConditionPredicateEditor
            ruleName={field.name}
            followUpEventType={selectedFollowUpEventType}
            fieldOptions={conditionFieldOptions}
            isLoadingFieldOptions={isLoading}
          />
        </Col>
      </Row>
    </Card>
  );
};
