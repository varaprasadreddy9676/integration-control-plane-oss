import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const api = vi.hoisted(() => ({
  getLookup: vi.fn(),
  getLookupTypes: vi.fn(),
  createLookup: vi.fn(),
  updateLookup: vi.fn(),
}));

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  ...api,
}));

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({
    orgId: 33,
    tenant: { childEntities: [{ rid: 4, name: 'Central clinic' }] },
  }),
}));

const lookup = {
  id: 'lookup-1', orgId: 33, orgUnitRid: null, type: 'VISIT_TYPE',
  source: { id: 'OP', label: 'Outpatient' }, target: { id: 'AMB', label: 'Ambulatory' },
  isActive: true, version: 3, usageCount: 10, lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

async function renderRoute(path = '/lookups/lookup-1') {
  const { LookupDetailRoute } = await import('../features/lookups/routes/LookupDetailRoute');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="/lookups/:id" element={<LookupDetailRoute />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
  return client;
}

describe('Lookup mapping editor workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getLookup.mockResolvedValue(lookup);
    api.getLookupTypes.mockResolvedValue({ types: ['VISIT_TYPE'] });
  });

  it('hydrates an edit form in its organization-scoped query and shows concise sections', async () => {
    const client = await renderRoute();

    expect(await screen.findByRole('heading', { name: 'Edit mapping' })).toBeInTheDocument();
    expect(screen.getByLabelText('Source code')).toHaveValue('OP');
    expect(screen.getByDisplayValue('Outpatient')).toBeInTheDocument();
    expect(screen.getByLabelText('Target code')).toHaveValue('AMB');
    expect(screen.getByRole('region', { name: 'Source system' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Target system' })).toBeInTheDocument();
    expect(client.getQueryCache().find({ queryKey: ['lookup', 33, 'lookup-1'] })).toBeDefined();
  });

  it('does not show a blank editable form when loading an existing mapping fails', async () => {
    api.getLookup.mockRejectedValueOnce(new Error('Mapping service unavailable'));
    await renderRoute();

    expect(await screen.findByText('Mapping could not be loaded')).toBeInTheDocument();
    expect(screen.queryByLabelText('Source code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
