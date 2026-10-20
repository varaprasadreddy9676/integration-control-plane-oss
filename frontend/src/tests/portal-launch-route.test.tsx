import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PortalLaunchRoute } from '../features/auth/PortalLaunchRoute';

const { navigateMock, exchangePortalLaunchCredentialMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  exchangePortalLaunchCredentialMock: vi.fn(),
}));

const createStorageMock = () => {
  let store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store = new Map<string, string>();
    }),
  };
};

const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../services/api', () => ({
  exchangePortalLaunchCredential: exchangePortalLaunchCredentialMock,
}));

describe('PortalLaunchRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(window, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
    });
    localStorageMock.clear();
    sessionStorageMock.clear();
  });

  it('redirects to standalone system status when it is the only allowed view', async () => {
    exchangePortalLaunchCredentialMock.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: '1h',
      profile: {
        id: 'profile-1',
        orgId: 812,
        role: 'VIEWER',
        allowedIntegrationIds: [],
        allowedTags: [],
        allowedViews: ['system_status'],
      },
    });

    render(
      <MemoryRouter initialEntries={['/portal/launch?pid=profile-1&secret=top-secret']}>
        <Routes>
          <Route path="/portal/launch" element={<PortalLaunchRoute />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(exchangePortalLaunchCredentialMock).toHaveBeenCalledWith('profile-1', 'top-secret');
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/status/system?embedded=true&orgId=812', { replace: true });
    });

    expect(localStorage.getItem('integration_gateway_org_id')).toBe('812');
    expect(sessionStorage.getItem('integration_gateway_org_id')).toBe('812');
    expect(localStorage.getItem('integration_gateway_entity_rid')).toBe('812');
    expect(sessionStorage.getItem('integration_gateway_entity_rid')).toBe('812');
  });
});
