import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';

const mockApi = vi.hoisted(() => ({ getLookupStats: vi.fn() }));

vi.mock('../services/api', () => mockApi);
vi.mock('../app/tenant-context', () => ({ useTenant: () => ({ orgId: 33 }) }));

describe('Lookup statistics workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getLookupStats.mockResolvedValue({
      totalMappings: 12,
      activeParent: 5,
      activeEntity: 7,
      typesCount: 2,
      mostUsedTypes: [],
      recentlyUsed: [],
    });
  });

  it('scopes cached analytics to the active organization and shows empty sections clearly', async () => {
    const { LookupStatsRoute } = await import('../features/lookups/routes/LookupStatsRoute');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <ThemeProvider>
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <LookupStatsRoute />
          </QueryClientProvider>
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByText('Lookup statistics')).toBeInTheDocument();
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(await screen.findByText('No type usage to chart')).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryCache().find({ queryKey: ['lookup-stats', 33] })).toBeDefined());
    expect(mockApi.getLookupStats).toHaveBeenCalledTimes(1);
  });

  it('shows a retryable error state when analytics fail', async () => {
    mockApi.getLookupStats.mockRejectedValue(new Error('Analytics unavailable'));
    const { LookupStatsRoute } = await import('../features/lookups/routes/LookupStatsRoute');

    render(
      <ThemeProvider>
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <LookupStatsRoute />
          </QueryClientProvider>
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByText('Lookup statistics could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
