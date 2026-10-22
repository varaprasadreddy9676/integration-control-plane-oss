import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { TenantProvider, useTenant } from '../app/tenant-context';

vi.mock('../app/auth-context', () => ({
  useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }),
}));

// Like the real request(): answers for whichever org the request context holds when it is sent.
const api = vi.hoisted(() => {
  const state = { current: null as number | null, sent: [] as Array<number | null> };
  return {
    state,
    setCurrentOrgId: (orgId: number | null) => {
      state.current = orgId;
    },
    getTenantInfo: async () => {
      state.sent.push(state.current);
      return { tenantName: `Org ${state.current}` };
    },
  };
});
vi.mock('../services/api', () => ({ getTenantInfo: api.getTenantInfo, setCurrentOrgId: api.setCurrentOrgId }));

const Header = () => {
  const { orgId, tenant, setManualOrgId } = useTenant();
  return (
    <>
      <div>Selected: {orgId}</div>
      <div>Header: {tenant?.tenantName ?? '…'}</div>
      <button onClick={() => setManualOrgId(784)}>Switch</button>
    </>
  );
};

describe('switching organization', () => {
  it('shows the new organization in the header, never the previous one', async () => {
    window.history.replaceState({}, '', '/logs?orgId=33');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <BrowserRouter>
        <QueryClientProvider client={queryClient}>
          <TenantProvider>
            <Header />
          </TenantProvider>
        </QueryClientProvider>
      </BrowserRouter>
    );
    await screen.findByText('Header: Org 33');
    api.state.sent.length = 0;

    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));

    await screen.findByText('Selected: 784');
    await waitFor(() => expect(screen.getByText('Header: Org 784')).toBeInTheDocument());
    // No request for the new organization may go out under the old one.
    expect(api.state.sent).not.toContain(33);
    expect(api.state.current).toBe(784);
  });
});
