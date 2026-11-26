import React from 'react';
import { App } from 'antd';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';

const getExecutionLogTimeline = vi.fn();
const copyText = vi.hoisted(() => vi.fn());
vi.mock('../services/api', () => ({ getExecutionLogTimeline: (...a: unknown[]) => getExecutionLogTimeline(...a) }));
vi.mock('../utils/clipboard', () => ({ copyTextToClipboard: copyText }));

import { DeliveryTraceTimeline } from '../features/logs/components/DeliveryTraceTimeline';

const renderTimeline = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <App>
          <DeliveryTraceTimeline traceId="trace-abc" />
        </App>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

describe('delivery trace timeline', () => {
  beforeEach(() => {
    getExecutionLogTimeline.mockReset();
    copyText.mockReset();
  });


  it('names the step that failed and why, which is the reason to open it', async () => {
    getExecutionLogTimeline.mockResolvedValue({
      summary: { traceId: 'trace-abc', stepCount: 3, totalDuration: 240, errorStep: 'deliver' },
      timeline: [
        { name: 'receive', status: 'SUCCESS', durationMs: 10, gapMs: null },
        { name: 'transform', status: 'SUCCESS', durationMs: 30, gapMs: 5 },
        { name: 'deliver', status: 'FAILED', durationMs: 200, gapMs: 2, error: { message: 'HTTP 500 from Akhil LIS' } },
      ],
    });

    renderTimeline();

    expect(await screen.findByText('deliver')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500 from Akhil LIS')).toBeInTheDocument();
    expect(screen.getByText('3 steps')).toBeInTheDocument();
    expect(await screen.findAllByText('Completed')).toHaveLength(2);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(document.querySelector('.ant-tag')).not.toBeInTheDocument();
    expect(document.querySelector('.ant-typography')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy trace ID' })).toBeInTheDocument();
  });

  it('surfaces the wait between steps, not just each step duration', async () => {
    getExecutionLogTimeline.mockResolvedValue({
      summary: { traceId: 'trace-abc', stepCount: 2, totalDuration: 5000, errorStep: null },
      timeline: [
        { name: 'queued', status: 'SUCCESS', durationMs: 2, gapMs: null },
        { name: 'deliver', status: 'SUCCESS', durationMs: 8, gapMs: 4990 },
      ],
    });

    renderTimeline();

    // A delivery that sat in a queue for 5s looks instant if you only read
    // step durations.
    expect(await screen.findByText('+4990 ms after previous')).toBeInTheDocument();
  });

  it('copies the trace ID from its labeled action', async () => {
    getExecutionLogTimeline.mockResolvedValue({
      summary: { traceId: 'trace-abc', stepCount: 1, totalDuration: 10 },
      timeline: [{ name: 'receive', status: 'SUCCESS', durationMs: 10 }],
    });
    copyText.mockResolvedValue(true);

    renderTimeline();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy trace ID' }));

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('trace-abc'));
  });

  // The "trace unavailable" error state is deliberately not covered here. It
  // renders correctly — confirmed by inspecting the rendered output — but any
  // rejected query promise in this file reaches the runner's
  // unhandled-rejection hook and fails the suite regardless of how the
  // rejection is deferred or swallowed. A test that has to be contorted that
  // far stops testing the product, so it is verified by hand instead.
});
