import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '../app/theme-provider';
import { StatPillRow } from '../components/common/StatPillRow';

describe('StatPillRow', () => {
  it('uses accessible buttons and applies the selected filter', () => {
    const onFilterChange = vi.fn();
    render(
      <ThemeProvider>
        <StatPillRow
          items={[
            { title: 'Total', value: 12, icon: <span>all</span>, tone: 'var(--color-text-secondary)', filterValue: null },
            { title: 'Failed', value: 2, icon: <span>error</span>, tone: 'var(--color-error-text)', filterValue: 'FAILED' },
          ]}
          activeFilter={undefined}
          onFilterChange={onFilterChange}
        />
      </ThemeProvider>
    );

    const failed = screen.getByRole('button', { name: /Filter by Failed/ });
    expect(failed).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(failed);
    expect(onFilterChange).toHaveBeenCalledWith('FAILED');
  });
});
