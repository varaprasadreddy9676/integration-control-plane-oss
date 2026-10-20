import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { ThemeProvider } from '../app/theme-provider';

// Regression test: expanding a SCRIPT_JOB execution log (e.g. the "Tailspin Daily Sync
// Report" Node.js Process job) showed a "cURL" tab rendering the meaningless
// `curl -X POST "" -d '{}'` — script jobs have no real HTTP request to reconstruct
// (generateCurlCommand falls back to empty targetUrl/payload). The actual useful
// content — the script's captured console output (metadata.scriptLogs) — was never
// shown on this list's detail view, even though the separate LogDetailRoute page
// already had this exact rendering. Fixed by adding a "Script Output" tab and
// suppressing the broken cURL tab for direction === 'SCRIPT_JOB'.

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
    ModernTable: (props: any) => <antd.Table {...props} pagination={false} />,
  };
});

const scriptJobLog = {
  id: 'log-tailspin-1',
  direction: 'SCRIPT_JOB',
  httpMethod: 'SCRIPT_JOB',
  status: 'FAILED',
  integrationName: 'Tailspin Daily Sync Report',
  createdAt: new Date().toISOString(),
  requestPayload: {},
  errorMessage: 'Script exited with code 1',
  metadata: {},
  steps: [
    {
      name: 'script_execution',
      status: 'failed',
      metadata: {
        scriptLogs: [
          { level: 'error', message: 'Error: connect ETIMEDOUT', ts: new Date().toISOString() },
          { level: 'error', message: 'at main (/node-script-jobs/job/script.js:28:34)', ts: new Date().toISOString() },
        ],
      },
    },
  ],
};

const mockApi = {
  getUIConfig: vi.fn(),
  getUIConfigOverride: vi.fn(),
  getLogs: vi.fn(),
  getLogStatsSummary: vi.fn(),
  getIntegrations: vi.fn(),
  getEventTypes: vi.fn(),
  getLogById: vi.fn(),
  retryLog: vi.fn(),
  forceRetryLog: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

describe('Delivery Logs list — SCRIPT_JOB detail shows script output, not a broken cURL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.getUIConfigOverride.mockResolvedValue({});
    mockApi.getLogs.mockResolvedValue({
      data: [scriptJobLog],
      pagination: { total: 1, page: 1, limit: 15, totalPages: 1 },
    });
    mockApi.getLogStatsSummary.mockResolvedValue({ total: 1, success: 1, failed: 0, skipped: 0, pending: 0 });
    mockApi.getIntegrations.mockResolvedValue([]);
    mockApi.getEventTypes.mockResolvedValue([]);
    mockApi.getLogById.mockResolvedValue(scriptJobLog);
  });

  const renderRoute = async () => {
    const { LogsRoute } = await import('../features/logs/routes/LogsRoute');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <App>
            <MemoryRouter>
              <LogsRoute />
            </MemoryRouter>
          </App>
        </QueryClientProvider>
      </ThemeProvider>
    );
  };

  it('shows the Script Output tab with real console output and no broken cURL tab', async () => {
    await renderRoute();

    await screen.findByText('Tailspin Daily Sync Report');

    // Detail moved from an inline expanded row into the delivery drawer, which
    // opens on row click. Same renderer, so what this test asserts is unchanged.
    const row = document.querySelector('.ant-table-row') as HTMLElement;
    expect(row).toBeTruthy();
    fireEvent.click(row);

    await waitFor(() => expect(mockApi.getLogById).toHaveBeenCalledWith('log-tailspin-1'));

    expect(await screen.findByText('Script Output')).toBeInTheDocument();
    expect(await screen.findByText(/Error: connect ETIMEDOUT/)).toBeInTheDocument();
    expect(screen.getByText(/script.js:28:34/)).toBeInTheDocument();

    expect(screen.queryByText('cURL')).not.toBeInTheDocument();
    expect(screen.queryByText(/curl -X POST/)).not.toBeInTheDocument();
    expect(screen.getByText('Script job')).toBeInTheDocument();
    expect(screen.queryByText(/^Retry$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Force$/)).not.toBeInTheDocument();
  });
});
