import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { ThemeProvider } from '../app/theme-provider';

// Regression test: the backend was fixed to fold QUEUED into the `pending` bucket so
// total === successful + failed + skipped + retrying + pending, but the "Total Deliveries"
// card's breakdown text only ever displayed successful/failed/skipped — so a QUEUED delivery
// still made "3 total, 2 successful, 0 failed, 0 skipped" look broken to any user reading it,
// even though the underlying data was now internally consistent. Fixed to surface pending/
// retrying in the breakdown whenever they're non-zero, and to omit them when zero so the
// common fully-resolved case doesn't get cluttered with "0 pending, 0 retrying".

vi.mock('../app/auth-context', () => ({
  useAuth: () => ({ user: { role: 'ORG_ADMIN' } }),
}));

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({ orgId: 33 }),
}));

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

const mockApi = {
  getDashboardSummary: vi.fn(),
  getAnalyticsOverview: vi.fn(),
  getAnalyticsTimeseries: vi.fn(),
  getAnalyticsErrors: vi.fn(),
  getAnalyticsPerformance: vi.fn(),
  getUIConfig: vi.fn(),
  getUIConfigOverride: vi.fn(),
  getIntegrations: vi.fn(),
  getInboundIntegrations: vi.fn(),
  getAllScheduledJobs: vi.fn(),
  getRecentLogs: vi.fn(),
  getEventAuditStats: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

describe('Dashboard "Total Deliveries" breakdown includes pending/retrying when present', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getDashboardSummary.mockResolvedValue({});
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.getUIConfigOverride.mockResolvedValue({});
    mockApi.getIntegrations.mockResolvedValue([]);
    mockApi.getInboundIntegrations.mockResolvedValue([]);
    mockApi.getAllScheduledJobs.mockResolvedValue([]);
    mockApi.getRecentLogs.mockResolvedValue({ data: [], pagination: { total: 0 } });
    mockApi.getEventAuditStats.mockResolvedValue({});
    mockApi.getAnalyticsTimeseries.mockResolvedValue([]);
    mockApi.getAnalyticsErrors.mockResolvedValue([]);
    mockApi.getAnalyticsPerformance.mockResolvedValue({});
    mockApi.getAnalyticsOverview.mockResolvedValue({
      summary: { total: 3, successful: 2, failed: 0, skipped: 0, retrying: 0, pending: 1, successRate: 66.67 },
    });
  });

  const renderRoute = async () => {
    const { DashboardRoute } = await import('../features/dashboard/DashboardRoute');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <App>
            <MemoryRouter initialEntries={['/dashboard']}>
              <DashboardRoute />
            </MemoryRouter>
          </App>
        </QueryClientProvider>
      </ThemeProvider>
    );
  };

  it('shows the pending count so the breakdown actually sums to the total', async () => {
    await renderRoute();

    await waitFor(() => expect(mockApi.getAnalyticsOverview).toHaveBeenCalled());
    expect(await screen.findByText('2 successful, 0 failed, 0 skipped, 1 pending')).toBeInTheDocument();
  });

  it('omits pending/retrying entirely when both are zero, to avoid clutter', async () => {
    mockApi.getAnalyticsOverview.mockResolvedValue({
      summary: { total: 2, successful: 2, failed: 0, skipped: 0, retrying: 0, pending: 0, successRate: 100 },
    });

    await renderRoute();

    await waitFor(() => expect(mockApi.getAnalyticsOverview).toHaveBeenCalled());
    expect(await screen.findByText('2 successful, 0 failed, 0 skipped')).toBeInTheDocument();
    expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
  });
});
