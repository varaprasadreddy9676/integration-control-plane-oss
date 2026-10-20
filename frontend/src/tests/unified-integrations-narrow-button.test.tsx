import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';

// Regression test: at narrow viewport widths the "New Integration" button competed with
// the tab labels for a single row — confirmed live via getBoundingClientRect showing a
// 336px-wide .ant-tabs-nav-wrap clipping a 623px-wide .ant-tabs-nav-list.
//
// The first fix rendered the button icon-only below `md`. That was later superseded: the
// button now moves out of the tab bar entirely into the page header, full width, keeping
// its label. Both fixes solve the same collision, so this asserts the mechanism actually
// in use — the button must not sit in the tab bar row when narrow.

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

  it('moves the button out of the tab bar and into the header, full width, when narrow', async () => {
    useBreakpointMock.mockReturnValue({ xs: true, sm: true, md: false, lg: false, xl: false, xxl: false });

    await renderRoute();

    const button = screen.getByRole('button', { name: 'New Integration' });
    // Rendered through PageHeader's actions slot rather than the tab bar, so the
    // three tabs get the whole row.
    expect(screen.getByTestId('header-actions')).toContainElement(button);
    // Full-width, which is only sensible once it is off the tab row.
    expect(button.className).toContain('ant-btn-block');
  });

  it('does not put the button in the tab bar extra content when narrow', async () => {
    useBreakpointMock.mockReturnValue({ xs: true, sm: true, md: false, lg: false, xl: false, xxl: false });

    const { container } = await renderRoute();

    const tabBar = container.querySelector('.ant-tabs-nav');
    const button = screen.getByRole('button', { name: 'New Integration' });
    expect(tabBar).not.toBeNull();
    expect(tabBar).not.toContainElement(button);
  });

  it('keeps the labelled button in the tab bar row when there is room', async () => {
    useBreakpointMock.mockReturnValue({ xs: true, sm: true, md: true, lg: true, xl: true, xxl: false });

    await renderRoute();

    expect(screen.getByText('New Integration')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'New Integration' });
    // Not full-width when it shares the row with the tabs.
    expect(button.className).not.toContain('ant-btn-block');
    expect(screen.getByTestId('header-actions')).not.toContainElement(button);
  });
});
