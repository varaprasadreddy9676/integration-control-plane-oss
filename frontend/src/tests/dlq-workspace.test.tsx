import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../app/theme-provider';

const mockApi = vi.hoisted(() => ({
  listDLQEntries: vi.fn(),
  getDLQEntry: vi.fn(),
  getDLQStats: vi.fn(),
  retryDLQEntry: vi.fn(),
  abandonDLQEntry: vi.fn(),
  deleteDLQEntry: vi.fn(),
  bulkRetryDLQ: vi.fn(),
  bulkAbandonDLQ: vi.fn(),
  bulkDeleteDLQ: vi.fn(),
}));

vi.mock('../services/api', () => mockApi);

describe('Dead letter queue workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listDLQEntries.mockResolvedValue({
      data: [],
      pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
    });
    mockApi.getDLQStats.mockResolvedValue({
      statusBreakdown: { pending: 0, retrying: 0, resolved: 0, abandoned: 0 },
    });
  });

  const renderManagement = async () => {
    const { DLQManagement } = await import('../features/integrations/components/DLQManagement');
    return render(
      <ThemeProvider>
        <DLQManagement />
      </ThemeProvider>
    );
  };

  it('exposes and applies the server-side error-category filter', async () => {
    const user = userEvent.setup();
    await renderManagement();
    await waitFor(() => expect(mockApi.listDLQEntries).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: 'Error category' }));
    await user.click(await screen.findByTitle('TIMEOUT'));

    await waitFor(() => {
      expect(mockApi.listDLQEntries.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({
          errorCategory: 'TIMEOUT',
          offset: 0,
        })
      );
    });
    expect(screen.getByText('No entries match these filters')).toBeInTheDocument();
  });

  it('keeps a failed load visible and offers an inline retry', async () => {
    mockApi.listDLQEntries.mockRejectedValueOnce(new Error('Service unavailable'));
    await renderManagement();

    expect(await screen.findByText('Entries are temporarily unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('keeps row actions reachable in a compact menu and confirms deletion', async () => {
    const user = userEvent.setup();
    const timestamp = new Date().toISOString();
    mockApi.listDLQEntries.mockResolvedValue({
      data: [
        {
          dlqId: 'review-dlq-1',
          traceId: 'review-trace-1',
          integrationConfigId: 'integration-1',
          orgId: 33,
          direction: 'OUTBOUND',
          payload: { eventType: 'VISIT_COMPLETED' },
          error: {
            message: 'The remote system is unavailable',
            code: 'REMOTE_503',
            category: 'REMOTE_5XX',
            statusCode: 503,
          },
          status: 'pending',
          retryCount: 2,
          maxRetries: 5,
          retryStrategy: 'exponential',
          failedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
    });
    mockApi.deleteDLQEntry.mockResolvedValue({ success: true });
    const { container } = await renderManagement();

    await user.click(await screen.findByRole('button', { name: 'More actions for review-dlq-1' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-tag, .ant-alert')).toHaveLength(0);

    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText('Delete this entry?', { exact: true })).toBeInTheDocument();
    const confirmButton = document.querySelector('.ant-modal-footer .ant-btn-dangerous');
    expect(confirmButton).not.toBeNull();
    fireEvent.click(confirmButton as HTMLButtonElement);

    await waitFor(() => expect(mockApi.deleteDLQEntry).toHaveBeenCalledWith('review-dlq-1'));
  });
});
