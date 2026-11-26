import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';
import { TemplatesRoute } from '../features/templates/routes/TemplatesRoute';

const { getTemplatesMock } = vi.hoisted(() => ({ getTemplatesMock: vi.fn() }));

vi.mock('../services/api', () => ({
  getTemplates: getTemplatesMock,
  createIntegrationFromTemplate: vi.fn(),
}));
vi.mock('antd', async (importOriginal) => {
  const antd = await importOriginal<typeof import('antd')>();
  const AppProvider = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    ...antd,
    App: Object.assign(AppProvider, {
      useApp: () => ({ message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }),
    }) as unknown as typeof antd.App,
  };
});
vi.mock('../features/templates/components/QuickSetupSection', () => ({ QuickSetupSection: () => null }));
vi.mock('../utils/navigation', () => ({ useNavigateWithParams: () => vi.fn() }));

const templates = [
  {
    id: 'template-1',
    name: 'Webhook starter',
    description: 'Send a configured event to a remote endpoint.',
    category: 'Messaging',
    eventType: 'EVENT_SENT',
    httpMethod: 'POST' as const,
    isActive: true,
    metadata: { vendor: 'Example service' },
  },
  {
    id: 'template-2',
    name: 'Payment starter',
    description: 'Receive payment events.',
    category: 'Payments',
    eventType: 'PAYMENT_RECEIVED',
    httpMethod: 'POST' as const,
    isActive: false,
  },
];

const renderTemplates = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/templates?orgId=33']}>
          <TemplatesRoute />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

describe('Templates route metadata hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTemplatesMock.mockResolvedValue(templates);
  });

  it('keeps category and active status distinct from plain template metadata', async () => {
    const { container } = renderTemplates();

    expect(await screen.findByText('Webhook starter')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 templates')).toBeInTheDocument();
    expect(screen.getByText('Messaging').closest('.status-badge')).toBeInTheDocument();
    expect(screen.getByText('Active').closest('.status-badge')).toBeInTheDocument();
    expect(screen.getByText('Example service').closest('.status-badge')).toBeNull();
    expect(screen.getByText('EVENT_SENT').tagName).toBe('CODE');
    expect(container.querySelectorAll('.ant-tag')).toHaveLength(0);
  });

  it('updates the result count with search and restores results on reset', async () => {
    renderTemplates();

    const search = await screen.findByRole('searchbox', { name: 'Search templates' });
    fireEvent.change(search, { target: { value: 'missing' } });

    expect(await screen.findByText('0 of 2 templates')).toBeInTheDocument();
    expect(screen.getByText('No matching templates')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));

    expect(await screen.findByText('Webhook starter')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 templates')).toBeInTheDocument();
  });
});
