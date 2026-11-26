import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const mockApi = vi.hoisted(() => ({ getAdminStorageStats: vi.fn() }));
vi.mock('../services/api', () => mockApi);
vi.mock('../components/charts/BarChart', () => ({ BarChart: () => <div data-testid="storage-bar-chart" /> }));
vi.mock('../components/charts/PieChart', () => ({ PieChart: () => <div data-testid="storage-pie-chart" /> }));
vi.mock('../app/auth-context', () => ({
  useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }),
}));

describe('Admin storage workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getAdminStorageStats.mockResolvedValue({
      db: { dataSize: 1024, storageSize: 512, indexSize: 128, objects: 12, collections: 2, avgObjSize: 85 },
      collections: [{
        name: 'deliveryLogs',
        label: 'Delivery Logs',
        count: 12,
        dataSize: 1024,
        storageSize: 512,
        indexSize: 128,
        avgObjSize: 85,
        percentOfTotal: 65,
      }],
      isOrgView: false,
      generatedAt: '2026-11-22T00:00:00.000Z',
    });
  });

  it('shows compact platform metrics and an accessible refresh toggle', async () => {
    const { StorageStatsRoute } = await import('../features/admin/StorageStatsRoute');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/storage']}>
            <StorageStatsRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(screen.getByTestId('page-template')).toBeInTheDocument();
    expect(await screen.findByText('Total storage')).toBeInTheDocument();
    expect(screen.getByText('Documents stored')).toBeInTheDocument();
    expect(screen.getByText('Index size')).toBeInTheDocument();
    expect(screen.getByText('Compression ratio')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable automatic refresh' })).toBeInTheDocument();
    expect(screen.getByText('Collections')).toBeInTheDocument();
    expect(document.querySelector('.ant-typography')).toBeNull();
  });

  it('uses plain text for collection metadata and compact scope guidance', async () => {
    mockApi.getAdminStorageStats.mockResolvedValueOnce({
      db: { dataSize: 1024, storageSize: 512, indexSize: 128, objects: 12, collections: 1, avgObjSize: 85 },
      collections: [{
        name: 'deliveryLogs',
        label: 'Delivery Logs',
        count: 12,
        dataSize: 1024,
        storageSize: 512,
        indexSize: 128,
        avgObjSize: 85,
        percentOfTotal: 65,
      }],
      isOrgView: true,
      generatedAt: '2026-11-22T00:00:00.000Z',
    });
    const { StorageStatsRoute } = await import('../features/admin/StorageStatsRoute');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/storage']}>
            <StorageStatsRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(await screen.findByText('Dominant')).toBeInTheDocument();
    expect(screen.getByText(/Organization scope: document counts are specific/)).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')).toBeNull();
    expect(container.querySelector('.ant-alert')).toBeNull();
  });

  it('shows one retryable state when the initial storage request fails', async () => {
    mockApi.getAdminStorageStats.mockRejectedValueOnce(new Error('Storage service unavailable'));
    const { StorageStatsRoute } = await import('../features/admin/StorageStatsRoute');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/storage']}>
            <StorageStatsRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(await screen.findByText('Unable to load storage statistics')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Total storage')).not.toBeInTheDocument();
  });
});
