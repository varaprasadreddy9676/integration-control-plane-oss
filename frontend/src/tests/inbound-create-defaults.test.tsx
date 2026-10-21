import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor" />,
}));

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../utils/navigation', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({
    orgId: 84,
    tenant: { orgId: 84, name: 'Test Org' },
    isLoading: false,
    error: null,
    setManualOrgId: vi.fn(),
    clearOrgId: vi.fn(),
  }),
}));

vi.mock('../design-system/utils', () => ({
  spacingToNumber: (value: string | number) => {
    if (typeof value === 'number') return value;
    const parsed = parseInt(String(value), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
  withAlpha: (hex: string, alpha: number) => `rgba(${hex}, ${alpha})`,
  useDesignTokens: () => ({
    spacing: {
      1: '4px',
      2: '8px',
      3: '12px',
      4: '16px',
      5: '20px',
      6: '24px',
      8: '32px',
    },
  }),
  cssVar: {
    legacy: {
      primary: { 600: '#1677ff' },
      success: { 600: '#52c41a' },
      warning: { 600: '#faad14' },
      info: { 50: '#f0f5ff', 200: '#adc6ff', 600: '#1677ff', 700: '#0958d9' },
      neutral: { 900: '#111111' },
    },
    bg: { base: '#fff', surface: '#fff' },
    border: { default: '#eee' },
    text: { secondary: '#666' },
  },
}));

const mockApi = {
  getInboundIntegration: vi.fn(),
  getInboundIntegrationCredentials: vi.fn(),
  getApiBaseUrl: () => 'http://localhost:4000/api/v1',
  createInboundIntegration: vi.fn(),
  updateInboundIntegration: vi.fn(),
  getUIConfig: vi.fn(),
  testInboundRuntime: vi.fn(),
  listSenderProfiles: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

describe('Create inbound integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.listSenderProfiles.mockResolvedValue([]);
    mockApi.createInboundIntegration.mockResolvedValue({ _id: 'new-id' });
  });

  it('saves with only name, type and target URL filled in (target auth defaults to None)', async () => {
    const { InboundIntegrationDetailRoute } = await import(
      '../features/inbound-integrations/routes/InboundIntegrationDetailRoute'
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/inbound-integrations/new']}>
            <Routes>
              <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    const name = await screen.findByPlaceholderText('e.g., CleverTap Real-time Sync');
    fireEvent.change(name, { target: { value: 'Customer lookup API' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., clevertap'), { target: { value: 'customer-lookup' } });
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/integration'), {
      target: { value: 'https://partner.example.com/customers' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Integration/ }));

    await waitFor(() => {
      expect(mockApi.createInboundIntegration).toHaveBeenCalledTimes(1);
    });
    expect(mockApi.createInboundIntegration.mock.calls[0][0]).toEqual(
      expect.objectContaining({ outgoingAuthType: 'NONE', targetUrl: 'https://partner.example.com/customers' })
    );
  });
});
