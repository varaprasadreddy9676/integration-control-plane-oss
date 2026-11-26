import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const api = vi.hoisted(() => ({
  getLookups: vi.fn(),
  getLookupTypes: vi.fn(),
  deleteLookup: vi.fn(),
  bulkDeleteLookups: vi.fn(),
  exportLookups: vi.fn(),
  importLookups: vi.fn(),
  downloadLookupTemplate: vi.fn(),
  updateLookup: vi.fn(),
}));

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  ...api,
}));

const rows = [
  {
    id: 'mapping-1', orgId: 33, orgUnitRid: null, type: 'VISIT_TYPE',
    source: { id: 'OP', label: 'Outpatient' }, target: { id: 'AMB', label: 'Ambulatory' },
    isActive: true, version: 1, usageCount: 13, lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'mapping-2', orgId: 33, orgUnitRid: 4, type: 'PAYMENT_MODE',
    source: { id: 'CASH', label: 'Cash payment' }, target: { id: 'CSH', label: 'Cash' },
    isActive: false, version: 1, usageCount: 0, lastUsedAt: null,
    createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

async function renderRoute() {
  const { LookupsRoute } = await import('../features/lookups/routes/LookupsRoute');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/lookups']}>
          <LookupsRoute />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

describe('Lookup tables workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLookups.mockResolvedValue({ lookups: rows, total: rows.length });
    api.getLookupTypes.mockResolvedValue({ types: ['VISIT_TYPE', 'PAYMENT_MODE'] });
  });

  it('uses the shared workspace and searches source/target labels', async () => {
    await renderRoute();
    expect(await screen.findByText('Lookup tables')).toBeInTheDocument();
    expect(screen.getByText('Outpatient')).toBeInTheDocument();
    expect(screen.getByText('Cash payment')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search lookup mappings' }), {
      target: { value: 'ambulatory' },
    });

    expect(screen.getByText('AMB')).toBeInTheDocument();
    expect(screen.queryByText('CASH')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 mappings')).toBeInTheDocument();
  });

  it('shows an explicit no-match state with a clear-filter action', async () => {
    await renderRoute();
    await screen.findByText('Outpatient');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search lookup mappings' }), {
      target: { value: 'not-a-code' },
    });

    expect(await screen.findByText('No mappings match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Outpatient')).toBeInTheDocument();
  });

  it('exposes a retry when lookup data fails to load', async () => {
    api.getLookups.mockRejectedValueOnce(new Error('Lookup service unavailable'));
    api.getLookups.mockResolvedValueOnce({ lookups: rows, total: rows.length });
    await renderRoute();

    expect(await screen.findByText('Lookup tables could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.getLookups).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Outpatient')).toBeInTheDocument();
  });
});
