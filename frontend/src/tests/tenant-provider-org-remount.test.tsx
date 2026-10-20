import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { TenantProvider, useTenant } from '../app/tenant-context';

vi.mock('../app/auth-context', () => ({
  useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }),
}));

vi.mock('../services/api', () => ({
  getTenantInfo: vi.fn(async () => ({ name: 'Test organization' })),
  setCurrentOrgId: vi.fn(),
}));

const TenantScreen = () => {
  const { orgId, setManualOrgId } = useTenant();
  const [filter, setFilter] = useState('unset');

  return (
    <>
      <div>Org: {orgId}</div>
      <div>Filter: {filter}</div>
      <button onClick={() => setFilter('integration-from-org-33')}>Set tenant filter</button>
      <button onClick={() => setManualOrgId(84)}>Switch tenant</button>
      <button onClick={() => setManualOrgId(84, '/integrations?tab=inbound')}>Switch from record</button>
    </>
  );
};

describe('TenantProvider organization boundary', () => {
  it('remounts tenant UI so local selections cannot leak into the next organization', async () => {
    window.history.replaceState({}, '', '/dashboard?orgId=33');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <TenantProvider>
            <TenantScreen />
          </TenantProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );

    await screen.findByText('Org: 33');
    fireEvent.click(screen.getByRole('button', { name: 'Set tenant filter' }));
    expect(screen.getByText('Filter: integration-from-org-33')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch tenant' }));

    await waitFor(() => {
      expect(screen.getByText('Org: 84')).toBeInTheDocument();
      expect(screen.getByText('Filter: unset')).toBeInTheDocument();
    });
  });

  it('updates the active organization when browser history changes the orgId', async () => {
    window.history.replaceState({}, '', '/dashboard?orgId=33');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <TenantProvider>
            <TenantScreen />
          </TenantProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );

    await screen.findByText('Org: 33');
    fireEvent.click(screen.getByRole('button', { name: 'Set tenant filter' }));

    act(() => {
      window.history.pushState({}, '', '/dashboard?orgId=84');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(screen.getByText('Org: 84')).toBeInTheDocument();
      expect(screen.getByText('Filter: unset')).toBeInTheDocument();
    });
  });

  it('moves record-bound screens to the requested tenant-safe destination', async () => {
    window.history.replaceState({}, '', '/inbound-integrations/record-1?orgId=33');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <TenantProvider>
            <TenantScreen />
          </TenantProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );

    await screen.findByText('Org: 33');
    fireEvent.click(screen.getByRole('button', { name: 'Switch from record' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/integrations');
      expect(window.location.search).toContain('tab=inbound');
      expect(window.location.search).toContain('orgId=84');
    });
  });
});
