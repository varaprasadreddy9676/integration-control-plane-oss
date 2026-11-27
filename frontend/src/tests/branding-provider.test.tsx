import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_BRANDING } from '../app/branding';
import { BrandingProvider, useBranding } from '../app/branding-provider';
import { getUIConfig, updateAdminUiConfig } from '../services/api';

vi.mock('../services/api', () => ({
  getUIConfig: vi.fn(),
  updateAdminUiConfig: vi.fn(),
}));

const Probe = () => {
  const { branding, updateBranding } = useBranding();
  return (
    <div>
      <span data-testid="product-name">{branding.productName}</span>
      <span data-testid="workspace-name">{branding.workspaceName ?? 'null'}</span>
      <button type="button" onClick={() => void updateBranding({ workspaceName: 'ACME' })}>
        Update workspace
      </button>
    </div>
  );
};

const renderBrandingProbe = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <Probe />
      </BrandingProvider>
    </QueryClientProvider>
  );
};

describe('BrandingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.title = '';
  });

  it('renders server branding and updates document.title', async () => {
    vi.mocked(getUIConfig).mockResolvedValue({
      branding: { productName: 'Acme Gateway', workspaceName: 'ACME', logoUrl: null },
    } as never);

    renderBrandingProbe();

    await waitFor(() => {
      expect(screen.getByTestId('product-name')).toHaveTextContent('Acme Gateway');
      expect(screen.getByTestId('workspace-name')).toHaveTextContent('ACME');
      expect(document.title).toBe('ACME · Acme Gateway');
    });
  });

  it('falls back to DEFAULT_BRANDING when getUIConfig rejects', async () => {
    vi.mocked(getUIConfig).mockRejectedValue(new Error('Unauthorized'));

    renderBrandingProbe();

    await waitFor(() => {
      expect(getUIConfig).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByTestId('product-name')).toHaveTextContent(DEFAULT_BRANDING.productName);
    expect(document.title).toBe(DEFAULT_BRANDING.productName);
  });

  it('persists updated workspaceName via updateAdminUiConfig', async () => {
    vi.mocked(getUIConfig).mockResolvedValue({
      branding: { productName: 'Acme Gateway', workspaceName: null, logoUrl: null },
    } as never);
    vi.mocked(updateAdminUiConfig).mockResolvedValue({});

    renderBrandingProbe();

    await waitFor(() => {
      expect(screen.getByTestId('product-name')).toHaveTextContent('Acme Gateway');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Update workspace' }));

    await waitFor(() => {
      expect(updateAdminUiConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          branding: expect.objectContaining({
            workspaceName: 'ACME',
          }),
        })
      );
    });
  });

  it('treats an explicit empty workspaceName as null in branding and title', async () => {
    vi.mocked(getUIConfig).mockResolvedValue({
      branding: { productName: 'Acme Gateway', workspaceName: '', logoUrl: null },
    } as never);

    renderBrandingProbe();

    await waitFor(() => {
      expect(screen.getByTestId('product-name')).toHaveTextContent('Acme Gateway');
      expect(screen.getByTestId('workspace-name')).toHaveTextContent('null');
      expect(document.title).toBe('Acme Gateway');
    });
  });
});
