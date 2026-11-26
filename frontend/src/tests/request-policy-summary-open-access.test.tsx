import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestPolicySummary } from '../features/integrations/components/detail/shared/RequestPolicySummary';

// Regression test: an inbound integration with no IP/origin restrictions and no rate limiting
// used to render a plain, untooltipped <Tag>Open</Tag> in compact mode — a security-relevant
// "accepts requests from any source" state with no visual urgency and no explanation. Keep it
// distinct as a warning status badge, while configuration counts stay neutral rather than colored.

describe('RequestPolicySummary — policy presentation', () => {
  it('renders a warning status badge for unrestricted access instead of a colored Tag', () => {
    const { container } = render(<RequestPolicySummary policy={null} compact />);

    expect(screen.getByText('Open access')).toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();

    expect(container.querySelector('.status-badge--tone-warning')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')).not.toBeInTheDocument();
  });

  it('shows an explanatory security tooltip on hover', async () => {
    render(<RequestPolicySummary policy={null} compact />);

    await userEvent.hover(screen.getByText('Open access'));

    expect(
      await screen.findByText(
        'No IP/origin restrictions or rate limiting configured — accepts requests from any source'
      )
    ).toBeInTheDocument();
  });

  it('falls back to the plain emptyLabel text in non-compact mode (no tag, no tooltip)', () => {
    render(<RequestPolicySummary policy={null} compact={false} emptyLabel="No request policy" />);

    expect(screen.getByText('No request policy')).toBeInTheDocument();
    expect(screen.queryByText('Open access')).not.toBeInTheDocument();
  });

  it('renders configured policy counts as neutral text instead of colored Tags', () => {
    const { container } = render(
      <RequestPolicySummary
        compact
        policy={{
          allowedIpCidrs: ['10.0.0.0/8'],
          allowedBrowserOrigins: ['https://example.test'],
          rateLimit: { enabled: true, maxRequests: 20, windowSeconds: 60 },
        }}
      />
    );

    expect(screen.getByText('1 IP rule')).toBeInTheDocument();
    expect(screen.getByText('1 origin')).toBeInTheDocument();
    expect(screen.getByText('20/60s')).toBeInTheDocument();
    expect(screen.queryByText('Open access')).not.toBeInTheDocument();
    expect(container.querySelector('.ant-tag')).not.toBeInTheDocument();
  });
});
