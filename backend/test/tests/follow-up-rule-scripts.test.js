'use strict';

const {
  normalizeRuleMode,
  validateRuleScript,
  evaluateRuleScript,
} = require('../../src/services/follow-up-rule-scripts');

describe('follow-up-rule-scripts', () => {
  test('normalizes rule mode', () => {
    expect(normalizeRuleMode(undefined)).toBe('SIMPLE');
    expect(normalizeRuleMode('script')).toBe('SCRIPT');
    expect(normalizeRuleMode('unknown')).toBe('SIMPLE');
  });

  test('validates script syntax', () => {
    expect(validateRuleScript("return payload.status === 'APPROVED';").valid).toBe(true);
    expect(validateRuleScript('if (').valid).toBe(false);
  });

  test('evaluates script against payload', async () => {
    await expect(
      evaluateRuleScript("return payload.status === 'APPROVED';", {
        payload: { status: 'APPROVED' },
        eventType: 'GRN_APPROVED',
        context: {},
      })
    ).resolves.toBe(true);

    await expect(
      evaluateRuleScript('return Number(payload.amount) > 100;', {
        payload: { amount: 80 },
        eventType: 'GRN_APPROVED',
        context: {},
      })
    ).resolves.toBe(false);
  });
});
