import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import { ThemeProvider } from '../app/theme-provider';
import {
  TraceRequestResponseTabs,
  TraceViewer,
  type TraceViewTab,
} from '../features/integrations/components/TraceViewer';

const mockApi = vi.hoisted(() => ({ getExecutionLogTimeline: vi.fn() }));
vi.mock('../services/api', () => mockApi);

const tabs = (includeError = true): TraceViewTab[] => [
  { key: 'request', label: 'Request', children: <div>Request payload</div> },
  { key: 'response', label: 'Response', children: <div>Response payload</div> },
  ...(includeError ? [{ key: 'error', label: 'Error Details', children: <div>Error payload</div> }] : []),
];

describe('TraceRequestResponseTabs', () => {
  it('links selected tabs to panels and retains visited trace payloads', () => {
    const { container } = render(<TraceRequestResponseTabs items={tabs()} />);
    const requestTab = screen.getByRole('tab', { name: 'Request' });
    const requestPanel = container.querySelector('#trace-view-request-panel')!;
    expect(requestTab).toHaveAttribute('aria-selected', 'true');
    expect(requestTab).toHaveAttribute('aria-controls', requestPanel.id);

    fireEvent.click(screen.getByRole('tab', { name: 'Response' }));
    expect(container.querySelector('#trace-view-response-panel')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Request' }));
    expect(requestPanel).toBeVisible();
    expect(container.querySelector('#trace-view-response-panel')).not.toBeVisible();
  });

  it('returns to Request when the selected optional error tab disappears', async () => {
    const { container, rerender } = render(<TraceRequestResponseTabs items={tabs()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Error Details' }));
    expect(container.querySelector('#trace-view-error-panel')).toBeVisible();

    rerender(<TraceRequestResponseTabs items={tabs(false)} />);
    expect(await screen.findByRole('tab', { name: 'Request' })).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('#trace-view-request-panel')).toBeVisible();
  });
});

describe('TraceViewer metadata presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getExecutionLogTimeline.mockResolvedValue({
      summary: {
        traceId: 'trace-1',
        status: 'SUCCESS',
        direction: 'OUTBOUND',
        triggerType: 'MANUAL',
        totalDuration: 350,
        startedAt: '2026-11-24T10:00:00.000Z',
        finishedAt: '2026-11-24T10:00:01.000Z',
        stepCount: 1,
        errorStep: null,
      },
      timeline: [
        {
          name: 'transform',
          timestamp: '2026-11-24T10:00:00.500Z',
          durationMs: 24,
          status: 'SUCCESS',
          gapMs: null,
          metadata: { transformed: true },
          response: { statusCode: 202, body: { accepted: true } },
        },
      ],
      request: { url: 'https://target.example.test/events', method: 'POST', body: { id: 'event-1' } },
      response: { statusCode: 202, body: { accepted: true } },
      error: null,
      vendorResponses: [
        {
          stage: 'delivery',
          status: 'SUCCESS',
          timestamp: '2026-11-24T10:00:01.000Z',
          provider: 'example',
          channel: null,
          responseStatus: 202,
          messageId: 'vendor-1',
          target: 'events',
          responseBody: { accepted: true },
        },
      ],
    });
  });

  it('renders delivery state as a status badge and diagnostic values without Tags or Alerts', async () => {
    render(
      <ThemeProvider>
        <App>
          <TraceViewer traceId="trace-1" open onClose={() => undefined} />
        </App>
      </ThemeProvider>
    );

    expect(await screen.findByText('Execution Summary')).toBeInTheDocument();
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
    expect(screen.getByText('202')).toBeInTheDocument();
    expect(document.body.querySelectorAll('.ant-tag')).toHaveLength(0);
    expect(document.body.querySelectorAll('.ant-alert')).toHaveLength(0);
  });
});
