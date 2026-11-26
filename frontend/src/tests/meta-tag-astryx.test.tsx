import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../app/theme-provider';
import { MetaTag } from '../components/common/MetaTag';

describe('MetaTag', () => {
  it('renders HTTP method labels as visible Astryx badges with their full text', () => {
    const { container } = render(
      <ThemeProvider>
        <MetaTag variant="method" size="small">
          POST
        </MetaTag>
      </ThemeProvider>
    );

    const badge = container.querySelector('.meta-tag');
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-variant', 'blue');
    expect(badge).toHaveAttribute('title', 'POST');
  });

  it('maps error categories to the warning semantic variant', () => {
    const { container } = render(
      <ThemeProvider>
        <MetaTag variant="category">Timeout</MetaTag>
      </ThemeProvider>
    );

    expect(container.querySelector('.meta-tag')).toHaveAttribute('data-variant', 'warning');
  });
});
