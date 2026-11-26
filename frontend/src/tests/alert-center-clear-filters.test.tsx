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

  it('shows the failed alert row when the failed summary count is nonzero', async () => {
    mockApi.getAlertCenterLogs.mockResolvedValue([
      {
        id: 'alert-failure-1',
        tenantId: 33,
        type: 'DELIVERY_FAILURE_REPORT',
        channel: 'EMAIL',
        status: 'FAILED',
        subject: 'Delivery failures detected',
        recipients: ['integration-ops@example.test'],
        totalFailures: 3,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockApi.getAlertCenterStatsSummary.mockResolvedValue({ total: 8, sent: 7, failed: 1, skipped: 0 });

    await renderRoute();

    expect(await screen.findByText('Delivery failures detected')).toBeInTheDocument();
    expect(screen.getByLabelText('Alert totals')).toHaveTextContent('Failed1');
    expect(screen.queryByText('No data')).not.toBeInTheDocument();
  });

  it('uses the shared delivered status vocabulary and keeps summary metadata out of chips', async () => {
    mockApi.getAlertCenterLogs.mockResolvedValue([
      {
        id: 'alert-sent-1',
        tenantId: 33,
        type: 'DELIVERY_FAILURE_REPORT',
        channel: 'EMAIL',
        status: 'SENT',
        subject: 'Delivery report sent',
        recipients: ['integration-ops@example.test'],
        createdAt: new Date().toISOString(),
      },
    ]);
    mockApi.getAlertCenterStatsSummary.mockResolvedValue({ total: 4, sent: 3, failed: 1, skipped: 0 });

    const { container } = await renderRoute();

    expect(await screen.findByText('Delivery report sent')).toBeInTheDocument();
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
    expect(screen.queryByText('SENT')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Alert totals')).toHaveTextContent('Total alerts4Delivered3Failed1Skipped0');
    expect(container.querySelector('.alert-center-summary .ant-tag')).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    expect(await screen.findByRole('option', { name: 'Delivered' })).toBeInTheDocument();
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
