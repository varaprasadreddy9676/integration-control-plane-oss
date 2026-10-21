import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const plugins = [
  {
    type: 'slack',
    name: 'Slack',
    description: 'Post alerts to a Slack channel.',
    fields: [
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
    type: 'email',
    name: 'Email',
    description: 'Email alerts.',
    fields: [{ key: 'recipients', label: 'Recipients', type: 'list', required: true }],
  },
];
const events = [
  { type: 'INTEGRATION_DELIVERY_FAILING', label: 'An integration starts failing every delivery' },
  { type: 'INTEGRATION_DELIVERY_RECOVERED', label: 'A failing integration recovers' },
];

const mockApi = {
  getAlertChannelPlugins: vi.fn(),
  listAlertChannels: vi.fn(),
  createAlertChannel: vi.fn(),
  updateAlertChannel: vi.fn(),
  deleteAlertChannel: vi.fn(),
  testAlertChannel: vi.fn(),
};
vi.mock('../services/api', () => mockApi);

async function renderCard() {
  const { AlertChannelsCard } = await import('../features/settings/components/AlertChannelsCard');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <AlertChannelsCard />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AlertChannelsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getAlertChannelPlugins.mockResolvedValue({ plugins, events });
    mockApi.listAlertChannels.mockResolvedValue([]);
  });

  it('invites adding a channel when there are none', async () => {
    await renderCard();
    expect(await screen.findByText(/No alert channels yet/)).toBeInTheDocument();
  });

  it('adds a channel with a form built from the plugin’s fields', async () => {
    mockApi.createAlertChannel.mockResolvedValue({ id: 'c1' });
    await renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Add channel/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Slack/ }));
    fireEvent.change(screen.getByLabelText('Slack webhook URL'), { target: { value: 'https://hooks.slack.com/services/T/B/X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save channel' }));

    await waitFor(() =>
      expect(mockApi.createAlertChannel).toHaveBeenCalledWith({
        type: 'slack',
        name: 'Slack',
        enabled: true,
        events: ['INTEGRATION_DELIVERY_FAILING', 'INTEGRATION_DELIVERY_RECOVERED'],
        config: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
      })
    );
  });

  it('shows each channel’s last result and sends a test', async () => {
    mockApi.listAlertChannels.mockResolvedValue([
      {
        id: 'c1',
        type: 'email',
        name: 'On-call',
        enabled: true,
        events: ['INTEGRATION_DELIVERY_FAILING'],
        config: { recipients: ['ops@example.com'] },
        lastResult: { ok: false, at: '2026-10-21T10:00:00Z', error: 'Email service not configured' },
      },
    ]);
    mockApi.testAlertChannel.mockResolvedValue({ ok: true });
    await renderCard();

    expect(await screen.findByText('On-call')).toBeInTheDocument();
    expect(screen.getByText(/Email service not configured/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send test to On-call' }));
    await waitFor(() => expect(mockApi.testAlertChannel).toHaveBeenCalledWith('c1'));
  });

  it('turns a channel off and on with its switch', async () => {
    mockApi.listAlertChannels.mockResolvedValue([
      { id: 'c1', type: 'slack', name: 'Ops', enabled: true, events: [], config: { webhookUrl: '********' }, lastResult: null },
    ]);
    mockApi.updateAlertChannel.mockResolvedValue({});
    await renderCard();
    fireEvent.click(await screen.findByRole('switch', { name: 'Ops enabled' }));
    await waitFor(() => expect(mockApi.updateAlertChannel).toHaveBeenCalledWith('c1', { enabled: false }));
  });
});
