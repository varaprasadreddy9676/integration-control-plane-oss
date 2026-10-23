import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeliveryFollowUpPanel, FollowUpTag } from '../features/logs/components/DeliveryFollowUpPanel';
import type { DeliveryFollowUp } from '../mocks/types';

const base: DeliveryFollowUp = { status: 'PENDING', done: false, checks: 0 };

describe('FollowUpTag', () => {
  it.each([
    ['DELIVERED', 'Delivered'],
    ['READ', 'Read'],
    ['FAILED', 'Not delivered'],
    ['SENT', 'Sent'],
    ['PENDING', 'Checking'],
    ['UNKNOWN', 'Unknown'],
  ] as const)('shows %s as "%s"', (status, label) => {
    render(<FollowUpTag followUp={{ ...base, status }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows nothing when there is no follow-up, or the delivery is not tracked', () => {
    const { container, rerender } = render(<FollowUpTag followUp={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FollowUpTag followUp={{ ...base, status: 'NOT_TRACKED', done: true }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DeliveryFollowUpPanel', () => {
  it('says nothing for a delivery without follow-up', () => {
    const { container } = render(<DeliveryFollowUpPanel followUp={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows when it was delivered and read, and that it is finished', () => {
    render(
      <DeliveryFollowUpPanel
        followUp={{
          status: 'READ',
          done: true,
          checks: 3,
          deliveredAt: '2026-10-22T10:00:20Z',
          readAt: '2026-10-22T10:00:40Z',
          lastCheckedAt: '2026-10-22T10:01:10Z',
        }}
      />
    );
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText(/^Delivered [A-Z][a-z]{2} \d/)).toBeInTheDocument();
    expect(screen.getByText(/^Read [A-Z][a-z]{2} \d/)).toBeInTheDocument();
    expect(screen.getByText(/3 checks so far/)).toBeInTheDocument();
    expect(screen.getByText(/finished/)).toBeInTheDocument();
  });

  it("shows the provider's error for a failed message", () => {
    render(
      <DeliveryFollowUpPanel
        followUp={{ status: 'FAILED', done: true, checks: 1, errorCode: '131026', errorMessage: 'Message undeliverable' }}
      />
    );
    expect(screen.getByText('Error 131026')).toBeInTheDocument();
    expect(screen.getByText('Message undeliverable')).toBeInTheDocument();
  });

  it('tells a pending message when the next check is, and not that it is finished', () => {
    render(
      <DeliveryFollowUpPanel
        followUp={{ status: 'SENT', done: false, checks: 1, nextCheckAt: '2026-10-22T10:05:00Z', lastCheckedAt: '2026-10-22T10:00:30Z' }}
      />
    );
    expect(screen.getByText(/next /)).toBeInTheDocument();
    expect(screen.queryByText(/finished/)).not.toBeInTheDocument();
  });

  it('shows why a check failed, so a broken script is visible', () => {
    render(<DeliveryFollowUpPanel followUp={{ status: 'UNKNOWN', done: true, checks: 4, lastError: 'Unrecognised Qikchat status "x"' }} />);
    expect(screen.getByText('The last check did not complete')).toBeInTheDocument();
    expect(screen.getByText('Unrecognised Qikchat status "x"')).toBeInTheDocument();
  });

  it('shows why tracking stopped when the script skipped it', () => {
    render(<DeliveryFollowUpPanel followUp={{ status: 'NOT_TRACKED', done: true, checks: 1, reason: 'No message id in the response' }} />);
    expect(screen.getByText('No message id in the response')).toBeInTheDocument();
  });
});
