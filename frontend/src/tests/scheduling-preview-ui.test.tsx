import { App } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { SchedulingPreview } from '../features/integrations/components/detail/SchedulingPreview';

const mockApi = vi.hoisted(() => ({ testSchedulingScript: vi.fn() }));
vi.mock('../services/api', () => mockApi);

const renderPreview = () =>
  render(
    <ThemeProvider>
      <App>
        <SchedulingPreview script="return event.scheduledAt" deliveryMode="DELAYED" eventType="appointment.created" />
      </App>
    </ThemeProvider>
  );

describe('SchedulingPreview presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps sample metadata neutral and uses inline guidance instead of alerts', async () => {
    mockApi.testSchedulingScript.mockResolvedValue({
      success: true,
      deliveryMode: 'DELAYED',
      result: { scheduledFor: '2026-11-27T10:00:00.000Z', delayFromNow: 'in 3 days' },
      executionTimeMs: 14,
      samplePayload: { appointmentId: 'sample-1' },
    });
    const { container } = renderPreview();

    expect(await screen.findByText('Sample event data')).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-tag')).toHaveLength(0);
    expect(container.querySelectorAll('.ant-alert')).toHaveLength(0);
    expect(screen.getByText(/Actual scheduled time varies with real event data/)).toBeInTheDocument();
  });

  it('uses an error banner when the schedule script cannot run', async () => {
    mockApi.testSchedulingScript.mockRejectedValue(new Error('Invalid appointment date'));
    const { container } = renderPreview();

    expect(await screen.findByText('Scheduling script execution failed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Invalid appointment date')).toBeInTheDocument());
    expect(container.querySelectorAll('.ant-alert')).toHaveLength(0);
    expect(screen.getByText(/test with the fields your script expects/)).toBeInTheDocument();
  });
});
