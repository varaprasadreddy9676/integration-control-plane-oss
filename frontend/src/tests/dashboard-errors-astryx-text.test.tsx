import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';

vi.mock('../components/charts', () => ({ PieChart: () => null }));

import { DashboardErrorsTab } from '../features/dashboard/components/DashboardErrorsTab';

describe('dashboard errors typography', () => {
  it('renders error details with Astryx text and keeps the all-failures action', () => {
    const onViewAllFailures = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <DashboardErrorsTab
          errorsLoading={false}
          errorCategoryData={[]}
          topErrors={[{ message: 'Partner returned 503', count: 4, lastSeen: '2026-11-24T10:00:00Z' }]}
          noDataHint="No data"
          onViewAllFailures={onViewAllFailures}
          hiddenLegends={new Set()}
          onLegendClick={vi.fn()}
        />
      </ThemeProvider>
    );

    expect(container.querySelector('.ant-typography')).not.toBeInTheDocument();
    expect(screen.getByText('Partner returned 503')).toBeInTheDocument();
    expect(screen.getByText('4 occurrences')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View All Failures' }));
    expect(onViewAllFailures).toHaveBeenCalledOnce();
  });
});
