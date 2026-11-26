import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EventType } from '../services/api';
import { EventDetailDrawer } from '../features/events/components/EventDetailDrawer';

vi.mock('antd', async (importOriginal) => {
  const antd = await importOriginal<typeof import('antd')>();
  const React = await import('react');
  return {
    ...antd,
    Drawer: ({ open, title, children }: { open: boolean; title: React.ReactNode; children: React.ReactNode }) =>
      open ? React.createElement('section', { role: 'dialog', 'aria-label': 'Event details' }, title, children) : null,
    Grid: { useBreakpoint: () => ({ md: true }) },
  };
});

vi.mock('../design-system/utils', () => ({
  cssVar: {
    legacy: {
      primary: { 600: '#2563eb' },
      neutral: { 100: '#f1f5f9', 800: '#1f2937' },
      info: { 50: '#f0f9ff', 600: '#0284c7', 700: '#0369a1', 900: '#0c4a6e' },
    },
    bg: { subtle: '#f8fafc' },
    table: { codeBg: '#f8fafc', codeBorder: '#e2e8f0' },
    text: { primary: '#111827' },
  },
  useDesignTokens: () => ({
    token: { borderRadius: 4, colorText: '#111827' },
    themeColors: {},
    spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px' },
  }),
  withAlpha: (color: string) => color,
  spacingToNumber: (value: string) => Number.parseInt(value, 10),
}));

vi.mock('../app/theme-provider', () => ({ useThemeMode: () => ({ mode: 'light' }) }));
vi.mock('../components/common/ModernTable', () => ({ ModernTable: () => <div>Schema table</div> }));
vi.mock('../components/common/StatePanel', () => ({ StatePanel: () => null }));
vi.mock('../components/common/LegacyButton', () => ({
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
}));

describe('EventDetailDrawer tabs', () => {
  it('associates each tab with its panel and switches the visible content', async () => {
    const event: EventType = {
      eventType: 'VISIT_CREATED',
      orgId: null,
      label: 'Visit Created',
      description: 'A visit was created',
      category: 'Visits',
      implementationClass: 'VisitCreatedEvent',
      fields: [{ name: 'visitId', path: 'visitId', type: 'string', required: true, description: 'Visit id' }],
      samplePayload: { visitId: 'visit-123' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const onClose = vi.fn();
    const onCreateIntegration = vi.fn();
    const { rerender, container } = render(
      <EventDetailDrawer open onClose={onClose} onCreateIntegration={onCreateIntegration} event={event} />
    );

    expect(screen.getByText('VISIT_CREATED')).toBeInTheDocument();
    expect(screen.getByText('Visits')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')).not.toBeInTheDocument();

    const schemaTab = screen.getByRole('tab', { name: 'Field Schema (1)' });
    const sampleTab = screen.getByRole('tab', { name: 'Sample Payload' });
    const schemaPanel = document.getElementById('event-detail-schema-panel');
    const samplePanel = document.getElementById('event-detail-sample-panel');

    expect(schemaTab).toHaveAttribute('aria-selected', 'true');
    expect(schemaTab).toHaveAttribute('aria-controls', 'event-detail-schema-panel');
    expect(schemaPanel).toBeVisible();
    expect(samplePanel).not.toBeVisible();

    fireEvent.click(sampleTab);

    expect(sampleTab).toHaveAttribute('aria-selected', 'true');
    expect(sampleTab).toHaveAttribute('aria-controls', 'event-detail-sample-panel');
    expect(samplePanel).toBeVisible();
    expect(samplePanel).toHaveTextContent('visit-123');
    expect(schemaPanel).not.toBeVisible();

    rerender(
      <EventDetailDrawer open={false} onClose={onClose} onCreateIntegration={onCreateIntegration} event={event} />
    );
    rerender(
      <EventDetailDrawer
        open
        onClose={onClose}
        onCreateIntegration={onCreateIntegration}
        event={{ ...event, eventType: 'VISIT_UPDATED' }}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Field Schema (1)' })).toHaveAttribute('aria-selected', 'true')
    );
  });
});
