import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';

// The primary action stays in the page header; Astryx TabList owns narrow-screen
// overflow so every integration type remains reachable without hiding labels.

const useBreakpointMock = vi.fn();

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Grid: { ...actual.Grid, useBreakpoint: () => useBreakpointMock() },
  };
});

vi.mock('../utils/navigation', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title, actions }: any) => (
    <div>
      <div>{title}</div>
      <div data-testid="header-actions">{actions}</div>
    </div>
  ),
}));

vi.mock('../features/integrations/routes/IntegrationsRoute', () => ({
  IntegrationsRoute: () => <div data-testid="outbound-stub" />,
}));

vi.mock('../features/inbound-integrations/routes/InboundIntegrationsRoute', () => ({
  InboundIntegrationsRoute: () => <div data-testid="inbound-stub" />,
}));

vi.mock('../features/scheduled-jobs/routes/ScheduledJobsRoute', () => ({
  ScheduledJobsRoute: () => <div data-testid="scheduled-stub" />,
}));

describe('UnifiedIntegrationsRoute — New Integration button at narrow widths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderRoute = async () => {
    const { UnifiedIntegrationsRoute } = await import('../features/integrations/routes/UnifiedIntegrationsRoute');
    return render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/integrations']}>
          <UnifiedIntegrationsRoute />
        </MemoryRouter>
      </ThemeProvider>
    );
  };

  it('keeps the primary action in the header and full width on narrow screens', async () => {
    useBreakpointMock.mockReturnValue({ xs: true, sm: true, md: false, lg: false, xl: false, xxl: false });

    await renderRoute();

    const button = screen.getByRole('button', { name: 'New Integration' });
    expect(screen.getByTestId('header-actions')).toContainElement(button);
    expect(button.style.getPropertyValue('--x-width')).toBe('100%');
    expect(screen.getByRole('tablist', { name: 'Integration types' })).not.toContainElement(button);
  });

  it('keeps all integration types visible and selectable on narrow screens', async () => {
    useBreakpointMock.mockReturnValue({ xs: true, sm: true, md: false, lg: false, xl: false, xxl: false });

    await renderRoute();

    expect(screen.getByRole('tab', { name: 'Outbound' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Inbound' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Scheduled' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Inbound' }));
    expect(screen.getByText('Proxy inbound requests with authentication and transformation.')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Inbound' })).toBeVisible();
  });

  it('keeps the labelled primary action in the header at desktop widths', async () => {
    useBreakpointMock.mockReturnValue({ xs: true, sm: true, md: true, lg: true, xl: true, xxl: false });

    await renderRoute();

    expect(screen.getByText('New Integration')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'New Integration' });
    expect(button.style.getPropertyValue('--x-width')).not.toBe('100%');
    expect(screen.getByTestId('header-actions')).toContainElement(button);
  });
});
