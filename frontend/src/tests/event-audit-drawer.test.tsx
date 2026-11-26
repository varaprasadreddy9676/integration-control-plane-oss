import { render, screen, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventAuditDrawer } from '../features/events/components/EventAuditDrawer';

const themeState = vi.hoisted(() => ({ mode: 'light' as 'light' | 'dark' }));

vi.mock('../design-system/utils', () => ({
  cssVar: {
    border: { default: '#d1d5db' },
    bg: { surface: 'var(--color-bg-surface)', elevated: 'var(--color-bg-elevated)' },
    legacy: {
      error: { 500: '#ef4444', 600: '#dc2626' },
      success: { 500: '#22c55e' },
      warning: { 500: '#f59e0b' },
      primary: { 500: '#3b82f6', 600: '#2563eb' },
      neutral: { 50: '#f8fafc', 200: '#e5e7eb', 800: '#1f2937', 900: '#111827' },
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
  useThemeMode: () => themeState,
}));

vi.mock('../utils/navigation', async () => {
  const actual = await vi.importActual<typeof import('../utils/navigation')>('../utils/navigation');
  return {
    ...actual,
    useNavigateWithParams: () => vi.fn(),
  };
});

describe('EventAuditDrawer', () => {
  beforeEach(() => {
    themeState.mode = 'light';
  });

  it('renders delivery log links with the router basename preserved', () => {
    window.history.pushState({}, '', '/integration-gateway/events?orgId=648');

    render(
      <BrowserRouter basename="/integration-gateway">
        <EventAuditDrawer
          open
          onClose={vi.fn()}
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

  it('uses semantic theme surfaces for timeline entries and elapsed-time tags', () => {
    themeState.mode = 'dark';
    window.history.pushState({}, '', '/integration-gateway/events?orgId=648');

    render(
      <BrowserRouter basename="/integration-gateway">
        <EventAuditDrawer
          open
          onClose={vi.fn()}
          event={{
            eventId: 'evt-dark',
            timeline: [
              { ts: '2026-11-22T10:00:00.000Z', stage: 'RECEIVED', details: 'Event accepted' },
              { ts: '2026-11-22T10:00:02.000Z', stage: 'PROCESSING', details: 'Processing started' },
            ],
          }}
        />
      </BrowserRouter>
    );

    expect(screen.getAllByTestId('event-audit-timeline-item')[0]).toHaveClass('event-audit-timeline-item');
    expect(
      within(screen.getAllByTestId('event-audit-timeline-item')[0]).getByText('Pending')
    ).toBeInTheDocument();
    expect(
      within(screen.getAllByTestId('event-audit-timeline-item')[1]).getByText('Pending')
    ).toBeInTheDocument();
    expect(screen.getByText('+2s').closest('.ant-tag')).toBeNull();
  });
});
