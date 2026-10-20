import { describe, expect, it } from 'vitest';
import { inferFollowUpFieldSemantic } from '../features/integrations/routes/integrationDetail/utils/followUpFieldSemantics';

describe('inferFollowUpFieldSemantic', () => {
  it('infers datetime semantics from string fields with datetime-like paths and examples', () => {
    const semantic = inferFollowUpFieldSemantic({
      path: 'approval.approvedAt',
      type: 'string',
      example: '22/03/2026 03:30 PM',
    });

    expect(semantic.kind).toBe('datetime');
    expect(semantic.valueType).toBe('DATE');
    expect(semantic.supportsOffsetTiming).toBe(true);
  });

  it('infers date semantics from string fields with date-only examples', () => {
    const semantic = inferFollowUpFieldSemantic({
      path: 'appt.apptDate',
      type: 'string',
      example: '2026-03-22',
    });

    expect(semantic.kind).toBe('date');
    expect(semantic.valueType).toBe('DATE');
    expect(semantic.supportsOffsetTiming).toBe(true);
  });
});
