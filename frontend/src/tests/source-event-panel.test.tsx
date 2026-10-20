import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { hasSourceEvent, SourceEventPanel } from '../features/logs/components/SourceEventPanel';
import { APIError } from '../services/api';

let nextResult: () => Promise<unknown> = () => Promise.resolve(null);

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return { ...actual, getEventAuditById: () => nextResult() };
});

vi.mock('../design-system/utils', () => ({
  cssVar: {
    border: { default: '#d1d5db' },
    bg: { surface: '#ffffff' },
    legacy: {
      error: { 500: '#ef4444' },
      success: { 500: '#22c55e' },
      warning: { 500: '#f59e0b' },
      primary: { 500: '#3b82f6' },
      neutral: { 50: '#f8fafc', 200: '#e5e7eb', 900: '#111827' },
    },
  },
  useDesignTokens: () => ({
    token: { borderRadius: 8, borderRadiusLG: 12 },
    themeColors: {},
    spacing: { '1': '4px', '2': '8px', '3': '12px' },
  }),
  withAlpha: (color: string) => color,
  spacingToNumber: (value: string | number) => Number.parseInt(String(value), 10) || 0,
}));

const renderPanel = (messageId: string, fallbackPayload?: unknown) => {
  window.history.pushState({}, '', '/integration-gateway/logs?orgId=1082');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BrowserRouter basename="/integration-gateway">
        <SourceEventPanel messageId={messageId} fallbackPayload={fallbackPayload} />
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('hasSourceEvent', () => {
  it('is true for a real message id', () => {
    expect(hasSourceEvent({ messageId: 'evt-1' })).toBe(true);
  });
  it('is false without a message id', () => {
    expect(hasSourceEvent({ messageId: null })).toBe(false);
    expect(hasSourceEvent({})).toBe(false);
  });
  it('is false for replay ids, which have no source event', () => {
    expect(hasSourceEvent({ messageId: 'replay_123' })).toBe(false);
  });

  it('is false for inbound calls and script jobs, which never come from an event', () => {
    expect(hasSourceEvent({ messageId: 'req_1987654321910_x', direction: 'INBOUND' })).toBe(false);
    expect(hasSourceEvent({ messageId: 'scriptjob_1_2', direction: 'SCRIPT_JOB' })).toBe(false);
    expect(hasSourceEvent({ messageId: 'evt-1', direction: 'OUTBOUND' })).toBe(true);
  });
});

describe('SourceEventPanel', () => {
  it('shows the source event and links to Event Audit with org preserved', async () => {
    nextResult = () =>
      Promise.resolve({
        eventId: 'evt-1',
        eventType: 'OP_VISIT_CREATED',
        source: 'mysql_event_source',
        status: 'SKIPPED',
        skipReason: 'No matching integration',
        receivedAt: '2026-10-06T09:24:43Z',
        payload: { visitId: 42 },
      });
    renderPanel('evt-1');
    expect(await screen.findByText('OP_VISIT_CREATED')).toBeTruthy();
    expect(screen.getByText(/No matching integration/)).toBeTruthy();
    expect(screen.getByText(/"visitId": 42/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /open in event audit/i });
    expect(link.getAttribute('href')).toContain('/events');
    expect(link.getAttribute('href')).toContain('eventId=evt-1');
    expect(link.getAttribute('href')).toContain('orgId=1082');
  });

  it('explains when the audit record has aged out (404)', async () => {
    nextResult = async () => {
      throw new APIError('Not found', 404);
    };
    renderPanel('evt-gone');
    expect(await screen.findByText(/no longer available/i)).toBeTruthy();
  });

  it('shows a retryable error for other failures', async () => {
    nextResult = async () => {
      throw new APIError('boom', 500);
    };
    renderPanel('evt-1');
    await waitFor(() => expect(screen.getByText(/couldn.t load the source event/i)).toBeTruthy());
  });

  it('falls back to the delivery log payload when the audit kept none', async () => {
    nextResult = () =>
      Promise.resolve({
        eventId: 'evt-1',
        eventType: 'OP_VISIT_CREATED',
        source: 'mysql',
        status: 'SKIPPED',
        payloadSummary: {},
      });
    renderPanel('evt-1', { visitId: 99 });
    expect(await screen.findByText(/"visitId": 99/)).toBeTruthy();
    expect(screen.getByText(/from this delivery/i)).toBeTruthy();
  });
});
