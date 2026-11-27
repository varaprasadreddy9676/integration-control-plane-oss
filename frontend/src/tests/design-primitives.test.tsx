import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { ContextRail, Metric, MetricStrip, Panel, Row, RowList, SectionHeading, Toolbar } from '../design-system/primitives';

const wrap = (ui: React.ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('design primitives', () => {
  it('renders a panel with one heading, a description and an action slot', () => {
    wrap(
      <Panel title="Delivery trend" description="Daily volume" actions={<button type="button">Export</button>}>
        <p>body</p>
      </Panel>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Delivery trend' })).toBeInTheDocument();
    expect(screen.getByText('Daily volume')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('colours only the value of a failing metric', () => {
    const { container } = wrap(
      <MetricStrip>
        <Metric label="Deliveries" value="1,284" change="+16.7%" detail="1,271 delivered" />
        <Metric label="Failed" value="3" tone="bad" detail="2 integrations" />
      </MetricStrip>,
    );

    const metrics = container.querySelectorAll('.ds-metric');
    expect(metrics).toHaveLength(2);
    expect(metrics[0].getAttribute('data-tone')).toBe('neutral');
    expect(metrics[1].getAttribute('data-tone')).toBe('bad');
    expect(screen.getByText('1,284')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders a drill-down metric as a button with a spoken name', () => {
    wrap(
      <MetricStrip>
        <Metric label="Failed" value="3" tone="bad" onClick={() => undefined} ariaLabel="View failed deliveries: 3" />
      </MetricStrip>,
    );

    const button = screen.getByRole('button', { name: 'View failed deliveries: 3' });
    expect(button.className).toContain('ds-metric');
    expect(button.getAttribute('data-tone')).toBe('bad');
  });

  it('passes layout styles through without owning colour or spacing', () => {
    const { container } = wrap(
      <Panel title="Constrained" style={{ width: 320 }}>
        <p>body</p>
      </Panel>,
    );

    const panel = container.querySelector('.ds-panel') as HTMLElement;
    expect(panel.style.width).toBe('320px');
  });

  it('groups repeatable items as a labelled list of divided rows', () => {
    wrap(
      <RowList label="Pre-delivery checks">
        <Row title="Check 1" actions={<button type="button">Remove</button>}>
          <input aria-label="URL" />
        </Row>
        <Row title="Check 2">body</Row>
      </RowList>,
    );

    expect(screen.getByRole('list', { name: 'Pre-delivery checks' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.getByLabelText('URL')).toBeInTheDocument();
  });

  it('separates filters from commands in a toolbar', () => {
    wrap(
      <Toolbar actions={<button type="button">Refresh</button>}>
        <input aria-label="Search" />
      </Toolbar>,
    );

    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('names the context rail as a complementary landmark', () => {
    wrap(
      <ContextRail label="Integration status">
        <p>Last run 12:28</p>
      </ContextRail>,
    );

    expect(screen.getByRole('complementary', { name: 'Integration status' })).toBeInTheDocument();
  });

  it('keeps the section heading level configurable for nesting', () => {
    wrap(
      <>
        <SectionHeading title="Theme" description="Five characters" />
        <SectionHeading title="Nested" level={3} />
      </>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Nested' })).toBeInTheDocument();
  });
});
