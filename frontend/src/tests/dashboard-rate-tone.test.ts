import { describe, expect, it } from 'vitest';
import {
  getDashboardIntegrationRowKey,
  getDashboardRateTone,
} from '../features/dashboard/components/DashboardPrimitives';

describe('Dashboard metric tone thresholds', () => {
  it('uses success at 95 percent and above', () => {
    expect(getDashboardRateTone(95)).toBe('success');
    expect(getDashboardRateTone(100)).toBe('success');
  });

  it('uses warning from 85 up to 95 percent', () => {
    expect(getDashboardRateTone(85)).toBe('warning');
    expect(getDashboardRateTone(94.9)).toBe('warning');
  });

  it('uses error below 85 percent', () => {
    expect(getDashboardRateTone(84.9)).toBe('error');
    expect(getDashboardRateTone(0)).toBe('error');
  });
});

describe('Dashboard integration row keys', () => {
  it.each([
    [{ integrationConfigId: 'legacy-id' }, 'legacy-id'],
    [{ integrationConfigId: 'config-id' }, 'config-id'],
    [{ id: 'api-id' }, 'api-id'],
    [{ integrationName: 'normalized name' }, 'normalized name'],
    [{ integrationName: 'API name' }, 'API name'],
    [{}, '{}'],
  ])('uses a stable identifier when API fields vary', (record, expected) => {
    expect(getDashboardIntegrationRowKey(record)).toBe(expected);
  });
});
