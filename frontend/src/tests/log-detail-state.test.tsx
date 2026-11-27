import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';
import { LogDetailRoute } from '../features/logs/routes/LogDetailRoute';

const { getLogByIdMock } = vi.hoisted(() => ({ getLogByIdMock: vi.fn() }));

vi.mock('../services/api', () => ({
  getLogById: getLogByIdMock,
  retryLog: vi.fn(),
  getApiBaseUrl: vi.fn(() => 'https://gateway.test'),
}));

vi.mock('../app/tenant-context', () => ({ useTenant: () => ({ orgId: 33 }) }));
vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title, breadcrumb }: { title: string; breadcrumb?: Array<{ label: string }> }) => (
    <>
      <nav aria-label="Breadcrumb">{breadcrumb?.map((item, index) => <span key={index}>{item.label}</span>)}</nav>
      <h1>{title}</h1>
    </>
  ),
}));

const renderRoute = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/logs/record-1?orgId=33']}>
          <Routes>
            <Route path="/logs/:id" element={<LogDetailRoute />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

describe('LogDetailRoute states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a retryable error instead of leaving skeletons indefinitely', async () => {
    getLogByIdMock.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce(null);
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: /Retry/ }));

    expect(await screen.findByRole('heading', { name: 'Delivery log not found' })).toBeInTheDocument();
    expect(getLogByIdMock).toHaveBeenCalledTimes(2);
  });

  it('uses a human breadcrumb and shared delivery/HTTP status semantics', async () => {
    getLogByIdMock.mockResolvedValueOnce({
      id: 'record-1',
      integrationConfigId: 'integration-1',
      integrationName: 'Appointment Created to Scheduling',
      eventType: 'APPOINTMENT_CREATED',
      direction: 'OUTBOUND',
      status: 'SUCCESS',
      responseStatus: 202,
      responseTimeMs: 184,
      attemptCount: 1,
      createdAt: '2026-11-22T10:00:00.000Z',
      requestPayload: { appointmentId: 'apt-1' },
    });

    const { container } = renderRoute();

    await screen.findAllByText('Appointment Created to Scheduling');
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByText('Appointment Created to Scheduling')).toBeInTheDocument();
    expect(breadcrumb).not.toHaveTextContent('record-1');
    expect(await screen.findByText('Delivered')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')).not.toBeInTheDocument();
    expect(screen.getByText('202').tagName).toBe('CODE');
  });

  it('uses a single description column at phone widths', async () => {
    getLogByIdMock.mockResolvedValueOnce({
      id: 'record-1',
      integrationConfigId: 'integration-1',
      integrationName: 'Appointment Created to Scheduling',
      eventType: 'APPOINTMENT_CREATED',
      direction: 'OUTBOUND',
      status: 'SUCCESS',
      responseStatus: 202,
      responseTimeMs: 184,
      attemptCount: 1,
      createdAt: '2026-11-22T10:00:00.000Z',
      requestPayload: { appointmentId: 'apt-1' },
    });
    const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('max-width: 575px'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));

    renderRoute();

    expect((await screen.findAllByText('Appointment Created to Scheduling')).length).toBeGreaterThan(0);
    const integrationLabel = screen.getByText('Integration');
    // Unbordered descriptions render one cell per column: a single column at
    // phone width means one cell in the row.
    expect(integrationLabel.closest('tr')?.children).toHaveLength(1);
    media.mockRestore();
  });

  it('keeps the overview to two description columns at desktop breakpoints', async () => {
    getLogByIdMock.mockResolvedValueOnce({
      id: 'record-1',
      integrationConfigId: 'integration-1',
      integrationName: 'Appointment Created to Scheduling',
      eventType: 'APPOINTMENT_CREATED',
      direction: 'OUTBOUND',
      status: 'SUCCESS',
      responseStatus: 202,
      responseTimeMs: 184,
      attemptCount: 1,
      createdAt: '2026-11-22T10:00:00.000Z',
      requestPayload: { appointmentId: 'apt-1' },
    });
    const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));

    renderRoute();

    expect((await screen.findAllByText('Appointment Created to Scheduling')).length).toBeGreaterThan(0);
    const integrationLabel = screen.getByText('Integration');
    // Two columns at desktop: two label/value cells per row.
    expect(integrationLabel.closest('tr')?.children).toHaveLength(2);
    media.mockRestore();
  });
});
