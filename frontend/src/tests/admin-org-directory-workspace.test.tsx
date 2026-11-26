import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const api = vi.hoisted(() => ({ listAdminOrgSummaries: vi.fn() }));

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  listAdminOrgSummaries: api.listAdminOrgSummaries,
}));
vi.mock('../app/auth-context', () => ({ useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }) }));

async function renderRoute() {
  const { OrgDirectoryRoute } = await import('../features/admin/OrgDirectoryRoute');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <OrgDirectoryRoute />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe('Admin organization directory workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listAdminOrgSummaries.mockResolvedValue([
      {
        orgId: 33,
        name: 'Medics Prime',
        code: 'MED',
        email: 'ops@medics.example',
        phone: '+91 98765 43210',
        region: 'ap-south',
        tags: ['production'],
      },
      {
        orgId: 145,
        name: 'North Clinic',
        code: 'NORTH',
        email: 'admin@north.example',
        region: 'ap-north',
        tags: ['validation'],
      },
    ]);
  });

  it('searches organization data and reports the filtered total', async () => {
    await renderRoute();
    expect(screen.getByTestId('page-template')).toBeInTheDocument();
    expect(await screen.findByText('Medics Prime')).toBeInTheDocument();
    expect(screen.getByText('North Clinic')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search organizations' }), { target: { value: 'ap-north' } });

    expect(screen.queryByText('Medics Prime')).not.toBeInTheDocument();
    expect(screen.getByText('North Clinic')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
  });
});
