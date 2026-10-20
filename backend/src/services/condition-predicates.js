'use strict';

const { coerceDateTimestamp } = require('./date-coercion');

const ALLOWED_CONDITION_OPERATORS = [
  'EQUALS',
  'NOT_EQUALS',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL',
  'EXISTS',
  'NOT_EXISTS',
  'CONTAINS',
];

const ALLOWED_CONDITION_VALUE_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'DATE'];

function normalizeOperator(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'EQUALS';
  }
  return value.trim().toUpperCase();
}

function normalizeValueType(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'STRING';
  }
  return value.trim().toUpperCase();
}

function normalizeRuleConditions(conditions) {
  if (!Array.isArray(conditions)) {
    return [];
  }

  return conditions
    .map((condition) => ({
      fieldPath: typeof condition?.fieldPath === 'string' ? condition.fieldPath.trim() : '',
      operator: normalizeOperator(condition?.operator),
      valueType: normalizeValueType(condition?.valueType),
      value: condition?.value ?? null,
    }))
    .filter((condition) => condition.fieldPath || condition.value !== null || condition.operator !== 'EQUALS');
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

function coerceValue(rawValue, valueType) {
  switch (valueType) {
    case 'NUMBER': {
      const numeric = Number(rawValue);
      return Number.isFinite(numeric) ? numeric : null;
    }
    case 'BOOLEAN': {
      if (typeof rawValue === 'boolean') return rawValue;
      if (typeof rawValue === 'string') {
        const normalized = rawValue.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
      }
      return null;
    }
    case 'DATE': {
      return coerceDateTimestamp(rawValue);
    }
    default:
      return rawValue == null ? null : String(rawValue);
  }
}

function evaluateCondition(condition, payload) {
  const actualRaw = getValueAtPath(payload, condition.fieldPath);
  const exists = actualRaw !== undefined && actualRaw !== null;

  if (condition.operator === 'EXISTS') return exists;
  if (condition.operator === 'NOT_EXISTS') return !exists;

  if (!exists) {
    return false;
  }

  const actualValue = coerceValue(actualRaw, condition.valueType);
  const expectedValue = coerceValue(condition.value, condition.valueType);

  if (actualValue === null || expectedValue === null) {
    return false;
  }

  switch (condition.operator) {
    case 'EQUALS':
      return actualValue === expectedValue;
    case 'NOT_EQUALS':
      return actualValue !== expectedValue;
    case 'GREATER_THAN':
      return actualValue > expectedValue;
    case 'GREATER_THAN_OR_EQUAL':
      return actualValue >= expectedValue;
    case 'LESS_THAN':
      return actualValue < expectedValue;
    case 'LESS_THAN_OR_EQUAL':
      return actualValue <= expectedValue;
    case 'CONTAINS':
      return String(actualValue).includes(String(expectedValue));
    default:
      return false;
  }
}

function evaluateRuleConditions(conditions, payload) {
  const normalizedConditions = normalizeRuleConditions(conditions);
  if (normalizedConditions.length === 0) {
    return true;
  }

  return normalizedConditions.every((condition) => evaluateCondition(condition, payload));
}

function validateRuleConditions(conditions) {
  const normalizedConditions = normalizeRuleConditions(conditions);

  for (const condition of normalizedConditions) {
    if (!condition.fieldPath) {
      return { valid: false, error: 'Condition field path is required' };
    }

    if (!ALLOWED_CONDITION_OPERATORS.includes(condition.operator)) {
      return { valid: false, error: `Invalid condition operator: ${condition.operator}` };
    }

    if (!ALLOWED_CONDITION_VALUE_TYPES.includes(condition.valueType)) {
      return { valid: false, error: `Invalid condition value type: ${condition.valueType}` };
    }

    if (!['EXISTS', 'NOT_EXISTS'].includes(condition.operator) && (condition.value === null || condition.value === '')) {
      return { valid: false, error: `Condition value is required for ${condition.fieldPath}` };
    }
  }

  return { valid: true, normalizedConditions };
}

module.exports = {
  ALLOWED_CONDITION_OPERATORS,
  ALLOWED_CONDITION_VALUE_TYPES,
  normalizeRuleConditions,
  evaluateRuleConditions,
  validateRuleConditions,
};
