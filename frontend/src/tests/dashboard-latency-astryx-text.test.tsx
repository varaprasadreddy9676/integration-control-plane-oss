import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';

vi.mock('../components/charts', () => ({ BarChart: () => null }));

import { DashboardLatencyTab } from '../features/dashboard/components/DashboardLatencyTab';

describe('dashboard latency typography', () => {
  it('uses Astryx labels and tabular summary values', () => {
    const { container } = render(
      <ThemeProvider>
        <DashboardLatencyTab
          performanceLoading={false}
          latencyDistributionData={[]}
          latencySummary={{ avg: 84, p95: 240, min: 12, max: 910 }}
          noDataHint="No latency data"
          hiddenLegends={new Set()}
          onLegendClick={vi.fn()}
        />
      </ThemeProvider>
    );
    expect(container.querySelector('.ant-typography')).not.toBeInTheDocument();
    expect(screen.getByText('Average')).toBeInTheDocument();
    expect(screen.getByText('84 ms')).toBeInTheDocument();
    expect(screen.getByText('240 ms')).toBeInTheDocument();
    expect(screen.getByText('No latency data')).toBeInTheDocument();
  });
});
