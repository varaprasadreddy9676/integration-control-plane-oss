import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';
import { IntegrationContextRail } from '../features/integrations/components/IntegrationContextRail';
import { getLogs } from '../services/api';

vi.mock('../services/api', () => ({ getLogs: vi.fn() }));

const integration = {
  id: 'int-1',
  name: 'Appointment Created to Scheduling',
  eventType: 'APPOINTMENT_CREATED',
  tenantId: 33,
  entityName: 'Northstar',
  scope: 'INCLUDE_CHILDREN',
  targetUrl: 'https://scheduling.example.test/hooks/appointments',
  httpMethod: 'POST',
  outgoingAuthType: 'BEARER',
  isActive: true,
  updatedAt: '2026-11-27T10:00:00.000Z',
};

const renderRail = (onOpenLogs = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <IntegrationContextRail integration={integration as any} onOpenLogs={onOpenLogs} />
      </ThemeProvider>
    </QueryClientProvider>
  );
};

describe('IntegrationContextRail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders integration status, connection metadata, recent runs, and opens logs', async () => {
    vi.mocked(getLogs).mockResolvedValueOnce({
      data: [
        {
          id: 'r1',
          status: 'SUCCESS',
          createdAt: '2026-11-27T10:00:00.000Z',
          responseTimeMs: 184,
          responseStatus: 200,
        },
        {
          id: 'r2',
          status: 'FAILED',
          createdAt: '2026-11-27T09:00:00.000Z',
          responseTimeMs: null,
          responseStatus: 503,
        },
      ],
      pagination: {
        page: 1,
        limit: 5,
        total: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    } as any);

    const onOpenLogs = vi.fn();
    renderRail(onOpenLogs);

    expect(screen.getByRole('complementary', { name: 'Integration status' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('scheduling.example.test')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('bearer')).toBeInTheDocument();

    expect(await screen.findByText('184 ms')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('503')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All logs' }));
    expect(onOpenLogs).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when there are no deliveries', async () => {
    vi.mocked(getLogs).mockResolvedValueOnce({
      data: [],
      pagination: {
        page: 1,
        limit: 5,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
    } as any);

    renderRail();

    expect(await screen.findByText(/No deliveries yet/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows loading state while runs are pending', () => {
    vi.mocked(getLogs).mockReturnValueOnce(new Promise(() => {}));

    renderRail();

    expect(screen.getByText('Loading runs…')).toBeInTheDocument();
  });
});
