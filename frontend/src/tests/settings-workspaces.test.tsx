import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const api = vi.hoisted(() => ({
  listProviders: vi.fn(),
  listSenderProfiles: vi.fn(),
  createSenderProfile: vi.fn(),
  updateSenderProfile: vi.fn(),
  deleteSenderProfile: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  purgeApiKey: vi.fn(),
  downloadMcpServer: vi.fn(),
  getApiBaseUrl: vi.fn(),
  listAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  resetAdminUserPassword: vi.fn(),
  setAdminUserActive: vi.fn(),
  updateAdminUser: vi.fn(),
}));

vi.mock('../services/api', () => api);
vi.mock('../app/tenant-context', () => ({ useTenant: () => ({ orgId: 33 }) }));
vi.mock('../app/auth-context', () => ({ useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }) }));

const providers = [
  { id: 'p1', name: 'Nova Health', description: 'Scheduling provider', isActive: true },
  { id: 'p2', name: 'Pathkind', description: 'Diagnostics', isActive: false },
];

const apiKeys = [
  {
    id: 'k1',
    name: 'Production sync',
    prefix: 'icp_live_abc',
    role: 'SUPER_ADMIN',
    orgId: 33,
    createdBy: 'admin@example.com',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
  },
  {
    id: 'k2',
    name: 'Old staging key',
    prefix: 'icp_test_def',
    role: 'API_KEY',
    orgId: 33,
    createdBy: 'admin@example.com',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: '2026-10-02T00:00:00.000Z',
  },
];

async function renderRoute(route: 'providers' | 'sender-profiles' | 'keys' | 'users') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Component =
    route === 'providers'
      ? (await import('../features/settings/ProvidersRoute')).ProvidersRoute
      : route === 'sender-profiles'
        ? (await import('../features/settings/SenderProfilesRoute')).SenderProfilesRoute
        : route === 'keys'
        ? (await import('../features/settings/ApiKeysRoute')).ApiKeysRoute
        : (await import('../features/settings/UserManagementRoute')).UserManagementRoute;
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Component />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe('settings workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listProviders.mockResolvedValue(providers);
    api.listSenderProfiles.mockResolvedValue([{
      id: 'sender-1',
      key: 'billing',
      name: 'Billing sender',
      fromEmail: 'billing@example.test',
      aliases: ['invoices@example.test'],
      provider: 'SMTP',
      providerConfig: {},
      isDefault: true,
      isActive: false,
    }]);
    api.listApiKeys.mockResolvedValue(apiKeys);
    api.listAdminUsers.mockResolvedValue({ users: [], total: 0 });
    api.getApiBaseUrl.mockReturnValue('https://example.test');
  });

  it('filters providers by name or description and keeps the full collection available', async () => {
    await renderRoute('providers');
    expect(await screen.findByText('Nova Health')).toBeInTheDocument();
    expect(screen.getByText('Pathkind')).toBeInTheDocument();
    expect(document.querySelector('.ant-typography')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search providers' }), { target: { value: 'diagnostics' } });

    expect(screen.queryByText('Nova Health')).not.toBeInTheDocument();
    expect(screen.getByText('Pathkind')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
  });

  it('shows a deliberate empty state instead of an empty provider table shell', async () => {
    api.listProviders.mockResolvedValueOnce([]);
    await renderRoute('providers');

    expect(await screen.findByText('No providers yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add your first provider/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('renders sender aliases as plain text and uses shared status/category badges', async () => {
    const { container } = await renderRoute('sender-profiles');

    expect(await screen.findByText('Billing sender')).toBeInTheDocument();
    expect(screen.getByText('invoices@example.test')).toBeInTheDocument();
    expect(screen.getByText('SMTP')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')).toBeNull();
    expect(container.querySelector('.ant-typography')).toBeNull();
  });

  it('gives the organization ID filter the full grid width without number steppers', async () => {
    await renderRoute('users');

    const organizationId = screen.getByRole('spinbutton', { name: 'Filter by organization ID' });
    expect(organizationId.closest('.ant-input-number')).toHaveClass('console-width-full');
    expect(organizationId.closest('.ant-input-number')?.querySelector('.ant-input-number-handler-wrap')).toBeNull();
  });

  it('filters API keys by name/prefix and exposes retry when loading fails', async () => {
    await renderRoute('keys');
    expect(await screen.findByText('Production sync')).toBeInTheDocument();
    expect(screen.getByText('Old staging key')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search API keys' }), { target: { value: 'abc' } });

    expect(screen.getByText('Production sync')).toBeInTheDocument();
    expect(screen.queryByText('Old staging key')).not.toBeInTheDocument();

    api.listApiKeys.mockRejectedValueOnce(new Error('temporary outage'));
    const refresh = screen.getByRole('button', { name: /Refresh/ });
    fireEvent.click(refresh);
    expect(await screen.findByText('Could not load API keys')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await waitFor(() => expect(api.listApiKeys).toHaveBeenCalledTimes(2));
  });

  it('debounces user search before querying the server', async () => {
    await renderRoute('users');
    await waitFor(() => expect(api.listAdminUsers).toHaveBeenCalled());
    api.listAdminUsers.mockClear();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search users' }), { target: { value: 'admin@example.com' } });

    await waitFor(() => {
      expect(api.listAdminUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'admin@example.com', page: 1 })
      );
    });
  });
});
