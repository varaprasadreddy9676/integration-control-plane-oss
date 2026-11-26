import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';

vi.mock('../components/common/ModernTable', () => ({
  ModernTable: ({ dataSource, columns }: any) => (
    <div className="modern-table-wrapper">
      {dataSource.map((record: any) => (
        <div key={record.id ?? record.eventType}>
          {columns.map((column: any) => (
            <div key={column.key}>{column.render ? column.render(record[column.dataIndex], record) : String(record[column.dataIndex] ?? '')}</div>
          ))}
        </div>
      ))}
    </div>
  ),
}));
vi.mock('../components/charts', () => ({ BarChart: () => null, PieChart: () => null }));

import { DashboardOutboundTab } from '../features/dashboard/components/DashboardOutboundTab';

describe('dashboard outbound typography', () => {
  it('uses Astryx text while retaining delivery data and integration navigation', () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <ThemeProvider>
        <DashboardOutboundTab
          days={30}
          timeLabel="Last 30 days"
          analyticsLoading={false}
          performanceLoading={false}
          errorsLoading={false}
          analytics={{ eventTypes: { 'visit.created': { total: 12, successful: 11, failed: 1 } } }}
          performanceAnalytics={{ distribution: { buckets: [] } }}
          errorAnalytics={{ summary: { errorCategories: {} }, integrationBreakdown: [] }}
          timeseriesDaily={{ data: [] }}
          integrationPerformance={[{ id: 'int-1', __KEEP___KEEP_integrationConfig__Id__: 'int-1', __KEEP_integrationName__: 'Partner API', total: 12, failed: 1, successRate: '91.7', avgResponseTime: 42 }]}
          onNavigate={onNavigate}
          getIntegrationPath={() => '/integrations/int-1'}
          noDataHint="No data"
          hiddenLegends={new Set()}
          onLegendClick={vi.fn()}
        />
      </ThemeProvider>
    );

    const table = container.querySelector('.modern-table-wrapper');
    expect(table).toBeInTheDocument();
    expect(table?.querySelector('.ant-typography')).not.toBeInTheDocument();
    expect(within(table as HTMLElement).getByText('visit.created')).toBeInTheDocument();
    expect(within(table as HTMLElement).getByText('0 ms')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Partner API' }));
    expect(onNavigate).toHaveBeenCalledWith('/integrations/int-1');
  });
});
