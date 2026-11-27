import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';

vi.mock('../app/theme-provider', () => ({ useThemeMode: () => ({ mode: 'light' }) }));

// Regression test: editing an already-complete inbound integration used to leave every
// downstream tab (Request Policy, Authentication, Request Transform, Response Transform,
// Review & Submit) disabled on first render. Root cause: their `disabled` flags depend on
// Form.useWatch('targetUrl'/'httpMethod'), which only starts reflecting loaded data once the
// Target API tab's Form.Items actually mount — and AntD doesn't mount inactive tab panes by
// default. Fixed with `forceRender` on the Target API tab item. This test loads a fully
// configured existing integration and asserts the later tabs are reachable WITHOUT first
// clicking into Target API.

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
  editorFontSize: () => 14,
  spacingToNumber: (value: string | number) => {
    if (typeof value === 'number') return value;
    const parsed = parseInt(String(value), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
  withAlpha: (hex: string, alpha: number) => `rgba(${hex}, ${alpha})`,
  useDesignTokens: () => ({
    spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px' },
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
    primary: { 600: '#1677ff' },
    text: { secondary: '#666' },
    warning: { text: '#ad6800' },
    success: { text: '#237804' },
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

describe('Inbound Integration edit — tab gating on an already-complete record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.updateInboundIntegration.mockResolvedValue({ success: true });
    mockApi.listSenderProfiles.mockResolvedValue([]);
    mockApi.getInboundIntegration.mockResolvedValue({
      _id: '507f1f77bcf86cd799439011',
      name: 'PartnerHub - Link Records',
      type: 'partnerhub-link-records',
      orgId: 84,
      inboundAuthType: 'NONE',
      inboundAuthConfig: {},
      targetUrl: 'https://api.partnerhub.example/api/abha/link-records',
      httpMethod: 'POST',
      timeout: 10000,
      retryCount: 2,
      contentType: 'application/json',
      streamResponse: false,
      requestTransformation: { mode: 'SCRIPT', script: 'return payload;' },
      responseTransformation: { mode: 'SCRIPT', script: 'return payload;' },
    });
  });

  it('does not leave Request Policy / Authentication / Transform / Review tabs disabled on initial render', async () => {
    const { InboundIntegrationDetailRoute } = await import(
      '../features/inbound-integrations/routes/InboundIntegrationDetailRoute'
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { container } = render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/inbound-integrations/507f1f77bcf86cd799439011']}>
            <Routes>
              <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('PartnerHub - Link Records')).toBeInTheDocument();
    });

    const disabledTabLabels = Array.from(container.querySelectorAll('[role="tab"][aria-disabled="true"]')).map((el) =>
      el.textContent?.trim()
    );

    // Only tabs that gate on Basic Info would legitimately be disabled if the name were
    // missing — here it's fully populated, so nothing past Basic Info should be locked.
    expect(disabledTabLabels).toEqual([]);
  });

  it('keeps visited configuration panels mounted and exposes tab-panel relationships', async () => {
    const { InboundIntegrationDetailRoute } = await import(
      '../features/inbound-integrations/routes/InboundIntegrationDetailRoute'
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/inbound-integrations/507f1f77bcf86cd799439011']}>
            <Routes>
              <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByDisplayValue('PartnerHub - Link Records')).toBeInTheDocument());
    const tabList = screen.getByRole('tablist', { name: 'Inbound integration configuration' });
    const policyTab = screen.getByRole('tab', { name: /Request Policy/ });
    const authTab = screen.getByRole('tab', { name: /Authentication/ });
    const policyPanelId = policyTab.getAttribute('aria-controls');
    expect(policyPanelId).toBeTruthy();

    fireEvent.click(policyTab);
    expect(policyTab).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector(`#${policyPanelId}`)).toBeVisible();
    fireEvent.click(authTab);

    expect(authTab).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector(`#${policyPanelId}`)).not.toBeVisible();
    expect(container.querySelector(`#${policyPanelId} .integration-tab-content`)).not.toBeNull();
    expect(tabList.querySelectorAll('[role="tab"]')).toHaveLength(7);
  });

  it('renders inbound tab content without an extra card shell', async () => {
    const { InboundIntegrationDetailRoute } = await import(
      '../features/inbound-integrations/routes/InboundIntegrationDetailRoute'
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { container } = render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/inbound-integrations/507f1f77bcf86cd799439011']}>
            <Routes>
              <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('PartnerHub - Link Records')).toBeInTheDocument();
    });

    const panel = container.querySelector('.integration-tab-content');
    expect(panel).not.toBeNull();
    expect(panel?.parentElement).not.toHaveClass('ant-card');
  });

  it('keeps Save Changes and testing tools in the shared action bar', async () => {
    const { InboundIntegrationDetailRoute } = await import(
      '../features/inbound-integrations/routes/InboundIntegrationDetailRoute'
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/inbound-integrations/507f1f77bcf86cd799439011']}>
            <Routes>
              <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('PartnerHub - Link Records')).toBeInTheDocument();
    });

    const bar = screen.getByRole('button', { name: 'Save Changes' }).closest('footer.configuration-action-bar');
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Test tools' }));
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('opens the configuration summary without a redundant review instruction', async () => {
    const { InboundIntegrationDetailRoute } = await import(
      '../features/inbound-integrations/routes/InboundIntegrationDetailRoute'
    );

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/inbound-integrations/507f1f77bcf86cd799439011']}>
            <Routes>
              <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('PartnerHub - Link Records')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Review & Submit/ }));

    expect(await screen.findByText('Basic Information')).toBeInTheDocument();
    expect(screen.getByText('Target API Configuration')).toBeInTheDocument();
    expect(screen.queryByText(/Please review all settings before/)).not.toBeInTheDocument();
  });
});
