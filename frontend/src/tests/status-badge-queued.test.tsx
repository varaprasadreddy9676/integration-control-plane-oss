import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../components/common/StatusBadge';
import { ThemeProvider } from '../app/theme-provider';

const renderWithTheme = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('StatusBadge QUEUED status', () => {
  it('renders QUEUED with an icon instead of falling back to the icon-less default', () => {
    const { container } = renderWithTheme(<StatusBadge status="QUEUED" />);

    expect(screen.getByText('QUEUED')).toBeInTheDocument();
    // AntD Tag only renders an .anticon when the `icon` prop is truthy.
    // Before the fix, QUEUED had no iconMap entry, so this would be absent.
    expect(container.querySelector('.anticon')).not.toBeNull();
  });

  it('gives QUEUED the same warning tone as PENDING, not the generic default tone', () => {
    const { container: queuedContainer } = renderWithTheme(<StatusBadge status="QUEUED" />);
    const { container: pendingContainer } = renderWithTheme(<StatusBadge status="PENDING" />);

    const queuedTag = queuedContainer.querySelector('.ant-tag') as HTMLElement;
    const pendingTag = pendingContainer.querySelector('.ant-tag') as HTMLElement;

    expect(queuedTag.style.color).toBe(pendingTag.style.color);
    expect(queuedTag.style.background).toBe(pendingTag.style.background);
  });

  it('still falls back gracefully for a genuinely unknown status', () => {
    // Regression guard: unknown statuses should degrade to the neutral default tone,
    // not throw, so a truly new/unexpected backend status doesn't crash the UI.
    expect(() => renderWithTheme(<StatusBadge status={'SOMETHING_NEW' as any} />)).not.toThrow();
  });
});
