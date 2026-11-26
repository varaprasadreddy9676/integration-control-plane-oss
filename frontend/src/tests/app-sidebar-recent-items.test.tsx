import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppSidebar } from '../components/layout/AppSidebar';
import { ThemeProvider } from '../app/theme-provider';

const navGroups = [
  {
    label: 'Main',
    items: [
      { key: '/logs', icon: <span />, label: 'Logs' },
      { key: '/settings', icon: <span />, label: 'Settings' },
    ],
  },
];

describe('AppSidebar navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps navigation focused on the canonical groups without duplicate recent or search entries', () => {
    render(
      <ThemeProvider>
        <AppSidebar
          collapsed={false}
          isMobile={false}
          navGroups={navGroups}
          activeKey="/logs"
          onNavigate={vi.fn()}
          onToggle={vi.fn()}
        />
      </ThemeProvider>
    );

    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /search pages/i })).not.toBeInTheDocument();
  });

  it('preserves route navigation from the canonical group', () => {
    const onNavigate = vi.fn();

    render(
      <ThemeProvider>
        <AppSidebar
          collapsed={false}
          isMobile={false}
          navGroups={navGroups}
          activeKey="/logs"
          onNavigate={onNavigate}
          onToggle={vi.fn()}
        />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByText('Settings'));

    expect(onNavigate).toHaveBeenCalledWith('/settings');
    expect(screen.getByText('Main')).toBeInTheDocument();
  });

  it('uses a design-system section toggle that collapses and restores its routes', () => {
    render(
      <ThemeProvider>
        <AppSidebar
          collapsed={false}
          isMobile={false}
          navGroups={navGroups}
          activeKey="/logs"
          onNavigate={vi.fn()}
          onToggle={vi.fn()}
        />
      </ThemeProvider>
    );

    const collapseGroup = screen.getByRole('button', { name: 'Collapse Main' });
    expect(collapseGroup).toHaveAttribute('aria-expanded', 'true');
    expect(collapseGroup).toHaveClass('app-sidebar__group-toggle');

    fireEvent.click(collapseGroup);
    expect(screen.queryByText('Logs')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Main' })).toHaveAttribute('aria-expanded', 'false');
    expect(window.localStorage.getItem('sidebar-collapsed-groups')).toContain('"Main":true');

    fireEvent.click(screen.getByRole('button', { name: 'Expand Main' }));
    expect(screen.getByText('Logs')).toBeInTheDocument();
  });

  it('keeps collapse beside the expanded brand and exposes expand from the collapsed rail', () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <AppSidebar
          collapsed={false}
          isMobile={false}
          navGroups={navGroups}
          activeKey="/logs"
          onNavigate={vi.fn()}
          onToggle={vi.fn()}
        />
      </ThemeProvider>
    );

    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse.closest('.astryx-side-nav-heading')).not.toBeNull();
    expect(container.querySelector('.app-sidebar__collapse-row')).not.toBeInTheDocument();

    rerender(
      <ThemeProvider>
        <AppSidebar
          collapsed
          isMobile={false}
          navGroups={navGroups}
          activeKey="/logs"
          onNavigate={vi.fn()}
          onToggle={vi.fn()}
        />
      </ThemeProvider>
    );

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(container.querySelector('.app-sidebar__collapse-row')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
  });

  it('keeps platform administration collapsed by default and reveals it for an active admin route', () => {
    const adminGroups = [
      {
        label: 'Administration',
        items: [
          { key: '/admin/users', icon: <span />, label: 'User Management' },
          { key: '/admin/roles', icon: <span />, label: 'Role Management' },
        ],
      },
    ];
    const { rerender } = render(
      <ThemeProvider>
        <AppSidebar
          collapsed={false}
          isMobile={false}
          navGroups={adminGroups}
          activeKey="/dashboard"
          onNavigate={vi.fn()}
          onToggle={vi.fn()}
        />
      </ThemeProvider>
    );

    expect(screen.getByRole('button', { name: 'Expand Administration' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('User Management')).not.toBeInTheDocument();

    rerender(
      <ThemeProvider>
        <AppSidebar
          collapsed={false}
          isMobile={false}
          navGroups={adminGroups}
          activeKey="/admin/users"
          onNavigate={vi.fn()}
          onToggle={vi.fn()}
        />
      </ThemeProvider>
    );

    expect(screen.getByRole('button', { name: 'Collapse Administration' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(window.localStorage.getItem('sidebar-collapsed-groups')).toContain('Administration');
  });

  it('does not hide navigation groups on mobile, where group toggles are unavailable', () => {
    const adminGroups = [
      {
        label: 'Administration',
        items: [{ key: '/admin/users', icon: <span />, label: 'User Management' }],
      },
    ];

    render(
      <ThemeProvider>
        <AppSidebar
          collapsed={false}
          isMobile
          navGroups={adminGroups}
          activeKey="/dashboard"
          onNavigate={vi.fn()}
          onToggle={vi.fn()}
        />
      </ThemeProvider>
    );

    expect(screen.getByText('User Management')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand Administration' })).not.toBeInTheDocument();
  });
});
