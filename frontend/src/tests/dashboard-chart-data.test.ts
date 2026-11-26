import { describe, expect, it } from 'vitest';
import { aggregateDailyDeliveryTrend } from '../features/dashboard/chart-data';

describe('aggregateDailyDeliveryTrend', () => {
  it('combines multiple API rows for one calendar day and sorts the daily buckets', () => {
    const result = aggregateDailyDeliveryTrend([
      { timestamp: '2026-11-23T09:00:00.000Z', total: 20, successful: 18, failed: 1, skipped: 1 },
      { timestamp: '2026-11-22T09:00:00.000Z', total: 10, successful: 9, failed: 0, skipped: 1 },
      { timestamp: '2026-11-23T01:00:00.000Z', total: 30, successful: 27, failed: 2, skipped: 1 },
    ]);

    expect(result.map((point) => point.date)).toEqual(['Nov 22', 'Nov 23']);
    expect(result[1]).toMatchObject({ Successful: 45, Failed: 3, Skipped: 2, Total: 50, 'Success Rate': 90 });
  });

  it('ignores invalid timestamps and derives total when the API omits it', () => {
    const result = aggregateDailyDeliveryTrend([
      { timestamp: 'not-a-date', successful: 5, failed: 1, skipped: 0 },
      { timestamp: '2026-11-23T10:00:00.000Z', successful: 5, failed: 1, skipped: 0 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ Successful: 5, Failed: 1, Skipped: 0, Total: 6, 'Success Rate': 83.3 });
  });

  it('keeps date labels unique when a range spans the same day in different years', () => {
    const result = aggregateDailyDeliveryTrend([
      { timestamp: '2025-11-22T12:00:00.000Z', successful: 1 },
      { timestamp: '2026-11-22T12:00:00.000Z', successful: 2 },
    ]);

    expect(result.map((point) => point.date)).toEqual(['Nov 22, 2025', 'Nov 22, 2026']);
  });

  it('normalizes malformed and negative event counts before aggregating', () => {
    const result = aggregateDailyDeliveryTrend([
      { timestamp: '2026-11-23T10:00:00.000Z', successful: -5, failed: 'invalid', skipped: 2, total: -3 },
    ]);

    expect(result[0]).toMatchObject({ Successful: 0, Failed: 0, Skipped: 2, Total: 0, 'Success Rate': 0 });
  });
});
