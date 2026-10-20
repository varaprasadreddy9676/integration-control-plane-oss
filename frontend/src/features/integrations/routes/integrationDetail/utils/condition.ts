import type { ConditionConfig, ConditionReleaseTiming, ConditionRule, ReleaseOffsetUnit, ReleaseTimingMode } from '../../../../../mocks/types';
import type { ConditionPredicate, ConditionPredicateOperator, ConditionPredicateValueType } from '../../../../../mocks/types';
import { normalizeConditionRulesForForm } from './followUpRules';

export interface ConditionPredicateFormValue {
  fieldPath?: string;
  operator?: ConditionPredicateOperator;
  valueType?: ConditionPredicateValueType;
  value?: string | number | boolean | null;
}

export interface ConditionRuleFormValue {
  eventTypes?: string[];
  action?: 'RELEASE_HELD' | 'DISCARD_HELD';
  matchKeys?: string[];
  conditions?: ConditionPredicateFormValue[];
  releaseTiming?: {
    mode?: ReleaseTimingMode;
    eventFieldPath?: string;
    offsetValue?: number | null;
    offsetUnit?: ReleaseOffsetUnit;
  };
}

const normalizeReleaseTiming = (
  action: ConditionRuleFormValue['action'],
  releaseTiming?: ConditionRuleFormValue['releaseTiming']
): ConditionReleaseTiming => ({
  mode: action === 'RELEASE_HELD' && releaseTiming?.mode === 'OFFSET_FROM_EVENT_FIELD' ? 'OFFSET_FROM_EVENT_FIELD' : 'IMMEDIATE',
  eventFieldPath: typeof releaseTiming?.eventFieldPath === 'string' ? releaseTiming.eventFieldPath.trim() : '',
  offsetValue: typeof releaseTiming?.offsetValue === 'number' ? releaseTiming.offsetValue : 0,
  offsetUnit: releaseTiming?.offsetUnit || 'HOURS',
});

const normalizeConditions = (conditions?: ConditionPredicateFormValue[]): ConditionPredicate[] =>
  Array.isArray(conditions)
    ? conditions
        .map((condition) => ({
          fieldPath: typeof condition?.fieldPath === 'string' ? condition.fieldPath.trim() : '',
          operator: condition?.operator || 'EQUALS',
          valueType: condition?.valueType || 'STRING',
          value: condition?.value ?? null,
        }))
        .filter((condition) => condition.fieldPath)
    : [];

export const buildConditionConfigFromForm = (values: {
  conditionPayloadStrategy?: 'ORIGINAL_EVENT';
  conditionExpiresAfterHours?: number | null;
  conditionRules?: ConditionRuleFormValue[];
}): ConditionConfig | null => {
  const rules: ConditionRule[] = Array.isArray(values.conditionRules)
    ? values.conditionRules.flatMap((rule) => {
        if (rule?.action !== 'RELEASE_HELD' && rule?.action !== 'DISCARD_HELD') {
          return [];
        }

        return [{
          eventTypes: Array.isArray(rule?.eventTypes) ? rule.eventTypes.filter(Boolean) : [],
          action: rule.action,
          matchKeys: Array.isArray(rule?.matchKeys) ? rule.matchKeys.filter(Boolean) : [],
          ruleMode: 'SIMPLE',
          script: '',
          conditions: normalizeConditions(rule?.conditions),
          releaseTiming: normalizeReleaseTiming(rule.action, rule.releaseTiming),
        }];
      })
    : [];

  const releaseRules = rules.filter((rule) => rule.action === 'RELEASE_HELD');
  const discardRules = rules.filter((rule) => rule.action === 'DISCARD_HELD');
  const expiresAfterHours = values.conditionExpiresAfterHours;
  const expiresAfterMs =
    typeof expiresAfterHours === 'number' && Number.isFinite(expiresAfterHours) && expiresAfterHours > 0
      ? Math.round(expiresAfterHours * 60 * 60 * 1000)
      : null;

  if (releaseRules.length === 0 && discardRules.length === 0 && expiresAfterMs === null) {
    return null;
  }

  return {
    payloadStrategy: values.conditionPayloadStrategy || 'ORIGINAL_EVENT',
    expiresAfterMs,
    releaseRules,
    discardRules,
  };
};

export const conditionConfigToFormFields = (conditionConfig?: ConditionConfig | null) => {
  const rules = normalizeConditionRulesForForm([
    ...((conditionConfig?.releaseRules || []).map((rule) => ({
      ...rule,
      action: 'RELEASE_HELD' as const,
      conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
      releaseTiming: rule.releaseTiming || {
        mode: 'IMMEDIATE' as const,
        offsetValue: 0,
        offsetUnit: 'HOURS' as const,
        eventFieldPath: '',
      },
    }))),
    ...((conditionConfig?.discardRules || []).map((rule) => ({
      ...rule,
      action: 'DISCARD_HELD' as const,
      conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
      releaseTiming: {
        mode: 'IMMEDIATE' as const,
        offsetValue: 0,
        offsetUnit: 'HOURS' as const,
        eventFieldPath: '',
      },
    }))),
  ]);

  return {
    conditionPayloadStrategy: conditionConfig?.payloadStrategy || 'ORIGINAL_EVENT',
    conditionExpiresAfterHours:
      typeof conditionConfig?.expiresAfterMs === 'number' && conditionConfig.expiresAfterMs > 0
        ? Number((conditionConfig.expiresAfterMs / (60 * 60 * 1000)).toFixed(2))
        : null,
    conditionRules: rules,
  };
};
