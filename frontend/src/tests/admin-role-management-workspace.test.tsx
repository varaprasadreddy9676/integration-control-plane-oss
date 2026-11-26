import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const mockApi = vi.hoisted(() => ({
  getRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock('../services/api', () => mockApi);

describe('Admin role management workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getRoles.mockResolvedValue([
      {
        role: 'ORG_ADMIN',
        name: 'Organization Admin',
        description: 'Manage an organization and its integrations',
        scope: 'organization',
        isCustom: false,
        features: {},
      },
      {
        role: 'custom_support',
        name: 'Support Operator',
        description: 'Review delivery operations',
        scope: 'global',
        isCustom: true,
        features: {},
      },
    ]);
  });

  it('filters roles in the compact list and retains the permission matrix', async () => {
    const { RoleManagementRoute } = await import('../features/admin/RoleManagementRoute');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/roles']}>
            <RoleManagementRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(screen.getByTestId('page-template')).toBeInTheDocument();
    expect((await screen.findAllByText('Organization Admin')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Support Operator').length).toBeGreaterThan(0);
    expect(screen.getByText('Permission Matrix')).toBeInTheDocument();
    expect(screen.getAllByText('No access').length).toBeGreaterThan(0);
    expect(screen.queryByText('Full access')).not.toBeInTheDocument();
    expect(document.querySelector('.ant-alert')).not.toBeInTheDocument();
    expect(document.querySelector('.ant-typography')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search roles' }), {
      target: { value: 'support' },
    });

    await waitFor(() => expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument());
    expect(screen.getAllByText('Support Operator').length).toBeGreaterThan(0);
    expect(screen.queryByText('Organization Admin')).not.toBeInTheDocument();
  });

  it('uses the shared empty state and offers role creation when the list is empty', async () => {
    mockApi.getRoles.mockResolvedValueOnce([]);
    const { RoleManagementRoute } = await import('../features/admin/RoleManagementRoute');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin/roles']}>
            <RoleManagementRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(await screen.findByText('No roles found')).toBeInTheDocument();
    const emptyState = document.querySelector('.state-panel') as HTMLElement;
    expect(emptyState).toHaveTextContent('No roles found');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(emptyState).getByRole('button', { name: 'Create Role' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
