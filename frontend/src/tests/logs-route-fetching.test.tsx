import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from 'antd';

const mockApi = {
  getLogs: vi.fn(),
  getIntegrations: vi.fn(),
  getLogStatsSummary: vi.fn(),
  exportLogsToCsv: vi.fn(),
  exportLogsToJson: vi.fn(),
  exportSelectedLogs: vi.fn(),
  getLogById: vi.fn(),
  retryLog: vi.fn(),
  bulkRetryLogs: vi.fn(),
  bulkDeleteLogs: vi.fn(),
  getEventTypes: vi.fn(),
  getUIConfig: vi.fn(),
  getUIConfigOverride: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../components/common/ModernTable', () => ({
  ModernTable: () => <div>ModernTable</div>,
}));

vi.mock('../components/common/StatusBadge', () => ({
  StatusBadge: () => <div>StatusBadge</div>,
}));

vi.mock('../components/common/MetaTag', () => ({
  MetaTag: () => <div>MetaTag</div>,
}));

vi.mock('../utils/export-progress', () => ({
  createExportProgress: () => ({
    onProgress: vi.fn(),
    finish: vi.fn(),
  }),
}));

vi.mock('../utils/curl', () => ({
  generateCurlCommand: () => 'curl',
}));

vi.mock('../hooks/usePaginatedTable', () => ({
  usePaginatedTable: () => ({
    currentPage: 1,
    pageSize: 15,
    getPaginationConfig: () => ({}),
  }),
}));

vi.mock('../app/auth-context', () => ({
  useAuth: () => ({
    user: { role: 'ADMIN' },
  }),
}));

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({
    orgId: 847,
    tenant: { orgId: 847, name: 'Test Org' },
    isLoading: false,
    error: null,
    setManualOrgId: vi.fn(),
    clearOrgId: vi.fn(),
  }),
}));

vi.mock('../design-system/utils', async () => ({
  withAlpha: (color: string) => color,
  spacingToNumber: (value: string | number) => {
    if (typeof value === 'number') return value;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
  cssVar: (await import('../design-system/utils/cssVar')).cssVar,
  useDesignTokens: () => ({
    colors: {
      info: { 100: '#e0f2fe', 400: '#38bdf8', 700: '#0369a1' },
      primary: { 100: '#dbeafe', 500: '#3b82f6', 700: '#1d4ed8' },
      success: { 100: '#dcfce7', 500: '#22c55e', 700: '#15803d' },
      error: { 500: '#ef4444', 600: '#dc2626' },
      warning: { 600: '#ca8a04' },
    },
    spacing: {
      '0.5': '2px',
      1: '4px',
      2: '8px',
      3: '12px',
      4: '16px',
    },
    token: {
      fontSizeSM: 12,
      colorTextBase: '#111',
      colorBorderSecondary: '#e5e7eb',
      colorBgContainer: '#fff',
      borderRadiusLG: 12,
    },
    borderRadius: { full: 999 },
    shadows: { xl: 'none' },
  }),
}));

describe('LogsRoute fetching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getLogs.mockResolvedValue({
      data: [],
      pagination: {
        page: 1,
        limit: 15,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });
    mockApi.getIntegrations.mockResolvedValue([]);
    mockApi.getLogStatsSummary.mockResolvedValue({
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      refreshedAt: '2026-04-10T00:00:00.000Z',
    });
    mockApi.getEventTypes.mockResolvedValue([]);
    mockApi.getUIConfig.mockResolvedValue({ dashboard: { autoRefreshSeconds: 0 } });
    mockApi.getUIConfigOverride.mockResolvedValue({});
  });

  it('does not double-fetch logs and stats on initial render', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const { LogsRoute } = await import('../features/logs/routes/LogsRoute');

    render(
      <QueryClientProvider client={queryClient}>
        <App>
          <MemoryRouter initialEntries={['/logs']}>
            <LogsRoute />
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(mockApi.getLogs).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockApi.getLogStatsSummary).toHaveBeenCalledTimes(1);
    });
  });

  it('shows and applies a provider filter from the URL', async () => {
    mockApi.getIntegrations.mockResolvedValue([
      {
        id: 'integration-1',
        name: 'Northwind results',
        provider: 'northwind',
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const { LogsRoute } = await import('../features/logs/routes/LogsRoute');

    render(
      <QueryClientProvider client={queryClient}>
        <App>
          <MemoryRouter initialEntries={['/logs?provider=northwind']}>
            <LogsRoute />
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(mockApi.getLogs).toHaveBeenCalledWith(expect.objectContaining({ provider: 'northwind' }));
    });

    expect(screen.getByRole('combobox', { name: 'Provider filter' })).toBeInTheDocument();
    expect(screen.getAllByText('northwind').length).toBeGreaterThan(0);
  });
});
