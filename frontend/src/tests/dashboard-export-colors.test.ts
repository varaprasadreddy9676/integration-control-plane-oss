import { describe, expect, it } from 'vitest';
import { normalizeExportColorFunctions } from '../features/dashboard/hooks/useDashboardExport';

describe('dashboard export color compatibility', () => {
  it('converts Chromium color(srgb) output to a legacy rgba color', () => {
    expect(normalizeExportColorFunctions('color(srgb 0.231373 0.509804 0.964706 / 0.12)')).toBe(
      'rgba(59, 130, 246, 0.12)'
    );
  });

  it('converts every modern color in a gradient while preserving the gradient', () => {
    expect(
      normalizeExportColorFunctions(
        'linear-gradient(color(srgb 0 0 0 / 0), color(srgb 1 1 1 / 0.8))'
      )
    ).toBe('linear-gradient(rgba(0, 0, 0, 0), rgba(255, 255, 255, 0.8))');
  });

  it('leaves legacy colors and unsupported color spaces unchanged for the fallback path', () => {
    expect(normalizeExportColorFunctions('rgba(59, 130, 246, 0.12)')).toBe('rgba(59, 130, 246, 0.12)');
    expect(normalizeExportColorFunctions('color(display-p3 0.2 0.4 0.8 / 0.5)')).toBe(
      'color(display-p3 0.2 0.4 0.8 / 0.5)'
    );
  });
});
