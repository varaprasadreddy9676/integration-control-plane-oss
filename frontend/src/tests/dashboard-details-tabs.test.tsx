import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { DashboardDetailsTabs } from '../features/dashboard/components/DashboardDetailsTabs';

describe('DashboardDetailsTabs', () => {
  it('uses accessible Astryx tabs and reports selection changes', () => {
    const onChange = vi.fn();

    render(
      <ThemeProvider>
        <DashboardDetailsTabs
          activeKey="overview"
          onChange={onChange}
          items={[
            { key: 'overview', label: 'Overview' },
            { key: 'errors', label: 'Errors' },
          ]}
        />
      </ThemeProvider>
    );

    const tabList = screen.getByRole('tablist', { name: 'Dashboard details' });
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    const errorsTab = screen.getByRole('tab', { name: 'Errors' });

    expect(tabList).toBeInTheDocument();
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(overviewTab).toHaveAttribute('aria-controls', 'dashboard-panel-overview');

    fireEvent.click(errorsTab);
    expect(onChange).toHaveBeenCalledWith('errors');
  });
});
