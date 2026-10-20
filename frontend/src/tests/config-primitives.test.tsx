import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../app/theme-provider';
import { ConfigSection } from '../components/common/ConfigSection';
import { ConfigGrid } from '../components/common/ConfigGrid';
import { ConfigFieldHelp } from '../components/common/ConfigFieldHelp';

const useBreakpointMock = vi.fn();

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Grid: { ...actual.Grid, useBreakpoint: () => useBreakpointMock() },
  };
});

describe('ConfigSection', () => {
  it('renders the title, description, and children', () => {
    render(
      <ThemeProvider>
        <ConfigSection title="Rate Limiting" description="Configure request throttling">
          <div>field content</div>
        </ConfigSection>
      </ThemeProvider>
    );

    expect(screen.getByText('Rate Limiting')).toBeInTheDocument();
    expect(screen.getByText('Configure request throttling')).toBeInTheDocument();
    expect(screen.getByText('field content')).toBeInTheDocument();
  });

  it('omits the description block when none is given', () => {
    render(
      <ThemeProvider>
        <ConfigSection title="Rate Limiting">
          <div>field content</div>
        </ConfigSection>
      </ThemeProvider>
    );

    expect(screen.getByText('Rate Limiting')).toBeInTheDocument();
    expect(screen.queryByText('Configure request throttling')).not.toBeInTheDocument();
  });
});

describe('ConfigGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lays fields out in the requested number of columns at desktop widths', () => {
    useBreakpointMock.mockReturnValue({ xs: true, sm: true, md: true, lg: true, xl: true, xxl: false });

    render(
      <ThemeProvider>
        <ConfigGrid columns={2}>
          <div>Field A</div>
          <div>Field B</div>
        </ConfigGrid>
      </ThemeProvider>
    );

    const grid = screen.getByText('Field A').parentElement as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, 1fr)');
  });

  it('collapses to a single column below the md breakpoint', () => {
    useBreakpointMock.mockReturnValue({ xs: true, sm: true, md: false, lg: false, xl: false, xxl: false });

    render(
      <ThemeProvider>
        <ConfigGrid columns={2}>
          <div>Field A</div>
          <div>Field B</div>
        </ConfigGrid>
      </ThemeProvider>
    );

    const grid = screen.getByText('Field A').parentElement as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('1fr');
  });
});

describe('ConfigFieldHelp', () => {
  it('renders its content', () => {
    render(
      <ThemeProvider>
        <ConfigFieldHelp>Unique identifier for this integration type</ConfigFieldHelp>
      </ThemeProvider>
    );

    expect(screen.getByText('Unique identifier for this integration type')).toBeInTheDocument();
  });
});
