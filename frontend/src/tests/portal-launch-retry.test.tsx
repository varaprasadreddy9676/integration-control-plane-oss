import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PortalLaunchRoute } from '../features/auth/PortalLaunchRoute';

const { exchangeMock, navigateMock, locationMock } = vi.hoisted(() => ({
  exchangeMock: vi.fn(),
  navigateMock: vi.fn(),
  locationMock: vi.fn(() => ({ search: '?pid=profile-1&secret=one-time-secret' })),
}));

vi.mock('../services/api', () => ({ exchangePortalLaunchCredential: exchangeMock }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useLocation: locationMock,
    useNavigate: () => navigateMock,
  };
});

const successfulExchange = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  profile: {
    id: 'profile-1',
    role: 'VIEWER',
    orgId: 33,
    allowedIntegrationIds: [],
    allowedTags: [],
    allowedViews: ['logs'],
  },
};

describe('PortalLaunchRoute retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    exchangeMock.mockReset();
    locationMock.mockReturnValue({ search: '?pid=profile-1&secret=one-time-secret' });
  });

  it('retries the exchange with the in-memory credential after removing it from the URL', async () => {
    exchangeMock.mockRejectedValueOnce(new Error('Temporary gateway error'));
    exchangeMock.mockResolvedValueOnce(successfulExchange);
    render(<PortalLaunchRoute />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry launch' }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/logs?embedded=true&orgId=33', { replace: true }));
    expect(exchangeMock).toHaveBeenNthCalledWith(1, 'profile-1', 'one-time-secret');
    expect(exchangeMock).toHaveBeenNthCalledWith(2, 'profile-1', 'one-time-secret');
    expect(localStorage.getItem('integration_gateway_token')).toBe('access-token');
  });

  it('does not offer retry when the launch URL has no credentials', async () => {
    locationMock.mockReturnValue({ search: '' });
    render(<PortalLaunchRoute />);

    expect(await screen.findByText('The launch link is invalid or incomplete. Ask your administrator for a new link.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry launch' })).not.toBeInTheDocument();
    expect(exchangeMock).not.toHaveBeenCalled();
  });
});
