import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestPolicySummary } from '../features/integrations/components/detail/shared/RequestPolicySummary';

// Regression test: an inbound integration with no IP/origin restrictions and no rate limiting
// used to render a plain, untooltipped <Tag>Open</Tag> in compact mode — a security-relevant
// "accepts requests from any source" state with no visual urgency and no explanation. Fixed to
// an orange "Open access" tag with an explanatory tooltip, matching the "No Auth" treatment
// added to the Authentication column at the same time.

describe('RequestPolicySummary — unrestricted policy in compact mode', () => {
  it('renders an orange "Open access" tag instead of the old plain "Open" tag', () => {
    const { container } = render(<RequestPolicySummary policy={null} compact />);

    expect(screen.getByText('Open access')).toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();

    const tag = container.querySelector('.ant-tag') as HTMLElement;
    expect(tag.className).toContain('ant-tag-orange');
  });

  it('shows an explanatory security tooltip on hover', async () => {
    render(<RequestPolicySummary policy={null} compact />);

    await userEvent.hover(screen.getByText('Open access'));

    expect(
      await screen.findByText('No IP/origin restrictions or rate limiting configured — accepts requests from any source')
    ).toBeInTheDocument();
  });

  it('falls back to the plain emptyLabel text in non-compact mode (no tag, no tooltip)', () => {
    render(<RequestPolicySummary policy={null} compact={false} emptyLabel="No request policy" />);

    expect(screen.getByText('No request policy')).toBeInTheDocument();
    expect(screen.queryByText('Open access')).not.toBeInTheDocument();
  });

  it('still renders IP/origin/rate-limit tags normally when a policy is configured', () => {
    render(
      <RequestPolicySummary
        compact
        policy={{
          allowedIpCidrs: ['10.0.0.0/8'],
          allowedBrowserOrigins: [],
          rateLimit: { enabled: false },
        }}
      />
    );

    expect(screen.getByText('1 IP rule')).toBeInTheDocument();
    expect(screen.queryByText('Open access')).not.toBeInTheDocument();
  });
});
