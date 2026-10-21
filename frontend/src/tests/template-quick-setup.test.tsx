import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const mockNavigate = vi.fn();
vi.mock('../utils/navigation', () => ({ useNavigateWithParams: () => mockNavigate }));
vi.mock('../app/tenant-context', () => ({ useTenant: () => ({ orgId: 7 }) }));

const catalog = [
  {
    id: 'slack-channel',
    name: 'Slack: post events to a channel',
    description: 'Sends a message to Slack.',
    category: 'Messaging',
    direction: 'OUTBOUND',
    inputs: [
      { key: 'eventType', label: 'Event', type: 'eventType', required: true },
      {
        key: 'webhookUrl',
        label: 'Slack webhook URL',
        type: 'secret',
        required: true,
        pattern: '^https://hooks\\.slack\\.com/services/',
        patternMessage: 'Slack webhook URLs start with https://hooks.slack.com/services/',
      },
    ],
  },
  {
    id: 'stripe-webhooks',
    name: 'Stripe: receive webhooks',
    description: 'Verifies and forwards Stripe events.',
    category: 'Payments',
    direction: 'INBOUND',
    inputs: [
      { key: 'signingSecret', label: 'Stripe signing secret', type: 'secret', required: true },
      { key: 'forwardUrl', label: 'Forward events to', type: 'url', required: true },
    ],
  },
];

const mockApi = {
  getTemplateCatalog: vi.fn(),
  getEventTypes: vi.fn(),
  buildFromTemplateCatalog: vi.fn(),
  createIntegration: vi.fn(),
  createInboundIntegration: vi.fn(),
  getApiBaseUrl: () => 'https://gateway.example.com/api/v1',
};
vi.mock('../services/api', () => mockApi);

async function renderSection() {
  const { QuickSetupSection } = await import('../features/templates/components/QuickSetupSection');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <QuickSetupSection />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('QuickSetupSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getTemplateCatalog.mockResolvedValue(catalog);
    mockApi.getEventTypes.mockResolvedValue(['ORDER_PLACED', 'CUSTOMER_CREATED']);
  });

  it('shows a card for each built-in setup', async () => {
    await renderSection();
    expect(await screen.findByText('Slack: post events to a channel')).toBeInTheDocument();
    expect(screen.getByText('Stripe: receive webhooks')).toBeInTheDocument();
  });

  it('checks inputs before building, then creates the integration through the normal API', async () => {
    mockApi.buildFromTemplateCatalog.mockResolvedValue({ direction: 'OUTBOUND', payload: { name: 'Slack: ORDER_PLACED' } });
    mockApi.createIntegration.mockResolvedValue({ id: 'int-1', name: 'Slack: ORDER_PLACED' });
    await renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Set up Slack/ }));
    fireEvent.change(await screen.findByLabelText('Event'), { target: { value: 'ORDER_PLACED' } });
    fireEvent.change(screen.getByLabelText('Slack webhook URL'), { target: { value: 'https://example.com/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create integration' }));
    expect(await screen.findByText('Slack webhook URLs start with https://hooks.slack.com/services/')).toBeInTheDocument();
    expect(mockApi.buildFromTemplateCatalog).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Slack webhook URL'), {
      target: { value: 'https://hooks.slack.com/services/T/B/X' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create integration' }));

    await waitFor(() =>
      expect(mockApi.buildFromTemplateCatalog).toHaveBeenCalledWith(
        'slack-channel',
        { eventType: 'ORDER_PLACED', webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
        false
      )
    );
    await waitFor(() => expect(mockApi.createIntegration).toHaveBeenCalledWith({ name: 'Slack: ORDER_PLACED' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open integration' }));
    expect(mockNavigate).toHaveBeenCalledWith('/integrations/int-1');
  });

  it('shows the URL to give Stripe after creating the inbound endpoint', async () => {
    mockApi.buildFromTemplateCatalog.mockResolvedValue({
      direction: 'INBOUND',
      payload: { name: 'Stripe webhooks', type: 'stripe-events' },
    });
    mockApi.createInboundIntegration.mockResolvedValue({ data: { id: 'in-1' } });
    await renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Set up Stripe/ }));
    fireEvent.change(await screen.findByLabelText('Stripe signing secret'), { target: { value: 'whsec_abc' } });
    fireEvent.change(screen.getByLabelText('Forward events to'), { target: { value: 'https://api.example.com/hook' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create integration' }));

    expect(
      await screen.findByText('https://gateway.example.com/api/v1/public/integrations/stripe-events?orgId=7')
    ).toBeInTheDocument();
  });
});
