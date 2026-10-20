import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApi = vi.hoisted(() => ({
  getEventSourceConfig: vi.fn(),
  getAllEventTypes: vi.fn(),
}));

vi.mock('../services/api', () => mockApi);

import { ThemeProvider } from '../app/theme-provider';
import { GettingStartedCard } from '../features/dashboard/components/GettingStartedCard';

const renderCard = (onNavigate = vi.fn()) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <GettingStartedCard orgId={1} onNavigate={onNavigate} />
      </QueryClientProvider>
    </ThemeProvider>
  );
  return onNavigate;
};

describe('GettingStartedCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leaves every step open on a fresh org', async () => {
    mockApi.getEventSourceConfig.mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    mockApi.getAllEventTypes.mockResolvedValue([]);
    renderCard();

    expect(await screen.findByText('Choose where events come from')).toBeInTheDocument();
    expect(screen.queryByText('(done)')).not.toBeInTheDocument();
  });

  it('ticks the steps that are actually configured', async () => {
    mockApi.getEventSourceConfig.mockResolvedValue({ orgId: 1, type: 'http_push', config: {}, isActive: true });
    mockApi.getAllEventTypes.mockResolvedValue([{ eventType: 'ORDER_PLACED' }]);
    renderCard();

    expect(await screen.findAllByText('(done)')).toHaveLength(2);
  });

  it('opens the matching create screen', async () => {
    mockApi.getEventSourceConfig.mockResolvedValue(null);
    mockApi.getAllEventTypes.mockResolvedValue([]);
    const onNavigate = renderCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Inbound' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled job' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open event catalog' }));
    expect(onNavigate.mock.calls.map(([path]) => path)).toEqual([
      '/inbound-integrations/new',
      '/scheduled-jobs/new',
      '/events/catalog',
    ]);
  });
});
