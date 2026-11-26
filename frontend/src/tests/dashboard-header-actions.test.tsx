import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DashboardHeader } from '../features/dashboard/components/DashboardHeader';

describe('DashboardHeader actions', () => {
  it('keeps the refresh and export icon actions grouped when the toolbar wraps', () => {
    const { container } = render(
      <DashboardHeader
        title="Dashboard"
        subtitle="Delivery performance"
        manageLabel="Manage integrations"
        onManage={vi.fn()}
        onViewLogs={vi.fn()}
        onRefresh={vi.fn()}
        refreshing={false}
        refreshSeconds={60}
        lastRefreshedAt={Date.now()}
        exportMenuItems={[]}
        isExporting={false}
      />
    );

    const iconActions = container.querySelector('.dashboard-icon-actions');
    const titleWrap = container.querySelector('.dashboard-title-wrap');
    expect(titleWrap?.querySelector('.ant-typography')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(iconActions).not.toBeNull();
    expect(
      within(iconActions as HTMLElement).getByRole('button', { name: 'Refresh dashboard data' })
    ).toBeInTheDocument();
    expect(
      within(iconActions as HTMLElement).getByRole('button', { name: 'Export dashboard data' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View delivery logs' })).toBeInTheDocument();
  });
});
