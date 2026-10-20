import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import { ThemeProvider } from '../app/theme-provider';
import { DeliveryReliabilitySummary } from '../features/integrations/routes/integrationDetail/components/DeliveryReliabilitySummary';

// Regression test: viewing an outbound integration without clicking "Edit" wrapped
// the whole Reliability tab in <fieldset disabled>, so the "Advanced" mode toggle
// and the "Rate Limiting" switch silently did nothing — no console error, no visual
// cue, just a genuinely disabled native control. Fixed by rendering a read-only
// summary (matching the existing Review & Submit tab pattern) instead of a
// disabled copy of the edit form when isReadOnly is true.

const spacing = { 1: '4px', 2: '8px', 3: '12px', 4: '16px' };

const renderSummary = (initialValues: Record<string, unknown>) => {
  const Wrapper = () => {
    const [form] = Form.useForm();
    return (
      <ThemeProvider>
        <Form form={form} initialValues={initialValues}>
          <DeliveryReliabilitySummary uiConfig={{}} spacing={spacing} form={form} />
        </Form>
      </ThemeProvider>
    );
  };
  return render(<Wrapper />);
};

describe('DeliveryReliabilitySummary (read-only Reliability tab)', () => {
  it('shows the configured timeout, retry count, and disabled rate limiting as plain text/tags', () => {
    renderSummary({ timeoutMs: 15000, retryCount: 2, rateLimits: { enabled: false } });

    expect(
      screen.getByText((_, el) => el?.children.length === 0 && el?.textContent === '15000 ms')
    ).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('shows max requests and window seconds when rate limiting is enabled', () => {
    renderSummary({
      timeoutMs: 30000,
      retryCount: 3,
      rateLimits: { enabled: true, maxRequests: 250, windowSeconds: 30 },
    });

    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });
});
