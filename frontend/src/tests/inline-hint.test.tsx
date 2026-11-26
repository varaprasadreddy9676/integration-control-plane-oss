import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { InlineHint } from '../components/common/InlineHint';

describe('InlineHint', () => {
  it('keeps error context distinct from routine information', () => {
    const { container } = render(
      <ThemeProvider>
        <InlineHint tone="error">Delivery failed</InlineHint>
      </ThemeProvider>,
    );

    expect(screen.getByText('Delivery failed')).toBeInTheDocument();
    expect(container.querySelector('[data-tone="error"]')).toBeInTheDocument();
  });
});
