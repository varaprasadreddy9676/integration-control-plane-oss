import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { FilterBar } from '../components/common/FilterBar';
import { ListActions, SearchInput } from '../components/common/ListControls';

describe('Astryx list controls', () => {
  it('exposes a named search input and clears its controlled value', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ThemeProvider>
        <SearchInput value="appointment" onChange={onChange} label="Search deliveries" />
      </ThemeProvider>
    );

    const input = screen.getByRole('searchbox', { name: 'Search deliveries' });
    expect(input).toHaveValue('appointment');
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange.mock.calls[0][0]).toBe('');

    rerender(
      <ThemeProvider>
        <SearchInput value="" onChange={onChange} label="Search deliveries" />
      </ThemeProvider>
    );
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
  });

  it('keeps list reset and refresh actions accessible and wired', () => {
    const onReset = vi.fn();
    const onRefresh = vi.fn();
    render(
      <ThemeProvider>
        <ListActions onReset={onReset} onRefresh={onRefresh} refreshLabel="Refresh integrations" />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh integrations' }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('provides a named search landmark and keeps secondary actions in the toolbar', () => {
    render(
      <ThemeProvider>
        <FilterBar rightSlot={<button type="button">Reset filters</button>}>
          <SearchInput value="" onChange={() => undefined} label="Search templates" />
          <button type="button">Category</button>
        </FilterBar>
      </ThemeProvider>
    );

    expect(screen.getByRole('search', { name: 'Filter results' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search templates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
  });
});
