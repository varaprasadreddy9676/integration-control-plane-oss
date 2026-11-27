import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';

vi.mock('../components/common/ModernTable', () => ({
  ModernTable: ({ dataSource, columns }: any) => (
    <div className="modern-table-wrapper">
      {dataSource.map((record: any) => (
        <div key={record.id}>
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
  LineChart: () => <div>Request volume chart</div>,
  BarChart: () => <div>Latency chart</div>,
  ComposedChart: () => <div>Reliability chart</div>,
  HeatmapChart: () => <div>Peak hours chart</div>,
}));

import { DashboardInboundTab } from '../features/dashboard/components/DashboardInboundTab';

const props = () => ({
  days: 30,
  timeLabel: 'Last 30 days',
  analyticsLoading: false,
  analytics: {
    summary: { total: 120, successful: 116, failed: 3, skipped: 1 },
    performance: { avgResponseTime: 84 },
  },
  timeseriesHourly: { data: [] },
  performanceAnalytics: { metrics: { p95ResponseTime: 160, p99ResponseTime: 240 } },
  integrationPerformance: [
    {
      id: 'endpoint-1',
      integrationConfigId: 'endpoint-1',
      integrationName: 'Partner Intake',
      total: 120,
      successRate: '96.7',
      avgResponseTime: 84,
      p95: 160,
      p99: 240,
    },
  ],
  onNavigate: vi.fn(),
  getIntegrationPath: () => '/inbound-integrations/endpoint-1',
  noDataHint: 'No inbound data for this period',
  hiddenLegends: new Set<string>(),
  onLegendClick: vi.fn(),
});

describe('dashboard inbound typography', () => {
  it('uses Astryx table text and keeps endpoint navigation and response metrics', () => {
    const values = props();
    const { container } = render(
      <ThemeProvider>
        <DashboardInboundTab {...values} />
      </ThemeProvider>
    );

    const table = container.querySelector('.modern-table-wrapper');
    expect(table).toBeInTheDocument();
    expect(table?.querySelector('.ant-typography')).not.toBeInTheDocument();
    expect(within(table as HTMLElement).getByText('96.7%')).toBeInTheDocument();
    expect(within(table as HTMLElement).getByText('84 ms')).toBeInTheDocument();
    expect(within(table as HTMLElement).getByText('160 ms')).toBeInTheDocument();
    expect(within(table as HTMLElement).getByText('240 ms')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Partner Intake' }));
    expect(values.onNavigate).toHaveBeenCalledWith('/inbound-integrations/endpoint-1');
  });
});
