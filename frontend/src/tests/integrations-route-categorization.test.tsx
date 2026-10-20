import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { ThemeProvider } from '../app/theme-provider';

// Regression test: the Outbound Integrations tab filtered with `direction !== 'INBOUND'`,
// which let SCHEDULED/SCRIPT_JOB records (e.g. "Tailspin Daily Sync Report") leak into a tab meant
// only for real-time event-triggered deliveries — duplicating them with the dedicated
// Scheduled Jobs tab, inflating the "total" count, and rendering broken empty Event/Method
// tags for a record type that has neither. Fixed to filter with `direction === 'OUTBOUND'`.
// Also covers the related crash-risk fix: `item.eventType.toLowerCase()` (no optional
// chaining) in the search-query filter would throw for any outbound record with no eventType
// the moment a user typed into the search box — fixed to `item.eventType?.toLowerCase()`.

vi.mock('../utils/navigation', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

vi.mock('../app/auth-context', () => ({
  useAuth: () => ({ user: { role: 'ORG_ADMIN' } }),
}));

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../components/common/ModernTable', async () => {
  const antd = await import('antd');
  return {
    ModernTable: (props: any) => <antd.Table {...props} pagination={false} />,
  };
});

const mockApi = {
  getIntegrations: vi.fn(),
  deleteIntegration: vi.fn(),
  toggleIntegration: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

describe('Outbound Integrations tab — categorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getIntegrations.mockResolvedValue([
      {
        id: 'out-1',
        name: 'CleverTap - Advance Created',
        direction: 'OUTBOUND',
        eventType: 'ADVANCE_CREATED',
        httpMethod: 'POST',
        isActive: true,
        provider: 'CleverTap',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sched-1',
        name: 'Tailspin Daily Sync Report',
        direction: 'SCHEDULED',
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'out-2',
        name: 'Legacy Webhook (no eventType)',
        direction: 'OUTBOUND',
        // Deliberately no eventType — this is what crashed the old
        // `item.eventType.toLowerCase()` search-filter code without optional chaining,
        // the moment a user typed anything into the search box.
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  const renderRoute = async () => {
    const { IntegrationsRoute } = await import('../features/integrations/routes/IntegrationsRoute');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <App>
            <MemoryRouter>
              <IntegrationsRoute />
            </MemoryRouter>
          </App>
        </QueryClientProvider>
      </ThemeProvider>
    );
  };

  it('does not crash when searching while an outbound record has no eventType', async () => {
    await renderRoute();
    await screen.findByText('CleverTap - Advance Created');

    const searchInput = screen.getByPlaceholderText('Search...');
    expect(() => fireEvent.change(searchInput, { target: { value: 'legacy' } })).not.toThrow();

    expect(await screen.findByText('Legacy Webhook (no eventType)')).toBeInTheDocument();
    expect(screen.queryByText('CleverTap - Advance Created')).not.toBeInTheDocument();
  });

  it('excludes SCHEDULED/SCRIPT_JOB records from the outbound table', async () => {
    await renderRoute();

    expect(await screen.findByText('CleverTap - Advance Created')).toBeInTheDocument();
    expect(screen.queryByText('Tailspin Daily Sync Report')).not.toBeInTheDocument();
  });

  it('counts only real outbound records in the "total" chip, not scheduled jobs', async () => {
    await renderRoute();

    await screen.findByText('CleverTap - Advance Created');
    // 2 OUTBOUND fixtures + 1 SCHEDULED fixture that must not be counted.
    expect(screen.getByText('2 total')).toBeInTheDocument();
    expect(screen.queryByText('3 total')).not.toBeInTheDocument();
  });
});
