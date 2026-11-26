import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';

const auth = vi.hoisted(() => ({ role: 'ORG_USER' }));

vi.mock('../app/auth-context', () => ({ useAuth: () => ({ user: { role: auth.role } }) }));

describe('Admin Audit Logs permission state', () => {
  beforeEach(() => {
    auth.role = 'ORG_USER';
  });

  it('uses a neutral StatePanel for accounts without admin access', async () => {
    const { AdminAuditLogsRoute } = await import('../features/settings/AdminAuditLogsRoute');
    render(
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <AdminAuditLogsRoute />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(screen.getByText('Admin access required')).toBeInTheDocument();
    expect(screen.getByText('You need an admin account to view audit logs.')).toBeInTheDocument();
    expect(document.querySelector('.state-panel')).toBeInTheDocument();
    expect(document.querySelector('.astryx-banner, .ant-alert')).not.toBeInTheDocument();
  });
});
