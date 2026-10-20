import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The dashboard metric tiles briefly shipped a "sparkline" built from
 * constants: fixed bar heights ([35, 55, 30, 70, ...]) and fixed SVG path
 * geometry, in a component that took no data argument. Every tile drew the
 * same rising trend on every load — including while the tile itself displayed
 * "No data for this range".
 *
 * On a delivery-monitoring console that is not decoration. An operator can read
 * a recovery, or a spike, off a line that never moves. If a sparkline returns,
 * it has to be driven by the real series (timeseriesDaily is already fetched in
 * DashboardRoute), so this guards the shape rather than the styling: no chart
 * geometry may be hardcoded in the tile component.
 */
const source = readFileSync(
  resolve(__dirname, '../features/dashboard/components/DashboardPrimitives.tsx'),
  'utf-8'
);

describe('dashboard metric tiles do not fabricate data', () => {
  it('has no hardcoded SVG path geometry', () => {
    const paths = source.match(/\sd="M[\d\s.,QTCLHVZ-]+"/gi) || [];
    expect(paths).toEqual([]);
  });

  it('has no hardcoded numeric series driving a visual', () => {
    // e.g. [35, 55, 30, 70, 50, 90, ...] mapped to bar heights
    const series = source.match(/\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+[^\]]*\]/g) || [];
    expect(series).toEqual([]);
  });

  it('still renders the tile value and label', () => {
    expect(source).toContain('{value}');
    expect(source).toContain('{label}');
  });
});
