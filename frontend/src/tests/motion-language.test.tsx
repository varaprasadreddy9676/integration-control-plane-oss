import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { AnimatedNumber, formatFigure, parseFigure } from '../components/motion/AnimatedNumber';

const setReducedMotion = (reduce: boolean) => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList
  );
};

afterEach(() => vi.restoreAllMocks());

describe('AnimatedNumber figures', () => {
  it.each([
    ['1,234', 1234, 0, '1,234'],
    ['98.2%', 98.2, 1, '98.2%'],
    ['142 ms', 142, 0, '142 ms'],
    ['-3', 3, 0, '-3'],
  ])('keeps the formatting of %s', (input, value, decimals, formatted) => {
    const figure = parseFigure(input);
    expect(figure).toMatchObject({ value, decimals });
    expect(formatFigure(value, figure!)).toBe(formatted);
  });

  it.each(['—', '3m 12s', '$40', ''])('leaves %j alone rather than half-animating it', (input) => {
    expect(parseFigure(input)).toBeNull();
  });

  it('shows the final value at once under reduced motion', () => {
    setReducedMotion(true);
    render(<AnimatedNumber value="1,234" />);
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('counts up to the final value', async () => {
    setReducedMotion(false);
    render(<AnimatedNumber value="1,234" />);
    await waitFor(() => expect(screen.getByText('1,234')).toBeInTheDocument(), { timeout: 2000 });
  });

  it('still lands on the true value when animation frames never fire (background tab)', () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      render(<AnimatedNumber value="6" />);
      expect(screen.getByText('0')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('6')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders placeholders untouched', () => {
    render(<AnimatedNumber value="—" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
