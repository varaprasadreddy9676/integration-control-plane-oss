import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const mockApi = vi.hoisted(() => ({
  getUserActivities: vi.fn(),
  getUserActivityStats: vi.fn(),
  getActivityEvents: vi.fn(),
  getActivityCategories: vi.fn(),
}));
vi.mock('../services/api', () => mockApi);

describe('Admin user activity workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getUserActivities.mockResolvedValue({
      activities: [],
      pagination: { total: 0 },
    });
    mockApi.getUserActivityStats.mockResolvedValue({
      totalActivities: 0,
      uniqueUsers: 0,
      eventsByType: [{ event: 'integration.updated', count: 5 }],
      activitiesByCategory: [{ category: 'administration', count: 5 }],
      topPages: [],
      topFeatures: [],
      hourlyActivity: [],
    });
    mockApi.getActivityEvents.mockResolvedValue({ events: ['LOGIN', 'INTEGRATION_UPDATED'] });
    mockApi.getActivityCategories.mockResolvedValue({ categories: ['authentication', 'administration'] });
  });

  it('exposes the user filter and debounces server search and user-ID queries', async () => {
    const { UserActivityRoute } = await import('../features/admin/UserActivityRoute');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/user-activity']}>
            <UserActivityRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(screen.getByTestId('page-template')).toBeInTheDocument();
    expect(await screen.findByText('Activity events')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Filter by user ID' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by event' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search activity' }), {
      target: { value: 'operator@example.com' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by user ID' }), {
      target: { value: 'user-42' },
    });

    await waitFor(() => {
      const latest = mockApi.getUserActivities.mock.calls.at(-1)?.[0];
      expect(latest.search).toBe('operator@example.com');
      expect(latest.userId).toBe('user-42');
      expect(latest.page).toBe(1);
    });
  });
});
