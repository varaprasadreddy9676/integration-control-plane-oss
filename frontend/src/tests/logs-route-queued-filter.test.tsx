import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { ThemeProvider } from '../app/theme-provider';

// Regression test: QUEUED is a real, commonly-emitted backend delivery status (see
// backend/src/routes/events.js, alert-center.js, system-logs.js, admin.js, logs.js), but it
// was missing from the Delivery Logs status filter.

const { useBreakpoint } = vi.hoisted(() => ({ useBreakpoint: vi.fn() }));
vi.mock('../components/common/LegacyAntdControls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/common/LegacyAntdControls')>();
  return { ...actual, Grid: { ...actual.Grid, useBreakpoint } };
});

vi.mock('../app/auth-context', () => ({
  useAuth: () => ({ user: { role: 'ORG_ADMIN' } }),
}));

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({ orgId: 33 }),
}));

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title, description }: any) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
}));

vi.mock('../components/common/ModernTable', async () => {
  const antd = await import('antd');
  return {
    ModernTable: (props: any) => (
      <div
        data-testid="modern-table-columns"
        data-columns={JSON.stringify(
          props.columns.map(({ key, width, fixed, responsive }: any) => ({ key, width, fixed, responsive }))
        )}
      >
        <antd.Table {...props} pagination={false} />
      </div>
    ),
  };
});

const mockApi = {
  getUIConfig: vi.fn(),
  getUIConfigOverride: vi.fn(),
  getLogs: vi.fn(),
  getLogStatsSummary: vi.fn(),
  getIntegrations: vi.fn(),
  getEventTypes: vi.fn(),
  retryLog: vi.fn(),
  forceRetryLog: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

describe('Delivery Logs list — QUEUED status filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBreakpoint.mockReturnValue({ md: true, lg: true, xl: true });
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.getUIConfigOverride.mockResolvedValue({});
    mockApi.getLogs.mockResolvedValue({ data: [], pagination: { total: 0, page: 1, limit: 15, totalPages: 0 } });
    mockApi.getLogStatsSummary.mockResolvedValue({ total: 0, success: 0, failed: 0, skipped: 0, pending: 0 });
    mockApi.getIntegrations.mockResolvedValue([]);
    mockApi.getEventTypes.mockResolvedValue([]);
  });

  const renderRoute = async (initialEntry = '/logs') => {
    const { LogsRoute } = await import('../features/logs/routes/LogsRoute');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <App>
            <MemoryRouter initialEntries={[initialEntry]}>
              <LogsRoute />
              <LocationProbe />
            </MemoryRouter>
          </App>
        </QueryClientProvider>
      </ThemeProvider>
    );
  };

  it('offers the sentence-case queued status in the top Status filter dropdown', async () => {
    await renderRoute();

    const statusSelect = await screen.findByText('Status');
    const selector = statusSelect.closest('.ant-select-selector') as HTMLElement;
    fireEvent.mouseDown(selector);

    expect(await screen.findByRole('option', { name: 'Pending (queued)' })).toBeInTheDocument();
  });

  it('shows the filter controls on a fresh visit, before any filter exists', async () => {
    // Regression: the toolbar was hidden unless a non-date filter was already
    // active — but the only controls for creating one live inside it, so the
    // delivery log could not be filtered at all. toBeVisible() is the point
    // here: findByText alone passes on a display:none subtree.
    await renderRoute();

    expect(await screen.findByText('Filters')).toBeVisible();
    expect(screen.getByText('Status')).toBeVisible();
    expect(screen.getByPlaceholderText('Start date')).toBeVisible();
  });

  it('clears an applied filter through a labeled keyboard-accessible button', async () => {
    await renderRoute('/logs?status=FAILED');

    const clearStatus = await screen.findByRole('button', {
      name: 'Clear filter: Status: Failed (including abandoned)',
    });
    expect(clearStatus).toBeVisible();
    fireEvent.click(clearStatus);

    await waitFor(() => {
      expect(new URLSearchParams(screen.getByTestId('location-search').textContent || '').has('status')).toBe(false);
    });
  });

  it('keeps status and delivery diagnostics in the desktop table without a pinned action overlay', async () => {
    await renderRoute();

    const columns = JSON.parse(screen.getByTestId('modern-table-columns').getAttribute('data-columns') || '[]');
    const byKey = Object.fromEntries(columns.map((column: any) => [column.key, column]));
    const primaryDesktopColumns = [
      'createdAt',
      'integrationName',
      'eventType',
      'status',
      'responseStatus',
      'responseTimeMs',
      'attemptCount',
      'actions',
    ];

    expect(primaryDesktopColumns.every((key) => typeof byKey[key]?.width === 'number')).toBe(true);
    expect(primaryDesktopColumns.reduce((sum, key) => sum + byKey[key].width, 0)).toBeLessThanOrEqual(1000);
    expect(byKey.actions.fixed).toBeUndefined();
  });

  it('widens the date range from the empty state', async () => {
    await renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Search last 7 days' }));
    await waitFor(() => {
      const query = mockApi.getLogs.mock.calls.at(-1)?.[0];
      expect(query?.dateRange).toHaveLength(2);
      const duration = new Date(query.dateRange[1]).getTime() - new Date(query.dateRange[0]).getTime();
      expect(duration).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams(screen.getByTestId('location-search').textContent || '');
      expect(params.get('startDate')).toBe(query.dateRange[0]);
      expect(params.get('endDate')).toBe(query.dateRange[1]);
    });
  });

  it('discloses only the compact delivery summary columns on phones', async () => {
    useBreakpoint.mockReturnValue({ md: false, lg: false, xl: false });
    await renderRoute();

    const columns = JSON.parse(screen.getByTestId('modern-table-columns').getAttribute('data-columns') || '[]');
    expect(columns.map(({ key }: { key: string }) => key)).toEqual(['createdAt', 'integrationName', 'status', 'actions']);
  });
});
