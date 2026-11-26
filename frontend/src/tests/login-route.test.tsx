import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginRoute } from '../features/auth/LoginRoute';
import { ThemeProvider } from '../app/theme-provider';

const { loginMock, navigateMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../app/auth-context', () => ({ useAuth: () => ({ login: loginMock }) }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

describe('LoginRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows authentication failures in the sign-in form', async () => {
    loginMock.mockRejectedValue(new Error('Account is disabled'));
    const user = userEvent.setup();
    render(<ThemeProvider><LoginRoute /></ThemeProvider>);

    await user.type(screen.getByLabelText('Email'), 'operator@example.com');
    await user.type(screen.getByLabelText('Password'), 'incorrect-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Account is disabled')).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledWith('operator@example.com', 'incorrect-password');
  });

  it('clears stale entity scope and returns to the stored redirect after login', async () => {
    loginMock.mockResolvedValue(undefined);
    localStorage.setItem('integration_gateway_entity_rid', 'old-entity');
    sessionStorage.setItem('integration_gateway_entity_rid', 'old-entity');
    sessionStorage.setItem('auth_redirect', '/logs?orgId=33');
    const user = userEvent.setup();
    render(<ThemeProvider><LoginRoute /></ThemeProvider>);

    await user.type(screen.getByLabelText('Email'), 'operator@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/logs?orgId=33', { replace: true }));
    expect(localStorage.getItem('integration_gateway_entity_rid')).toBeNull();
    expect(sessionStorage.getItem('integration_gateway_entity_rid')).toBeNull();
    expect(sessionStorage.getItem('auth_redirect')).toBeNull();
  });
});
