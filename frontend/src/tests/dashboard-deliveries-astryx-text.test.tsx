import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';

vi.mock('../components/common/ModernTable', () => ({
  ModernTable: ({ dataSource, columns }: any) => (
    <div>
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
  BarChart: () => <div>Performance chart</div>,
  FunnelChart: () => <div>Event funnel</div>,
}));

import { DashboardDeliveriesTab } from '../features/dashboard/components/DashboardDeliveriesTab';

const baseProps = () => ({
  analyticsLoading: false,
  integrationPerformance: [
    {
      id: 'integration-1',
      __KEEP___KEEP_integrationConfig__Id__: 'integration-1',
      __KEEP_integrationName__: 'Orders API',
      total: 120,
      successful: 116,
      failed: 3,
      skipped: 1,
      successRate: 96.7,
      avgResponseTime: 84,
    },
  ],
  performanceTitle: 'Delivery performance',
  performanceSubtitle: 'Across active integrations',
  performanceEntityLabel: 'Integration',
  manageLabel: 'Manage integrations',
  onManageAll: vi.fn(),
  onCreateNew: vi.fn(),
  onViewEventAudit: vi.fn(),
  onNavigate: vi.fn(),
  getIntegrationPath: () => '/integrations/integration-1',
  noDataHint: 'No delivery data for this period',
  timeLabel: 'Last 30 days',
  performanceChartData: [],
  performanceChartMetric: 'percent' as const,
  setPerformanceChartMetric: vi.fn(),
  performanceChartLayout: 'horizontal' as const,
  setPerformanceChartLayout: vi.fn(),
  showEventAudit: true,
  eventAuditLoading: false,
  eventAuditStats: {
    totalReceived: 10,
    delivered: 7,
    skipped: 2,
    failed: 1,
    skipReasons: { DUPLICATE: 2 },
    duplicateTypes: {},
    bySource: { 'scheduler-worker': 10 },
  },
  funnelData: [],
  errorBreakdown: [],
  hiddenLegends: new Set<string>(),
  onLegendClick: vi.fn(),
});

const renderTab = (props: ReturnType<typeof baseProps>) =>
  render(
    <ThemeProvider>
      <DashboardDeliveriesTab {...props} />
    </ThemeProvider>
  );

describe('dashboard deliveries typography', () => {
  it('uses Astryx text while preserving integration navigation and audit details', () => {
    const props = baseProps();
    const { container } = renderTab(props);

    expect(screen.getByRole('heading', { name: 'Delivery performance' })).toBeInTheDocument();
    expect(screen.getByText('96.7%')).toBeInTheDocument();
    expect(screen.getAllByText('scheduler-worker')).toHaveLength(2);
    expect(container.querySelector('.ant-typography')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Orders API' })[0]);
    expect(props.onNavigate).toHaveBeenCalledWith('/integrations/integration-1');

    fireEvent.click(screen.getByRole('button', { name: 'View Event Audit' }));
    expect(props.onViewEventAudit).toHaveBeenCalledOnce();
  });

  it('keeps the empty-period recovery action available without AntD typography', () => {
    const props = { ...baseProps(), integrationPerformance: [] };
    const { container } = renderTab(props);

    expect(screen.getByText('No activity in the selected period')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Integration' }));
    expect(props.onCreateNew).toHaveBeenCalledOnce();
    expect(container.querySelector('.ant-typography')).not.toBeInTheDocument();
  });
});
