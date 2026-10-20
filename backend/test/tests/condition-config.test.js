'use strict';

const { resolveConditionRuleReleaseDate } = require('../../src/services/condition-config');

describe('condition-config release timing', () => {
  it('returns null release date for immediate rules', () => {
    const result = resolveConditionRuleReleaseDate(
      {
        action: 'RELEASE_HELD',
        releaseTiming: { mode: 'IMMEDIATE' },
      },
      {
        approval: {
          approvedAt: '2026-03-22T10:00:00Z',
        },
      }
    );

    expect(result.valid).toBe(true);
    expect(result.releaseAt).toBeNull();
  });

  it('calculates delayed release from follow-up event field', () => {
    const result = resolveConditionRuleReleaseDate(
      {
        action: 'RELEASE_HELD',
        releaseTiming: {
          mode: 'OFFSET_FROM_EVENT_FIELD',
          eventFieldPath: 'approval.approvedAt',
          offsetValue: 2,
          offsetUnit: 'HOURS',
        },
      },
      {
        approval: {
          approvedAt: '2026-03-22T10:00:00Z',
        },
      },
      new Date('2026-03-22T09:00:00Z')
    );

    expect(result.valid).toBe(true);
    expect(result.releaseAt?.toISOString()).toBe('2026-03-22T12:00:00.000Z');
  });

  it('calculates delayed release from DD/MM/YYYY HH:mm AM/PM follow-up event fields', () => {
    const result = resolveConditionRuleReleaseDate(
      {
        action: 'RELEASE_HELD',
        releaseTiming: {
          mode: 'OFFSET_FROM_EVENT_FIELD',
          eventFieldPath: 'approval.approvedAt',
          offsetValue: 1,
          offsetUnit: 'DAYS',
        },
      },
      {
        approval: {
          approvedAt: '22/03/2026 03:30 PM',
        },
      },
      new Date('2026-03-22T09:00:00Z')
    );

    expect(result.valid).toBe(true);
    expect(result.releaseAt?.getTime()).toBe(new Date(2026, 2, 23, 15, 30, 0, 0).getTime());
  });
});
