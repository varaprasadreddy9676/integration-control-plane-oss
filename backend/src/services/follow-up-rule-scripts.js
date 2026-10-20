'use strict';

const { VM } = require('../utils/secure-vm');

const ALLOWED_FOLLOW_UP_RULE_MODES = ['SIMPLE', 'SCRIPT'];

function normalizeRuleMode(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'SIMPLE';
  }

  const normalized = value.trim().toUpperCase();
  return ALLOWED_FOLLOW_UP_RULE_MODES.includes(normalized) ? normalized : 'SIMPLE';
}

function normalizeRuleScript(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateRuleScript(script, label = 'Rule') {
  if (!script) {
    return { valid: false, error: `${label} script is required` };
  }

  try {
    // eslint-disable-next-line no-new-func
    new Function('payload', 'eventType', 'context', `async function __followUpRule(payload, eventType, context) { ${script} }`);
    return { valid: true };
  } catch (_error) {
    return { valid: false, error: `Invalid ${label.toLowerCase()} script` };
  }
}

async function evaluateRuleScript(script, { payload, eventType, context }) {
  const vm = new VM({
    timeout: 5000,
    sandbox: {
      payload: payload || {},
      eventType: eventType || null,
      context: context || {},
    },
  });

  const result = await vm.run(script);
  return Boolean(result);
}

module.exports = {
  ALLOWED_FOLLOW_UP_RULE_MODES,
  normalizeRuleMode,
  normalizeRuleScript,
  validateRuleScript,
  evaluateRuleScript,
};
