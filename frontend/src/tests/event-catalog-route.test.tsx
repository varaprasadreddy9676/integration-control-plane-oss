import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';

const mockApi = {
  getAllEventTypes: vi.fn(),
  deleteEventType: vi.fn(),
  importEventTemplates: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

vi.mock('../utils/navigation', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

vi.mock('../app/tenant-context', () => ({
  useTenant: () => ({
    orgId: 847,
    tenant: { orgId: 847, name: 'Test Org' },
    isLoading: false,
    error: null,
    setManualOrgId: vi.fn(),
    clearOrgId: vi.fn(),
  }),
}));

vi.mock('../app/theme-provider', () => ({
  useThemeMode: () => ({ mode: 'light' }),
}));

vi.mock('../components/common/PermissionGuard', () => ({
  PermissionGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../features/events/components/EventDetailDrawer', () => ({
  EventDetailDrawer: () => null,
}));

vi.mock('../features/events/routes/EventTypeEditorModal', () => ({
  EventTypeEditorModal: () => null,
}));

vi.mock('../design-system/utils', () => ({
  spacingToNumber: (value: string | number) => {
    if (typeof value === 'number') return value;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
  withAlpha: (color: string) => color,
  useDesignTokens: () => ({
    token: {
      borderRadius: 8,
      borderRadiusLG: 12,
      colorText: '#111',
      colorTextSecondary: '#666',
    },
    spacing: {
      2: '8px',
      3: '12px',
      4: '16px',
      6: '24px',
      8: '32px',
    },
  }),
  cssVar: {
    legacy: {
      primary: { 50: '#eff6ff', 300: '#93c5fd', 600: '#2563eb', 700: '#1d4ed8', 900: '#1e3a8a' },
      neutral: { 50: '#f8fafc', 100: '#f1f5f9', 700: '#334155', 800: '#1f2937' },
      info: { 600: '#0284c7' },
      success: { 600: '#16a34a' },
    },
    bg: { surface: '#fff' },
    border: { default: '#e5e7eb' },
  },
}));

describe('EventCatalogRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.deleteEventType.mockResolvedValue({ success: true });
    mockApi.importEventTemplates.mockResolvedValue({ success: true, imported: 0, skipped: 0, message: 'ok' });
  });

  it('ignores cached outbound event-type strings and renders the catalog response', async () => {
    mockApi.getAllEventTypes.mockResolvedValue([
      {
        eventType: 'BILL_CREATED',
        orgId: null,
        label: 'Bill Created',
        description: 'Triggered when a bill is created',
        category: 'Billing',
        fields: [],
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
    ]);

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    queryClient.setQueryData(['eventTypes'], ['LEGACY_STRING_EVENT']);

    const { EventCatalogRoute } = await import('../features/events/routes/EventCatalogRoute');

    render(
      <QueryClientProvider client={queryClient}>
        <App>
          <EventCatalogRoute />
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Bill Created')).toBeInTheDocument();
    });

    expect(mockApi.getAllEventTypes).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Billing')).toBeInTheDocument();
  });
});
