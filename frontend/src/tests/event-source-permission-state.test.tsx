import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';

const api = vi.hoisted(() => ({
  getEventSourceConfig: vi.fn(),
  getEventTypes: vi.fn(),
}));

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  ...api,
}));
vi.mock('../app/tenant-context', () => ({ useTenant: () => ({ orgId: 33 }) }));
vi.mock('../app/auth-context', () => ({ useAuth: () => ({ user: { role: 'ORG_USER' } }) }));

describe('Event Source permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explains missing read access and does not request protected configuration', async () => {
    const { EventSourceSettingsRoute } = await import('../features/settings/EventSourceSettingsRoute');
    render(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/settings/event-source?orgId=33']}>
            <EventSourceSettingsRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Event Source' })).toBeInTheDocument();
    expect(screen.getByText(/Your role does not have permission to view event source settings/)).toBeInTheDocument();
    expect(api.getEventSourceConfig).not.toHaveBeenCalled();
    expect(api.getEventTypes).not.toHaveBeenCalled();
  });
});
