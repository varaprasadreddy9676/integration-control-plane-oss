import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';

vi.mock('../components/common/ModernTable', () => ({
  ModernTable: ({ dataSource, columns }: any) => (
    <div className="modern-table-wrapper">
      {dataSource.map((record: any, rowIndex: number) => (
        <div key={record.id || record.dataSource || rowIndex}>
          {columns.map((column: any) => (
            <div key={column.key}>
              {column.render ? column.render(record[column.dataIndex], record) : String(record[column.dataIndex] ?? '')}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../components/charts', () => ({
  BarChart: () => <div>Records processed chart</div>,
  ComposedChart: () => <div>Reliability chart</div>,
  LineChart: () => <div>Duration chart</div>,
}));

import { DashboardScheduledTab } from '../features/dashboard/components/DashboardScheduledTab';

const props = () => {
  const now = new Date().toISOString();
  return {
    days: 30,
    timeLabel: 'Last 30 days',
    analyticsLoading: false,
    errorsLoading: false,
    analytics: { summary: { total: 120, successful: 116 }, performance: { avgResponseTime: 84 } },
    timeseriesDaily: { data: [{ timestamp: now, total: 10, successful: 9, failed: 1, avgResponseTime: 90 }] },
    performanceAnalytics: { metrics: { p95ResponseTime: 160 } },
    errorAnalytics: { topErrors: [{ category: 'Remote timeout', count: 2, message: 'Provider timed out' }] },
    integrationPerformance: [
      {
        id: 'job-1',
        integrationConfigId: 'job-1',
        integrationName: 'Daily appointment sync',
        total: 120,
        successful: 116,
        failed: 2,
        successRate: '96.7',
        avgResponseTime: 84,
        lastSuccessful: now,
      },
    ],
    scheduledJobs: [
      {
        id: 'job-1',
        isActive: true,
        nextRunTime: new Date(Date.now() + 60_000).toISOString(),
        name: 'Daily appointment sync',
        schedule: { expression: '0 9 * * *' },
        lastExecution: { startedAt: now, recordsFetched: 52 },
      },
    ],
    scheduledJobLogs: [
      {
        id: 'execution-1',
        startedAt: now,
        integrationConfigId: 'job-1',
        integrationName: 'Daily appointment sync',
        status: 'FAILED',
        attemptCount: 2,
        durationMs: 900,
        recordsFetched: 52,
        errorMessage: 'Provider timeout',
      },
    ],
    onNavigate: vi.fn(),
    getIntegrationPath: () => '/scheduled-jobs/job-1',
    noDataHint: 'No scheduled execution data for this period',
    hiddenLegends: new Set<string>(),
    onLegendClick: vi.fn(),
  };
};

describe('dashboard scheduled typography', () => {
  it('uses Astryx table text and retains job navigation and diagnostic values', () => {
    const values = props();
    const { container } = render(
      <ThemeProvider>
        <DashboardScheduledTab {...values} />
      </ThemeProvider>
    );

    const tables = container.querySelectorAll('.modern-table-wrapper');
    expect(tables.length).toBeGreaterThan(0);
    expect(tables[0].querySelector('.ant-typography')).not.toBeInTheDocument();
    expect(within(tables[0] as HTMLElement).getByText('0 9 * * *')).toBeInTheDocument();
    expect(within(tables[0] as HTMLElement).getByText('96.7%')).toBeInTheDocument();
    expect(screen.getByText('Top Failure Reasons')).toBeInTheDocument();
    expect(screen.getByText('Remote timeout')).toBeInTheDocument();

    fireEvent.click(within(tables[0] as HTMLElement).getByRole('button', { name: 'Daily appointment sync' }));
    expect(values.onNavigate).toHaveBeenCalledWith('/scheduled-jobs/job-1');
  });
});
