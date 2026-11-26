import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getStatusLabel, StatusBadge } from '../components/common/StatusBadge';
import { ThemeProvider } from '../app/theme-provider';

const renderWithTheme = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('StatusBadge delivery vocabulary', () => {
  it('renders queued as Pending with one semantic dot, not a status icon or colored chip', () => {
    const { container } = renderWithTheme(<StatusBadge status="QUEUED" />);

    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(container.querySelector('.status-badge__dot')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.anticon')).toBeNull();
    expect(container.querySelector('.status-badge')).toHaveAttribute('data-variant', 'neutral');
    expect(container.querySelector('.status-badge')).toHaveClass('status-badge--tone-warning');
  });

  it('gives QUEUED the same warning tone as PENDING, not the generic default tone', () => {
    const { container: queuedContainer } = renderWithTheme(<StatusBadge status="QUEUED" />);
    const { container: pendingContainer } = renderWithTheme(<StatusBadge status="PENDING" />);

    const queuedTag = queuedContainer.querySelector('.status-badge') as HTMLElement;
    const pendingTag = pendingContainer.querySelector('.status-badge') as HTMLElement;

    expect(queuedTag.dataset.variant).toBe(pendingTag.dataset.variant);
  });

  it('still falls back gracefully for a genuinely unknown status', () => {
    // Regression guard: unknown statuses should degrade to the neutral default tone,
    // not throw, so a truly new/unexpected backend status doesn't crash the UI.
    expect(() => renderWithTheme(<StatusBadge status={'SOMETHING_NEW' as any} />)).not.toThrow();
  });

  it.each([
    ['SUCCESS', 'Delivered'],
    ['FAILED', 'Failed'],
    ['SKIPPED', 'Skipped'],
    ['PENDING', 'Pending'],
    ['RETRYING', 'Retrying'],
    ['ABANDONED', 'Abandoned'],
  ])('maps %s to %s', (status, label) => {
    renderWithTheme(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each([
    ['RECEIVED', 'Pending'],
    ['PROCESSING', 'Pending'],
    ['DELIVERED', 'Delivered'],
    ['STUCK', 'Failed'],
  ])('returns sentence-case filter label %s as %s', (status, label) => {
    expect(getStatusLabel(status)).toBe(label);
  });
});
