import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { PageTemplate } from '../components/common/PageTemplate';

describe('PageTemplate', () => {
  it('provides a shared page shell for title, description, actions, and content', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <PageTemplate
            title="Lookup statistics"
            description="Usage and recent activity."
            actions={<button type="button">Refresh</button>}
            contentClassName="lookup-stats-content"
          >
            <div>Page content</div>
          </PageTemplate>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId('page-template')).toHaveClass('page-template');
    expect(screen.getByRole('main')).toBe(screen.getByTestId('page-template'));
    expect(screen.getByRole('heading', { name: 'Lookup statistics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lookup statistics' })).toHaveClass('page-header-title');
    expect(screen.getByText('Usage and recent activity.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByText('Page content').parentElement).toHaveClass(
      'page-template__content',
      'lookup-stats-content'
    );
  });

  it('supports a route-owned header while keeping the shared content boundary', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <PageTemplate header={<header>Live dashboard controls</header>} contentClassName="dashboard-template-content">
            <div>Dashboard content</div>
          </PageTemplate>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId('page-template')).toContainElement(screen.getByText('Live dashboard controls'));
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('Dashboard content').parentElement).toHaveClass(
      'page-template__content',
      'dashboard-template-content'
    );
  });

  it('uses a div when embedded inside another route instead of nesting main landmarks', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <PageTemplate as="div" className="embedded-page-template">
            <div>Embedded content</div>
          </PageTemplate>
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId('page-template').tagName).toBe('DIV');
    expect(document.querySelector('main')).not.toBeInTheDocument();
  });
});
