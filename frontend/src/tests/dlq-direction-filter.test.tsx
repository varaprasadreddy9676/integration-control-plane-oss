import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { ThemeProvider } from '../app/theme-provider';

// Regression test: the DLQ screen's Direction filter only offered "Outbound" and "Scheduled",
// silently hiding every inbound-direction DLQ entry from ever being viewed or managed, even
// though the stats banner (unfiltered by direction) counted them. Confirmed live via direct
// API querying that direction=INBOUND held 61 real entries with no UI path to reach them.

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({ orgId: 33 }),
}));

const mockApi = {
  listDLQEntries: vi.fn(),
  getDLQEntry: vi.fn(),
  getDLQStats: vi.fn(),
  retryDLQEntry: vi.fn(),
  abandonDLQEntry: vi.fn(),
  deleteDLQEntry: vi.fn(),
  bulkRetryDLQ: vi.fn(),
  bulkAbandonDLQ: vi.fn(),
  bulkDeleteDLQ: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

const openDirectionSelect = () => {
  const selector = screen.getByText('Outbound').closest('.ant-select-selector') as HTMLElement;
  fireEvent.mouseDown(selector);
};

describe('DLQManagement direction filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listDLQEntries.mockResolvedValue({ data: [], pagination: { total: 0 } });
    mockApi.getDLQStats.mockResolvedValue({ statusBreakdown: { abandoned: 55, resolved: 8 } });
  });

  it('offers an "Inbound" option alongside Outbound and Scheduled', async () => {
    const { DLQManagement } = await import('../features/integrations/components/DLQManagement');

    render(
      <ThemeProvider>
        <App>
          <DLQManagement />
        </App>
      </ThemeProvider>
    );

    await waitFor(() => expect(mockApi.listDLQEntries).toHaveBeenCalled());

    openDirectionSelect();

    expect(await screen.findByTitle('Inbound')).toBeInTheDocument();
  });

  it('queries direction=INBOUND when Inbound is selected', async () => {
    const { DLQManagement } = await import('../features/integrations/components/DLQManagement');

    render(
      <ThemeProvider>
        <App>
          <DLQManagement />
        </App>
      </ThemeProvider>
    );

    await waitFor(() => expect(mockApi.listDLQEntries).toHaveBeenCalled());

    openDirectionSelect();
    const inboundOption = await screen.findByTitle('Inbound');
    await userEvent.click(inboundOption);

    await waitFor(() => {
      const lastCall = mockApi.listDLQEntries.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({ direction: 'INBOUND' });
    });
  });
});
