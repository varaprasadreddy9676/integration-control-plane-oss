import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const mockApi = vi.hoisted(() => ({
  getAdminAuditActionTypes: vi.fn(),
  getAdminAuditLogs: vi.fn(),
  getAdminAuditResourceTypes: vi.fn(),
  getAdminAuditStats: vi.fn(),
  exportAuditLogs: vi.fn(),
}));

vi.mock('../services/api', () => mockApi);

async function renderRoute() {
  const { AuditLogsRoute } = await import('../features/admin/AuditLogsRoute');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin/audit']}>
          <AuditLogsRoute />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe('Admin audit workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getAdminAuditActionTypes.mockResolvedValue(['integration_update', 'user_login']);
    mockApi.getAdminAuditResourceTypes.mockResolvedValue(['integration', 'user']);
    mockApi.getAdminAuditLogs.mockResolvedValue({
      logs: [],
      pagination: { page: 1, total: 0, totalPages: 0 },
    });
    mockApi.getAdminAuditStats.mockResolvedValue({
      totalLogs: 0,
      failedActions: 0,
      successRate: '100',
      actionsByType: [],
      topUsers: [],
    });
    mockApi.exportAuditLogs.mockResolvedValue(undefined);
  });

  it('offers server-defined action and resource filters', async () => {
    await renderRoute();

    expect(await screen.findByText('Audit events')).toBeInTheDocument();
    expect(screen.getByTestId('page-template')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export CSV/ }).closest('.ant-space')).toHaveStyle({
      flexWrap: 'wrap',
    });
    expect(screen.getByRole('combobox', { name: 'Action' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Resource' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Action' }));
    expect(await screen.findByText('integration update')).toBeInTheDocument();
  });

  it('applies the selected action to server pagination and exposes clear filters', async () => {
    await renderRoute();
    await waitFor(() => expect(mockApi.getAdminAuditLogs).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Action' }));
    fireEvent.click(await screen.findByText('integration update'));

    await waitFor(() => {
      const latest = mockApi.getAdminAuditLogs.mock.calls.at(-1)?.[0];
      expect(latest.action).toBe('integration_update');
      expect(latest.page).toBe(1);
    });
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('debounces search requests and exports the current search text', async () => {
    await renderRoute();
    await waitFor(() => expect(mockApi.getAdminAuditLogs).toHaveBeenCalled());
    mockApi.getAdminAuditLogs.mockClear();

    fireEvent.change(screen.getByPlaceholderText('Search user, action, resource...'), {
      target: { value: 'operator@example.com' },
    });

    await waitFor(() => {
      const latest = mockApi.getAdminAuditLogs.mock.calls.at(-1)?.[0];
      expect(latest.search).toBe('operator@example.com');
    });

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() =>
      expect(mockApi.exportAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'csv', search: 'operator@example.com' }),
        expect.anything()
      )
    );
  });
});
