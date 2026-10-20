import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
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

describe('AppSidebar recent-items effect', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not trigger a "Maximum update depth exceeded" render loop', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ThemeProvider>
        <AppSidebar
          collapsed={false}
          isMobile={false}
          navGroups={navGroups}
          activeKey="/logs"
          onNavigate={() => {}}
          onToggle={() => {}}
        />
      </ThemeProvider>
    );

    const loopWarning = errorSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('Maximum update depth exceeded'))
    );

    expect(loopWarning).toBe(false);
  });
});
