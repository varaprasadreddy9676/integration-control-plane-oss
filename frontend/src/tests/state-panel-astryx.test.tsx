import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { StatePanel } from '../components/common/StatePanel';

describe('StatePanel Astryx typography', () => {
  it('renders a semantic title, supporting copy, and action', () => {
    render(
      <ThemeProvider>
        <StatePanel
          glyph="searching"
          size="compact"
          title="No deliveries found"
          description="Try a different time range."
          actions={<button type="button">Clear filters</button>}
        />
      </ThemeProvider>
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 5, name: 'No deliveries found' })).toBeInTheDocument();
    expect(screen.getByText('Try a different time range.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});
