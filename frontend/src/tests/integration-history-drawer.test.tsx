import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  default: () => <div />,
}));

const mockApi = {
  getIntegrationRevisions: vi.fn(),
  getIntegrationRevisionDiff: vi.fn(),
  restoreIntegrationRevision: vi.fn(),
};
vi.mock('../services/api', () => mockApi);

const revisions = [
  {
    revision: 3,
    source: 'UPDATED',
    restoredFrom: null,
    changedBy: { id: 'u1', email: 'dana@example.com' },
    changedFields: ['targetUrl', 'outgoingAuthConfig.apiKey'],
    createdAt: '2026-10-21T10:00:00Z',
  },
  {
    revision: 2,
    source: 'UPDATED',
    restoredFrom: null,
    changedBy: { id: 'u2', email: 'sam@example.com' },
    changedFields: ['retryCount'],
    createdAt: '2026-10-20T10:00:00Z',
  },
  { revision: 1, source: 'CREATED', restoredFrom: null, changedBy: null, changedFields: [], createdAt: '2026-10-19T10:00:00Z' },
];

async function renderDrawer(onRestored = vi.fn()) {
  const { IntegrationHistoryDrawer } = await import('../features/integration-history/IntegrationHistoryDrawer');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <IntegrationHistoryDrawer open integrationId="abc123" onClose={() => {}} onRestored={onRestored} />
      </ThemeProvider>
    </QueryClientProvider>
  );
  return { onRestored };
}

describe('IntegrationHistoryDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getIntegrationRevisions.mockResolvedValue({
      integration: { id: 'abc123', name: 'Orders to partner CRM', direction: 'OUTBOUND' },
      revisions,
    });
    mockApi.getIntegrationRevisionDiff.mockResolvedValue({
      from: 2,
      to: 'current',
      changes: [
        { path: 'targetUrl', kind: 'changed', before: 'https://a.example', after: 'https://b.example' },
        { path: 'outgoingAuthConfig.apiKey', kind: 'changed', before: '********', after: '********', secret: true },
      ],
      fromSnapshot: {},
      toSnapshot: {},
    });
    mockApi.restoreIntegrationRevision.mockResolvedValue({ restoredFrom: 2, revision: 4 });
  });

  it('lists revisions newest first with who changed what', async () => {
    await renderDrawer();
    expect(await screen.findByRole('button', { name: /Revision 3/ })).toBeInTheDocument();
    expect(screen.getByText('dana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('shows what changed between a revision and the current configuration, hiding secrets', async () => {
    await renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: /Revision 2/ }));

    await waitFor(() => expect(mockApi.getIntegrationRevisionDiff).toHaveBeenCalledWith('abc123', 2, 'current'));
    expect(await screen.findByText('https://a.example')).toBeInTheDocument();
    expect(screen.getByText('https://b.example')).toBeInTheDocument();
    expect(screen.getAllByText(/Hidden/).length).toBeGreaterThan(0);
  });

  it('asks before restoring, then restores and reports back', async () => {
    const { onRestored } = await renderDrawer();
    fireEvent.click(await screen.findByRole('button', { name: /Revision 2/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Restore revision 2/ }));

    expect((await screen.findAllByText('Restore revision 2?')).length).toBeGreaterThan(0);
    expect(mockApi.restoreIntegrationRevision).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]);

    await waitFor(() => expect(mockApi.restoreIntegrationRevision).toHaveBeenCalledWith('abc123', 2));
    expect(mockApi.restoreIntegrationRevision).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
  });

  it('explains when the user may not view history', async () => {
    mockApi.getIntegrationRevisions.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    await renderDrawer();
    expect(await screen.findByText(/do not have access to this integration’s history/)).toBeInTheDocument();
  });
});
