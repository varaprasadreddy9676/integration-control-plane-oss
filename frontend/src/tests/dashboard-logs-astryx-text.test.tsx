import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { DashboardLogsTab } from '../features/dashboard/components/DashboardLogsTab';

describe('dashboard logs typography', () => {
  it('uses Astryx text and preserves failed delivery details and navigation', () => {
    const onViewAll = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <DashboardLogsTab
          logsLoading={false}
          logs={[{ id: 'log-1', __KEEP_integrationName__: 'Partner API', errorMessage: 'Upstream timeout', createdAt: '2026-11-24T10:00:00Z' }]}
          noDataHint="No failures"
          onViewAll={onViewAll}
        />
      </ThemeProvider>
    );
    expect(container.querySelector('.ant-typography')).not.toBeInTheDocument();
    expect(screen.getByText('Partner API')).toBeInTheDocument();
    expect(screen.getByText('Upstream timeout')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Logs' }));
    expect(onViewAll).toHaveBeenCalledOnce();
  });
});
