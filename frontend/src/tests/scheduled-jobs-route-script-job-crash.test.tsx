import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { ThemeProvider } from '../app/theme-provider';

// Regression test: the Scheduled Jobs list's "Data Source" and "Target" columns rendered
// `dataSource.type` and `<Tooltip title={url}>` directly with no null-check. A SCRIPT_JOB
// record (e.g. "Tailspin Daily Sync Report") has neither `dataSource` nor `targetUrl` — this
// crashed the whole list the moment one existed. Fixed to render a "SCRIPT" tag and an
// em-dash for SCRIPT_JOB / missing-value rows instead.

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
  getAllScheduledJobs: vi.fn(),
  deleteScheduledJob: vi.fn(),
  executeScheduledJob: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

describe('Scheduled Jobs list — SCRIPT_JOB rows with no dataSource/targetUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getAllScheduledJobs.mockResolvedValue([
      {
        _id: 'sched-1',
        name: 'Tailspin Daily Sync Report',
        direction: 'SCRIPT_JOB',
        // Deliberately no dataSource or targetUrl — this is exactly what crashed the old
        // `dataSource.type` / `<Tooltip title={url}>` column renders.
        isActive: true,
        schedule: { type: 'CRON', expression: '0 6 * * *', timezone: 'Asia/Kolkata' },
      },
    ]);
  });

  const renderRoute = async () => {
    const { ScheduledJobsRoute } = await import('../features/scheduled-jobs/routes/ScheduledJobsRoute');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <App>
            <MemoryRouter initialEntries={['/scheduled-jobs?orgId=33']}>
              <ScheduledJobsRoute />
            </MemoryRouter>
          </App>
        </QueryClientProvider>
      </ThemeProvider>
    );
  };

  it('does not crash and shows a SCRIPT tag instead of the raw data source type', async () => {
    await renderRoute();

    expect(await screen.findByText('Tailspin Daily Sync Report')).toBeInTheDocument();
    expect(screen.getByText('SCRIPT')).toBeInTheDocument();
  });

  it('shows an em-dash instead of an empty tooltip for the missing target URL', async () => {
    await renderRoute();

    await screen.findByText('Tailspin Daily Sync Report');
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
