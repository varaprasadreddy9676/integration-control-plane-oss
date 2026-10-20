'use strict';

const { normalizeSubjectExtraction } = require('./lifecycle-config');
const { normalizeRuleConditions, validateRuleConditions } = require('./condition-predicates');
const { coerceDateValue } = require('./date-coercion');
const {
  normalizeRuleMode,
  normalizeRuleScript,
  validateRuleScript,
} = require('./follow-up-rule-scripts');

const CONDITION_DELIVERY_MODES = ['WAIT_FOR_EVENT', 'WAIT_FOR_CONDITION'];
const ALLOWED_CONDITION_ACTIONS = ['RELEASE_HELD', 'DISCARD_HELD'];
const ALLOWED_PAYLOAD_STRATEGIES = ['ORIGINAL_EVENT'];
const ALLOWED_RELEASE_TIMING_MODES = ['IMMEDIATE', 'OFFSET_FROM_EVENT_FIELD'];
const ALLOWED_RELEASE_OFFSET_UNITS = ['MINUTES', 'HOURS', 'DAYS'];

function normalizeDeliveryMode(deliveryMode) {
  if (typeof deliveryMode !== 'string' || deliveryMode.trim() === '') {
    return 'IMMEDIATE';
  }

  const normalized = deliveryMode.trim().toUpperCase();
  if (normalized === 'WAIT_FOR_EVENT') {
    return 'WAIT_FOR_CONDITION';
  }

  return normalized;
}

function isConditionDeliveryMode(deliveryMode) {
  return normalizeDeliveryMode(deliveryMode) === 'WAIT_FOR_CONDITION';
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === 'string' && value.trim() !== '')
        .map((value) => value.trim())
    )
  );
}

function getValueAtPath(payload, fieldPath) {
  if (!payload || typeof payload !== 'object' || !fieldPath) {
    return undefined;
  }

  return fieldPath.split('.').reduce((current, segment) => {
    if (current == null) {
      return undefined;
    }
    return current[segment];
  }, payload);
}

function normalizeReleaseTiming(releaseTiming, action) {
  if (action !== 'RELEASE_HELD') {
    return {
      mode: 'IMMEDIATE',
      eventFieldPath: '',
      offsetValue: 0,
      offsetUnit: 'HOURS',
    };
  }

  const rawMode = typeof releaseTiming?.mode === 'string' ? releaseTiming.mode.trim().toUpperCase() : 'IMMEDIATE';
  const mode = ALLOWED_RELEASE_TIMING_MODES.includes(rawMode) ? rawMode : 'IMMEDIATE';
  const rawOffsetValue = Number(releaseTiming?.offsetValue);
  const offsetValue = Number.isFinite(rawOffsetValue) ? rawOffsetValue : 0;
  const rawOffsetUnit = typeof releaseTiming?.offsetUnit === 'string' ? releaseTiming.offsetUnit.trim().toUpperCase() : 'HOURS';
  const offsetUnit = ALLOWED_RELEASE_OFFSET_UNITS.includes(rawOffsetUnit) ? rawOffsetUnit : 'HOURS';

  return {
    mode,
    eventFieldPath: typeof releaseTiming?.eventFieldPath === 'string' ? releaseTiming.eventFieldPath.trim() : '',
    offsetValue,
    offsetUnit,
  };
}

function offsetToMs(offsetValue, offsetUnit) {
  switch (offsetUnit) {
    case 'MINUTES':
      return offsetValue * 60 * 1000;
    case 'DAYS':
      return offsetValue * 24 * 60 * 60 * 1000;
    default:
      return offsetValue * 60 * 60 * 1000;
  }
}

function normalizeConditionRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules
    .map((rule) => ({
      eventTypes: normalizeStringList(rule?.eventTypes),
      action: typeof rule?.action === 'string' ? rule.action.trim() : '',
      matchKeys: normalizeStringList(rule?.matchKeys),
      conditions: normalizeRuleConditions(rule?.conditions),
      ruleMode: normalizeRuleMode(rule?.ruleMode),
      script: normalizeRuleScript(rule?.script),
      releaseTiming: normalizeReleaseTiming(rule?.releaseTiming, typeof rule?.action === 'string' ? rule.action.trim() : ''),
    }))
    .filter((rule) => rule.eventTypes.length > 0 || rule.action || rule.matchKeys.length > 0 || rule.conditions.length > 0 || rule.script);
}

function normalizeConditionConfig(conditionConfig) {
  if (!conditionConfig || typeof conditionConfig !== 'object' || Array.isArray(conditionConfig)) {
    return null;
  }

  const payloadStrategy = typeof conditionConfig.payloadStrategy === 'string'
    ? conditionConfig.payloadStrategy.trim().toUpperCase()
    : 'ORIGINAL_EVENT';

  const expiresAfterMsRaw = conditionConfig.expiresAfterMs;
  const expiresAfterMs = Number.isFinite(Number(expiresAfterMsRaw)) && Number(expiresAfterMsRaw) > 0
    ? Math.floor(Number(expiresAfterMsRaw))
    : null;

  const releaseRules = normalizeConditionRules(conditionConfig.releaseRules);
  const discardRules = normalizeConditionRules(conditionConfig.discardRules);

  if (
    releaseRules.length === 0 &&
    discardRules.length === 0 &&
    payloadStrategy === 'ORIGINAL_EVENT' &&
    expiresAfterMs === null
  ) {
    return null;
  }

  return {
    payloadStrategy: ALLOWED_PAYLOAD_STRATEGIES.includes(payloadStrategy) ? payloadStrategy : payloadStrategy,
    expiresAfterMs,
    releaseRules,
    discardRules,
  };
}

function findConditionRule(conditionConfig, eventType) {
  if (!eventType) {
    return null;
  }

  const normalized = normalizeConditionConfig(conditionConfig);
  if (!normalized) {
    return null;
  }

  return [...normalized.releaseRules, ...normalized.discardRules].find((rule) => rule.eventTypes.includes(eventType)) || null;
}

function validateConditionConfig({ deliveryMode, resourceType, subjectExtraction, subjectMapping, conditionConfig }) {
  const normalizedDeliveryMode = normalizeDeliveryMode(deliveryMode);
  const normalizedConditionConfig = normalizeConditionConfig(conditionConfig);
  const normalizedSubjectExtraction = normalizeSubjectExtraction(subjectExtraction, subjectMapping);

  if (!normalizedConditionConfig) {
    if (normalizedDeliveryMode === 'WAIT_FOR_CONDITION') {
      return { valid: false, error: 'conditionConfig is required for WAIT_FOR_CONDITION delivery mode' };
    }

    return {
      valid: true,
      normalizedDeliveryMode,
      normalizedSubjectExtraction,
      normalizedConditionConfig: null,
    };
  }

  if (normalizedDeliveryMode !== 'WAIT_FOR_CONDITION') {
    return { valid: false, error: 'conditionConfig can only be used with WAIT_FOR_CONDITION delivery mode' };
  }

  if (!resourceType || typeof resourceType !== 'string' || resourceType.trim() === '') {
    return { valid: false, error: 'resourceType is required when conditionConfig is configured' };
  }

  if (!normalizedSubjectExtraction) {
    return { valid: false, error: 'subjectExtraction is required when conditionConfig is configured' };
  }

  if (normalizedConditionConfig.releaseRules.length === 0) {
    return { valid: false, error: 'conditionConfig requires at least one release rule' };
  }

  if (!ALLOWED_PAYLOAD_STRATEGIES.includes(normalizedConditionConfig.payloadStrategy)) {
    return { valid: false, error: `Invalid condition payload strategy: ${normalizedConditionConfig.payloadStrategy}` };
  }

  const seenEventTypes = new Set();
  const availablePathKeys =
    normalizedSubjectExtraction.mode === 'PATHS' ? new Set(Object.keys(normalizedSubjectExtraction.paths || {})) : null;

  for (const rule of [...normalizedConditionConfig.releaseRules, ...normalizedConditionConfig.discardRules]) {
    if (!ALLOWED_CONDITION_ACTIONS.includes(rule.action)) {
      return { valid: false, error: `Invalid condition rule action: ${rule.action}` };
    }

    if (rule.eventTypes.length === 0) {
      return { valid: false, error: 'Each condition rule must include at least one event type' };
    }

    if (rule.matchKeys.length === 0) {
      return { valid: false, error: `Condition rule for ${rule.eventTypes.join(', ')} must include at least one matchKey` };
    }

    if (rule.ruleMode === 'SCRIPT') {
      const scriptValidation = validateRuleScript(rule.script, 'Condition rule');
      if (!scriptValidation.valid) {
        return scriptValidation;
      }
    } else {
      const conditionValidation = validateRuleConditions(rule.conditions);
      if (!conditionValidation.valid) {
        return { valid: false, error: conditionValidation.error };
      }
    }

    if (rule.action === 'RELEASE_HELD' && rule.releaseTiming?.mode === 'OFFSET_FROM_EVENT_FIELD') {
      if (!rule.releaseTiming.eventFieldPath) {
        return { valid: false, error: `Release timing for ${rule.eventTypes.join(', ')} requires an event field` };
      }

      if (!Number.isFinite(rule.releaseTiming.offsetValue) || rule.releaseTiming.offsetValue < 0) {
        return { valid: false, error: `Release timing for ${rule.eventTypes.join(', ')} requires a valid offset` };
      }

      if (!ALLOWED_RELEASE_OFFSET_UNITS.includes(rule.releaseTiming.offsetUnit)) {
        return { valid: false, error: `Invalid release timing offset unit: ${rule.releaseTiming.offsetUnit}` };
      }
    }

    for (const eventType of rule.eventTypes) {
      if (seenEventTypes.has(eventType)) {
        return { valid: false, error: `Duplicate condition rule event type: ${eventType}` };
      }
      seenEventTypes.add(eventType);
    }

    if (availablePathKeys && rule.matchKeys.some((key) => !availablePathKeys.has(key))) {
      const missingKeys = rule.matchKeys.filter((key) => !availablePathKeys.has(key));
      return {
        valid: false,
        error: `Condition rule references unmapped subject keys: ${missingKeys.join(', ')}`,
      };
    }
  }

  return {
    valid: true,
    normalizedDeliveryMode,
    normalizedSubjectExtraction,
    normalizedConditionConfig,
  };
}

function buildConditionProfile(integration, eventType) {
  const deliveryMode = normalizeDeliveryMode(integration?.deliveryMode);
  if (deliveryMode !== 'WAIT_FOR_CONDITION') {
    return null;
  }

  const conditionRule = findConditionRule(integration?.conditionConfig, eventType);
  if (!conditionRule) {
    return null;
  }

  const subjectExtraction = normalizeSubjectExtraction(integration?.subjectExtraction, integration?.subjectMapping);
  if (!subjectExtraction) {
    return null;
  }

  return {
    integrationId: integration.id,
    integrationName: integration.name,
    integration,
    eventType,
    action: conditionRule.action,
    subjectType: integration.resourceType || null,
    subjectExtraction,
    conditionRule,
    matchKeys: conditionRule.matchKeys,
    conditions: conditionRule.conditions || [],
    payloadStrategy: integration?.conditionConfig?.payloadStrategy || 'ORIGINAL_EVENT',
  };
}

function resolveConditionRuleReleaseDate(conditionRule, payload, now = new Date()) {
  const releaseTiming = normalizeReleaseTiming(conditionRule?.releaseTiming, conditionRule?.action);

  if (releaseTiming.mode !== 'OFFSET_FROM_EVENT_FIELD') {
    return {
      valid: true,
      releaseAt: null,
      releaseTiming,
    };
  }

  const rawFieldValue = getValueAtPath(payload, releaseTiming.eventFieldPath);
  const baseDate = coerceDateValue(rawFieldValue);
  if (!baseDate) {
    return {
      valid: false,
      error: `Could not read a valid date from ${releaseTiming.eventFieldPath}`,
      releaseTiming,
    };
  }

  const releaseAt = new Date(baseDate.getTime() + offsetToMs(releaseTiming.offsetValue, releaseTiming.offsetUnit));
  if (!Number.isFinite(releaseAt.getTime())) {
    return {
      valid: false,
      error: `Could not calculate release time from ${releaseTiming.eventFieldPath}`,
      releaseTiming,
    };
  }

  return {
    valid: true,
    releaseAt: releaseAt <= now ? null : releaseAt,
    releaseTiming,
  };
}

module.exports = {
  CONDITION_DELIVERY_MODES,
  ALLOWED_CONDITION_ACTIONS,
  ALLOWED_PAYLOAD_STRATEGIES,
  ALLOWED_RELEASE_TIMING_MODES,
  ALLOWED_RELEASE_OFFSET_UNITS,
  normalizeDeliveryMode,
  isConditionDeliveryMode,
  normalizeConditionRules,
  normalizeConditionConfig,
  findConditionRule,
  validateConditionConfig,
  buildConditionProfile,
  resolveConditionRuleReleaseDate,
};
