import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EventAuditDrawer } from '../features/events/components/EventAuditDrawer';

vi.mock('../design-system/utils', () => ({
  cssVar: {
    border: { default: '#d1d5db' },
    bg: { surface: '#ffffff' },
    legacy: {
      error: { 500: '#ef4444', 600: '#dc2626' },
      success: { 500: '#22c55e' },
      warning: { 500: '#f59e0b' },
      primary: { 500: '#3b82f6', 600: '#2563eb' },
      neutral: { 50: '#f8fafc', 200: '#e5e7eb', 900: '#111827' },
    },
  },
  useDesignTokens: () => ({
    token: { borderRadius: 8, borderRadiusLG: 12 },
    themeColors: {},
    spacing: { '0.5': '2px', '1': '4px', '2': '8px', '3': '12px' },
  }),
  withAlpha: (color: string) => color,
  spacingToNumber: (value: string | number) => Number.parseInt(String(value), 10) || 0,
}));

vi.mock('../app/theme-provider', () => ({
  useThemeMode: () => ({ mode: 'light' }),
}));

vi.mock('../utils/navigation', async () => {
  const actual = await vi.importActual<typeof import('../utils/navigation')>('../utils/navigation');
  return {
    ...actual,
    useNavigateWithParams: () => vi.fn(),
  };
});

describe('EventAuditDrawer', () => {
  it('renders delivery log links with the router basename preserved', () => {
    window.history.pushState({}, '', '/integration-gateway/events?orgId=648');

    render(
      <BrowserRouter basename="/integration-gateway">
        <EventAuditDrawer
          open
          onClose={() => {}}
          event={{
            eventId: 'evt-1',
            deliveryStatus: {
              integrationsMatched: 1,
              deliveredCount: 0,
              failedCount: 0,
              deliveryLogIds: ['69c4bd092600558b7f988a42'],
            },
            timeline: [],
          }}
        />
      </BrowserRouter>
    );

    const link = screen.getByRole('link', { name: 'View log 69c4bd092600558b7f988a42' });
    expect(link).toHaveAttribute('href', '/integration-gateway/logs/69c4bd092600558b7f988a42?orgId=648');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
