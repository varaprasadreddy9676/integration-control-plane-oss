import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { PageHeader } from '../components/common/PageHeader';

describe('PageHeader Astryx typography', () => {
  it('uses semantic Astryx heading and supporting text without losing header content', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <PageHeader title="Outbound integrations" description="Manage event delivery." />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Outbound integrations' })).toBeInTheDocument();
    expect(screen.getByText('Manage event delivery.')).toBeInTheDocument();
  });

  it('keeps dense headers semantically distinct and compact', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <PageHeader title="Provider configuration" dense />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 5, name: 'Provider configuration' })).toBeInTheDocument();
  });

  it('omits a current-page breadcrumb that repeats the page title', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <PageHeader
            title="Partner Appointment Intake"
            breadcrumb={[
              { label: 'Inbound Integrations', path: '/inbound-integrations' },
              { label: 'Partner Appointment Intake' },
            ]}
          />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Partner Appointment Intake' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inbound Integrations' })).toBeInTheDocument();
    expect(screen.getAllByText('Partner Appointment Intake')).toHaveLength(1);
  });
});
