'use strict';

const { evaluateRuleConditions } = require('../../src/services/condition-predicates');

describe('condition predicates', () => {
  it('compares date-only strings as dates', () => {
    const matched = evaluateRuleConditions(
      [
        {
          fieldPath: 'approval.approvedAt',
          operator: 'GREATER_THAN_OR_EQUAL',
          valueType: 'DATE',
          value: '2026-03-22',
        },
      ],
      {
        approval: {
          approvedAt: '2026-03-22',
        },
      }
    );

    expect(matched).toBe(true);
  });

  it('compares epoch timestamps automatically for date fields', () => {
    const matched = evaluateRuleConditions(
      [
        {
          fieldPath: 'approval.approvedAt',
          operator: 'GREATER_THAN',
          valueType: 'DATE',
          value: '2026-03-22T10:00:00Z',
        },
      ],
      {
        approval: {
          approvedAt: 1987654322000,
        },
      }
    );

    expect(matched).toBe(true);
  });

  it('compares DD/MM/YYYY HH:mm AM/PM strings for date fields', () => {
    const matched = evaluateRuleConditions(
      [
        {
          fieldPath: 'approval.approvedAt',
          operator: 'GREATER_THAN',
          valueType: 'DATE',
          value: '2026-03-22T09:00:00Z',
        },
      ],
      {
        approval: {
          approvedAt: '22/03/2026 03:30 PM',
        },
      }
    );

    expect(matched).toBe(true);
  });
});
