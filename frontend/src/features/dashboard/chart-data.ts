export interface DailyDeliveryTrendPoint {
  date: string;
  Successful: number;
  Failed: number;
  Skipped: number;
  'Success Rate': number;
  Total: number;
}

const count = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export function aggregateDailyDeliveryTrend(series: Array<Record<string, unknown>>): DailyDeliveryTrendPoint[] {
  const buckets = new Map<string, { date: Date; successful: number; failed: number; skipped: number; total: number }>();

  for (const point of series) {
    const timestamp = point.timestamp ? new Date(String(point.timestamp)) : null;
    if (!timestamp || Number.isNaN(timestamp.getTime())) continue;

    const dayKey = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}`;
    const current = buckets.get(dayKey) || { date: timestamp, successful: 0, failed: 0, skipped: 0, total: 0 };
    const successful = count(point.successful);
    const failed = count(point.failed);
    const skipped = count(point.skipped);
    const reportedTotal = point.total === undefined || point.total === null ? null : count(point.total);

    buckets.set(dayKey, {
      date: current.date,
      successful: current.successful + successful,
      failed: current.failed + failed,
      skipped: current.skipped + skipped,
      total: current.total + (reportedTotal ?? successful + failed + skipped),
    });
  }

  const ordered = Array.from(buckets.values()).sort((left, right) => left.date.getTime() - right.date.getTime());
  const labelCounts = new Map<string, number>();
  ordered.forEach(({ date }) => {
    const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  });

  return ordered.map(({ date, successful, failed, skipped, total }) => ({
    date: date.toLocaleDateString(
      'en-US',
      (labelCounts.get(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) || 0) > 1
        ? { month: 'short', day: 'numeric', year: 'numeric' }
        : { month: 'short', day: 'numeric' }
    ),
    Successful: successful,
    Failed: failed,
    Skipped: skipped,
    'Success Rate': total > 0 ? Number(((successful / total) * 100).toFixed(1)) : 0,
    Total: total,
  }));
}
