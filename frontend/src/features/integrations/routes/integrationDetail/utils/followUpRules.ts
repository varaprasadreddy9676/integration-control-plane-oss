import type { ConditionRule, LifecycleRule } from '../../../../../mocks/types';

export const normalizeLifecycleRulesForForm = (rules?: LifecycleRule[] | null) =>
  Array.isArray(rules)
    ? rules.map((rule) => ({
        ...rule,
        ruleMode: 'SIMPLE' as const,
        script: '',
      }))
    : [];

export const normalizeLifecycleRulesForSave = (rules?: LifecycleRule[] | null): LifecycleRule[] =>
  Array.isArray(rules)
    ? rules.flatMap((rule) => {
        const eventTypes = Array.isArray(rule?.eventTypes) ? rule.eventTypes.filter(Boolean) : [];
        if (!rule?.action || eventTypes.length === 0) {
          return [];
        }

        return [{
          eventTypes,
          action: rule.action,
          matchKeys: Array.isArray(rule?.matchKeys) ? rule.matchKeys.filter(Boolean) : [],
          ruleMode: 'SIMPLE',
          script: '',
        }];
      })
    : [];

export const normalizeConditionRulesForForm = (rules?: ConditionRule[] | null) =>
  Array.isArray(rules)
    ? rules.map((rule) => ({
        ...rule,
        ruleMode: 'SIMPLE' as const,
        script: '',
      }))
    : [];
