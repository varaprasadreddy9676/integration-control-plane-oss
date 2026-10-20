import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';

const tenantState = vi.hoisted(() => ({ orgId: 33 }));

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({ orgId: tenantState.orgId }),
}));

const mockApi = {
  getDashboardSummary: vi.fn(),
  getAnalyticsOverview: vi.fn(),
  getAnalyticsTimeseries: vi.fn(),
  getAnalyticsErrors: vi.fn(),
  getAnalyticsPerformance: vi.fn(),
  getEventAuditStats: vi.fn(),
  getUIConfig: vi.fn(),
  getUIConfigOverride: vi.fn(),
  sendDashboardEmail: vi.fn(),
  getAllIntegrations: vi.fn(),
  getAllScheduledJobs: vi.fn(),
  getLogs: vi.fn(),
  getScheduledJobLogs: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

vi.mock('../utils/navigation', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

vi.mock('../features/dashboard/hooks/useDashboardExport', () => ({
  useDashboardExport: () => ({
    exportDashboard: vi.fn(),
    isExporting: false,
  }),
}));

vi.mock('../design-system/utils', async () => ({
  // Real cssVar rather than a stub: it is a flat map of CSS custom property
  // strings, so using the actual one keeps the mock from drifting every time a
  // component reaches for another token.
  cssVar: (await import('../design-system/utils/cssVar')).cssVar,
  useDesignTokens: () => ({
    themeColors: {
      text: { primary: '#1c2128' },
      primary: { default: '#2563eb' },
      success: { text: '#16a34a' },
      warning: { text: '#ca8a04' },
      info: { text: '#0891b2' },
      error: { text: '#dc2626' },
    },
    spacing: {
      2: '8px',
      3: '12px',
      4: '16px',
    },
  }),
}));

vi.mock('../features/dashboard/components', () => ({
  DashboardHeader: ({ onRefresh }: { onRefresh: () => void }) => <button onClick={onRefresh}>Refresh</button>,
  DashboardToolbar: ({ statusText }: { statusText?: string }) => <div>{statusText}</div>,
  DashboardKpiSection: () => <div>KPI</div>,
  DashboardDetailsTabs: ({
    activeKey,
    onChange,
    items,
  }: {
    activeKey: string;
    onChange: (key: string) => void;
    items: Array<{ key: string; label: string }>;
  }) => (
    <div>
      <div>Active: {activeKey}</div>
      {items.map((item) => (
        <button key={item.key} onClick={() => onChange(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  DashboardOverviewTab: () => <div>Overview Tab</div>,
  DashboardErrorsTab: () => <div>Errors Tab</div>,
  DashboardLatencyTab: () => <div>Latency Tab</div>,
  DashboardDeliveriesTab: () => <div>Deliveries Tab</div>,
  DashboardLogsTab: () => <div>Logs Tab</div>,
  DashboardOutboundTab: () => <div>Outbound Tab</div>,
  DashboardInboundTab: () => <div>Inbound Tab</div>,
  DashboardScheduledTab: () => <div>Scheduled Tab</div>,
  GettingStartedCard: () => <div>Get started</div>,
}));

describe('DashboardRoute query gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantState.orgId = 33;

    mockApi.getUIConfig.mockResolvedValue({ dashboard: { autoRefreshSeconds: 0 } });
    mockApi.getUIConfigOverride.mockResolvedValue({});
    // One outbound rule: an org with none at all gets the setup checklist instead of tabs.
    mockApi.getAllIntegrations.mockResolvedValue([{ id: 'out-1', name: 'Outbound Rule', direction: 'OUTBOUND' }]);
    mockApi.getAllScheduledJobs.mockResolvedValue([]);
    mockApi.getDashboardSummary.mockResolvedValue({ integrationHealth: [] });
    mockApi.getAnalyticsOverview.mockResolvedValue({
      summary: { total: 0, successful: 0, failed: 0, skipped: 0, retrying: 0, successRate: 0 },
      performance: { avgResponseTime: 0, p95ResponseTime: 0, totalRequests: 0 },
      eventTypes: {},
      integrationPerformance: [],
    });
    mockApi.getAnalyticsTimeseries.mockResolvedValue({ data: [] });
    mockApi.getAnalyticsErrors.mockResolvedValue({
      summary: { errorCategories: {}, topErrors: [] },
      topErrors: [],
      integrationBreakdown: [],
    });
    mockApi.getAnalyticsPerformance.mockResolvedValue({
      metrics: {},
      distribution: { buckets: [] },
    });
    mockApi.getEventAuditStats.mockResolvedValue({
      totalReceived: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
      stuck: 0,
    });
    mockApi.getLogs.mockResolvedValue({ data: [] });
    mockApi.getScheduledJobLogs.mockResolvedValue([]);
  });

  const renderRoute = async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const { DashboardRoute } = await import('../features/dashboard/DashboardRoute');

    const dashboard = () => (
      <QueryClientProvider client={queryClient}>
        <App>
          <DashboardRoute />
        </App>
      </QueryClientProvider>
    );

    const result = render(dashboard());
    return { ...result, dashboard };
  };

  it('refetches visible dashboard data when the selected organization changes', async () => {
    const { rerender, dashboard } = await renderRoute();

    await waitFor(() => {
      expect(mockApi.getDashboardSummary).toHaveBeenCalledTimes(1);
      expect(mockApi.getAllIntegrations).toHaveBeenCalledTimes(1);
      expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(1);
    });

    tenantState.orgId = 84;
    rerender(dashboard());

    await waitFor(() => {
      expect(mockApi.getDashboardSummary).toHaveBeenCalledTimes(2);
      expect(mockApi.getAllIntegrations).toHaveBeenCalledTimes(2);
      expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(2);
    });
  });

  it('loads only overview data on first render', async () => {
    await renderRoute();

    await waitFor(() => {
      expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(1);
    });

    expect(mockApi.getDashboardSummary).toHaveBeenCalledTimes(1);
    expect(mockApi.getAnalyticsTimeseries).toHaveBeenCalledTimes(2);
    expect(mockApi.getAnalyticsErrors).not.toHaveBeenCalled();
    expect(mockApi.getAnalyticsPerformance).not.toHaveBeenCalled();
    expect(mockApi.getEventAuditStats).not.toHaveBeenCalled();
    expect(mockApi.getLogs).not.toHaveBeenCalled();
    expect(mockApi.getScheduledJobLogs).not.toHaveBeenCalled();
  });

  it('fetches heavy data only when the related tab is opened', async () => {
    await renderRoute();

    await waitFor(() => {
      expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Errors' }));
    await waitFor(() => {
      expect(mockApi.getAnalyticsErrors).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Latency' }));
    await waitFor(() => {
      expect(mockApi.getAnalyticsPerformance).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }));
    await waitFor(() => {
      expect(mockApi.getEventAuditStats).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    await waitFor(() => {
      expect(mockApi.getLogs).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the setup checklist instead of empty charts for an org with no integrations', async () => {
    mockApi.getAllIntegrations.mockResolvedValue([]);
    await renderRoute();

    expect(await screen.findByText('Get started')).toBeInTheDocument();
    expect(screen.queryByText('KPI')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Errors' })).not.toBeInTheDocument();
  });

  it('does not fetch scoped analytics for empty inbound or scheduled tabs', async () => {
    await renderRoute();

    await waitFor(() => {
      expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Inbound' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));

    await waitFor(() => {
      expect(screen.getByText('Active: scheduled')).toBeInTheDocument();
    });

    expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(1);
    expect(mockApi.getAnalyticsPerformance).not.toHaveBeenCalled();
    expect(mockApi.getAnalyticsErrors).not.toHaveBeenCalled();
    expect(mockApi.getAnalyticsTimeseries).toHaveBeenCalledTimes(2);
    expect(mockApi.getAllScheduledJobs).toHaveBeenCalledTimes(1);
  });

  it('scopes dashboard analytics to the active tab when integrations exist', async () => {
    mockApi.getAllIntegrations.mockResolvedValue([
      { id: 'out-1', name: 'Outbound Rule', direction: 'OUTBOUND' },
      { id: 'in-1', name: 'Inbound API', direction: 'INBOUND' },
    ]);
    mockApi.getAllScheduledJobs.mockResolvedValue([{ id: 'job-1', name: 'Nightly Sync' }]);

    await renderRoute();

    await waitFor(() => {
      expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Inbound' }));

    await waitFor(() => {
      expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(2);
      expect(mockApi.getAnalyticsPerformance).toHaveBeenCalledTimes(1);
    });

    expect(mockApi.getAnalyticsOverview).toHaveBeenLastCalledWith(
      1,
      'INBOUND',
      undefined,
      undefined,
      expect.objectContaining({
        startDate: expect.any(String),
        endDate: expect.any(String),
      }),
      undefined
    );

    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));

    await waitFor(() => {
      expect(mockApi.getAnalyticsOverview).toHaveBeenCalledTimes(3);
    });

    expect(mockApi.getAnalyticsOverview).toHaveBeenLastCalledWith(
      1,
      undefined,
      'SCHEDULED',
      undefined,
      expect.objectContaining({
        startDate: expect.any(String),
        endDate: expect.any(String),
      }),
      undefined
    );
  });

  it('counts each integration once even though the outbound list returns every direction', async () => {
    // The outbound endpoint also returns inbound and scheduled configs, so the
    // same ids arrive from more than one list.
    mockApi.getAllIntegrations.mockResolvedValue([
      { id: 'in-1', name: 'Lookup', direction: 'INBOUND' },
      { id: 'out-1', name: 'Orders', direction: 'OUTBOUND' },
      { id: 'in-1', name: 'Lookup', direction: 'INBOUND' },
      { id: 'job-1', name: 'Sync', direction: 'SCHEDULED' },
    ]);
    mockApi.getAllScheduledJobs.mockResolvedValue([{ _id: 'job-1', name: 'Sync' }]);

    await renderRoute();

    expect(await screen.findByText(/^3 integrations ·/)).toBeInTheDocument();
  });
});
