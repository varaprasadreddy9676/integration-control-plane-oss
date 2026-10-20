import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from 'antd';

// Regression test: the Authentication column on the Inbound Integrations list used to render
// raw enum strings (NONE, API_KEY, ...) with NONE styled as a neutral "default" grey tag —
// visually indistinguishable from an intentional, secure setting. Fixed to a friendly "No Auth"
// label styled orange with a tooltip explaining the security implication, matching the same
// signal already used for the outbound "Open access" request-policy tag.

vi.mock('../utils/navigation', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

// ModernTable adds resizable columns / skeleton rows on top of antd's Table and needs a full
// theme-token setup we don't otherwise care about here — render the real antd Table directly
// so each column's `render(...)` still runs against our fixture data.
vi.mock('../components/common/ModernTable', async () => {
  const antd = await import('antd');
  return {
    ModernTable: (props: any) => <antd.Table {...props} pagination={false} />,
  };
});

vi.mock('../design-system/utils', () => ({
  withAlpha: (color: string) => color,
  spacingToNumber: (value: string | number) => {
    if (typeof value === 'number') return value;
    const parsed = parseInt(String(value), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
  useDesignTokens: () => ({
    spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px' },
    borderRadius: { full: '999px' },
  }),
  cssVar: {
    legacy: {
      primary: { 600: '#1677ff' },
      success: { 600: '#52c41a' },
      warning: { 600: '#faad14' },
      neutral: { 50: '#fafafa', 200: '#eee', 600: '#595959' },
      info: { 50: '#f0f5ff', 200: '#adc6ff', 600: '#1677ff', 700: '#0958d9' },
    },
    bg: { base: '#fff', surface: '#fff', subtle: '#fafafa' },
    border: { default: '#eee', subtle: '#f0f0f0' },
    text: { secondary: '#666', muted: '#999', primary: '#000' },
    success: { text: '#52c41a', bg: '#f6ffed', border: '#b7eb8f' },
    error: { text: '#ff4d4f', bg: '#fff2f0', border: '#ffccc7' },
    warning: { text: '#faad14', bg: '#fffbe6', border: '#ffe58f' },
    primary: { 100: '#e6f4ff', 700: '#0958d9' },
  },
}));

const mockApi = {
  getInboundIntegrations: vi.fn(),
  listSenderProfiles: vi.fn(),
  deleteInboundIntegration: vi.fn(),
  toggleInboundIntegration: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

describe('Inbound Integrations list — Authentication column', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listSenderProfiles.mockResolvedValue([]);
    mockApi.getInboundIntegrations.mockResolvedValue([
      {
        id: 'int-1',
        name: 'PartnerHub - Link Records',
        type: 'partnerhub-link-records',
        direction: 'INBOUND',
        inboundAuthType: 'NONE',
        isActive: true,
        updatedAt: new Date().toISOString(),
      },
    ]);
  });

  const renderRoute = async () => {
    const { InboundIntegrationsRoute } = await import(
      '../features/inbound-integrations/routes/InboundIntegrationsRoute'
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter>
            <InboundIntegrationsRoute />
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );
  };

  it('shows "No Auth" instead of the raw "NONE" enum value', async () => {
    await renderRoute();

    expect(await screen.findByText('No Auth')).toBeInTheDocument();
    expect(screen.queryByText('NONE')).not.toBeInTheDocument();
  });

  it('explains the security implication in a tooltip', async () => {
    await renderRoute();

    const tag = await screen.findByText('No Auth');
    await userEvent.hover(tag);

    expect(
      await screen.findByText('No authentication required — anyone with the URL can call this endpoint')
    ).toBeInTheDocument();
  });
});
