import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { ThemeProvider } from '../app/theme-provider';

// Regression test: handleClearFilters used to reset statusFilter back to the hardcoded
// 'FAILED' default instead of actually clearing it, unlike every other filter in the same
// function (channel/type/search/dateRange all reset to undefined/empty). A user who picked
// e.g. "Sent" and clicked "Clear Filters" — expecting to see everything — got silently
// redirected back to failures-only.

const mockApi = {
  getAlertCenterLogs: vi.fn(),
  getAlertCenterStatsSummary: vi.fn(),
  getAlertCenterStatus: vi.fn(),
  getUIConfig: vi.fn(),
  getTenantInfo: vi.fn(),
  exportAlertCenterLogsToCsv: vi.fn(),
  exportAlertCenterLogsToJson: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

const renderRoute = async () => {
  const { AlertCenterRoute } = await import('../features/alert-center/routes/AlertCenterRoute');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/alert-center']}>
            <AlertCenterRoute />
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

describe('Alert Center Clear Filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getAlertCenterLogs.mockResolvedValue([]);
    mockApi.getAlertCenterStatsSummary.mockResolvedValue({ total: 0, sent: 0, failed: 0, skipped: 0 });
    mockApi.getAlertCenterStatus.mockResolvedValue({});
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.getTenantInfo.mockResolvedValue({});
  });

  it('defaults the status filter to Failed on first load', async () => {
    await renderRoute();

    await waitFor(() => expect(mockApi.getAlertCenterLogs).toHaveBeenCalled());
    const firstCall = mockApi.getAlertCenterLogs.mock.calls[0][0];
    expect(firstCall.status).toBe('FAILED');
  });

  it('clears the status filter entirely instead of re-applying the FAILED default', async () => {
    await renderRoute();

    await waitFor(() => expect(mockApi.getAlertCenterLogs).toHaveBeenCalled());
    mockApi.getAlertCenterLogs.mockClear();

    const clearButton = screen.getByRole('button', { name: /Clear Filters/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      const lastCall = mockApi.getAlertCenterLogs.mock.calls.at(-1)?.[0];
      expect(lastCall).toBeDefined();
      expect(lastCall.status).toBeUndefined();
    });
  });
});
