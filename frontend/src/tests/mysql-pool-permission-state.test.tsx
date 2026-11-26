import React from 'react';
import { App } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';

const api = vi.hoisted(() => ({
  getAdminMysqlPool: vi.fn(),
  updateAdminMysqlPool: vi.fn(),
  testAdminMysqlPool: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: 'ORG_USER' }));

vi.mock('../services/api', () => api);
vi.mock('../app/auth-context', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));

async function renderRoute() {
  const { MysqlPoolSettingsRoute } = await import('../features/settings/MysqlPoolSettingsRoute');
  render(
    <ThemeProvider>
      <App>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <MysqlPoolSettingsRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </App>
    </ThemeProvider>
  );
}

async function waitForFormReady() {
  await waitFor(() => expect(document.querySelector('.ant-spin-spinning')).not.toBeInTheDocument());
}

describe('MySQL shared pool permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.role = 'ORG_USER';
  });

  it('shows a neutral restricted state without requesting protected settings', async () => {
    await renderRoute();

    expect(await screen.findByRole('heading', { name: 'MySQL Shared Pool' })).toBeInTheDocument();
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(api.getAdminMysqlPool).not.toHaveBeenCalled();
  });

  it('shows a successful connection test in the shared success banner', async () => {
    auth.role = 'SUPER_ADMIN';
    api.getAdminMysqlPool.mockResolvedValue({ isConfigured: false, config: null });
    api.testAdminMysqlPool.mockResolvedValue({ success: true, message: 'Connected to MySQL.' });
    await renderRoute();
    await waitForFormReady();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Host'), 'db.example.com');
    await user.type(screen.getByLabelText('Username'), 'integration');
    await user.type(screen.getByLabelText('Password'), 'not-a-real-secret');
    await user.type(screen.getByLabelText('Database'), 'integration_test');
    await user.click(screen.getByRole('button', { name: /Test Connection/ }));

    expect(await screen.findByText('Connection successful')).toBeInTheDocument();
    expect(screen.getByText('Connected to MySQL.')).toBeInTheDocument();
    expect(document.querySelector('.ant-alert')).not.toBeInTheDocument();
    expect(document.querySelector('.ant-tag')).not.toBeInTheDocument();
  });

  it('shows actionable error details when the connection test fails', async () => {
    auth.role = 'ADMIN';
    api.getAdminMysqlPool.mockResolvedValue({ isConfigured: false, config: null });
    api.testAdminMysqlPool.mockResolvedValue({
      success: false,
      error: 'Access denied for configured user.',
      code: 'ACCESS_DENIED',
      hint: 'Check the database username and grants.',
    });
    await renderRoute();
    await waitForFormReady();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Host'), 'db.example.com');
    await user.type(screen.getByLabelText('Username'), 'integration');
    await user.type(screen.getByLabelText('Password'), 'not-a-real-secret');
    await user.type(screen.getByLabelText('Database'), 'integration_test');
    await user.click(screen.getByRole('button', { name: /Test Connection/ }));

    expect(await screen.findByText('Connection failed')).toBeInTheDocument();
    expect(screen.getByText('ACCESS_DENIED')).toBeInTheDocument();
    expect(screen.getByText('Access denied for configured user.')).toBeInTheDocument();
    expect(screen.getByText('Check the database username and grants.')).toBeInTheDocument();
    expect(document.querySelector('.ant-alert')).not.toBeInTheDocument();
    expect(document.querySelector('.ant-tag')).not.toBeInTheDocument();
    await waitFor(() => expect(api.testAdminMysqlPool).toHaveBeenCalledTimes(1));
  });
});
