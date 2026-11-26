import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../app/theme-provider';
import { StatusBadge } from '../components/common/StatusBadge';

describe('StatusBadge', () => {
  it('uses the Astryx badge component and keeps the full label accessible', () => {
    const { container } = render(
      <ThemeProvider>
        <StatusBadge label="Configured & Running" variant="success" />
      </ThemeProvider>
    );

    expect(screen.getByText('Configured & Running')).toBeInTheDocument();
    expect(container.querySelector('span.status-badge')).toHaveAttribute('title', 'Configured & Running');
  });

  it('supports neutral fallback states without losing their text', () => {
    render(
      <ThemeProvider>
        <StatusBadge label="Unknown" />
      </ThemeProvider>
    );

    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
