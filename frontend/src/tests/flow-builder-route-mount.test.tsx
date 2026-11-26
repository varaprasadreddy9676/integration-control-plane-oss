import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({ orgId: 33 }),
}));
vi.mock('../hooks/useIntegrationConfig', () => ({
  useIntegrationConfig: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('../utils/navigation', async () => {
  const { useNavigate } = await import('react-router-dom');
  return { useNavigateWithParams: () => useNavigate() };
});
vi.mock('../features/flowBuilder/components/FlowCanvas', () => ({ default: () => <div>Flow canvas</div> }));
vi.mock('../features/flowBuilder/components/NodePalette', () => ({ default: () => <div>Node palette</div> }));
vi.mock('../features/flowBuilder/components/InspectorPanel', () => ({ default: () => <div>Inspector</div> }));
vi.mock('../features/flowBuilder/components/FlowTopBar', () => ({
  default: ({ flowState }: { flowState: { name: string } }) => <div>{flowState.name}</div>,
}));
vi.mock('../features/flowBuilder/components/FlowRunPanel', () => ({ default: () => null }));

import { FlowBuilderRoute } from '../features/flowBuilder/routes/FlowBuilderRoute';

describe('Flow Builder route', () => {
  it('mounts a new integration editor without a validation update loop', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/flow-builder/new?mode=INBOUND&orgId=33']}>
            <Routes>
              <Route path="/flow-builder/new" element={<FlowBuilderRoute />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>
    );

    expect(await screen.findByText('New Integration')).toBeInTheDocument();
    expect(screen.getByText('Flow canvas')).toBeInTheDocument();
  });
});
