import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';
import { OrgContextGuard } from '../components/OrgContextGuard';

const { tenantState, authState, listOrgsMock } = vi.hoisted(() => ({
  tenantState: { orgId: 0, setManualOrgId: vi.fn() },
  authState: { user: { role: 'ORG_USER' } },
  listOrgsMock: vi.fn(),
}));

vi.mock('../app/tenant-context', () => ({ useTenant: () => tenantState }));
vi.mock('../app/auth-context', () => ({ useAuth: () => authState }));
vi.mock('../services/api', () => ({ listAdminOrgSummaries: listOrgsMock }));

const renderGuard = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <OrgContextGuard><div>Protected workspace</div></OrgContextGuard>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

describe('OrgContextGuard', () => {
  beforeEach(() => {
    tenantState.orgId = 0;
    tenantState.setManualOrgId.mockReset();
    authState.user = { role: 'ORG_USER' };
    listOrgsMock.mockReset();
  });

  it('rejects non-integer IDs and applies a valid ID once', async () => {
    renderGuard();
    const input = screen.getByRole('textbox', { name: 'Organization ID' });
    const continueButton = screen.getByRole('button', { name: 'Continue' });

    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.click(continueButton);
    expect(await screen.findByText('Enter a positive whole-number organization ID.')).toBeInTheDocument();
    expect(tenantState.setManualOrgId).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.click(continueButton);
    await waitFor(() => expect(tenantState.setManualOrgId).toHaveBeenCalledTimes(1));
    expect(tenantState.setManualOrgId).toHaveBeenCalledWith(42);
  });
});
