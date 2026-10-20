import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Counts a figure to its new value, so a change on a refresh is noticed rather
 * than silently swapped. Accepts the already-formatted value the screens have
 * ("1,234", "98.2%", "142 ms", 57) and keeps its formatting; anything that is
 * not a number ("—", a node) renders untouched.
 */

const DURATION_MS = 700;
const NUMBER_PATTERN = /^(-?)([\d,]*\d)(\.\d+)?(\D*)$/;

interface ParsedFigure {
  value: number;
  decimals: number;
  grouped: boolean;
  sign: string;
  suffix: string;
}

export const parseFigure = (input: ReactNode): ParsedFigure | null => {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const decimals = Number.isInteger(input) ? 0 : (String(input).split('.')[1]?.length ?? 0);
    return { value: Math.abs(input), decimals, grouped: true, sign: input < 0 ? '-' : '', suffix: '' };
  }
  if (typeof input !== 'string') return null;
  const match = NUMBER_PATTERN.exec(input.trim());
  if (!match) return null;
  const [, sign, integer, fraction = '', suffix] = match;
  return {
    value: Number(`${integer.replace(/,/g, '')}${fraction}`),
    decimals: fraction ? fraction.length - 1 : 0,
    grouped: integer.includes(','),
    sign,
    suffix,
  };
};

export const formatFigure = (value: number, figure: ParsedFigure): string => {
  // The user's locale, as the screens' own toLocaleString() calls use.
  const digits = value.toLocaleString(undefined, {
    minimumFractionDigits: figure.decimals,
    maximumFractionDigits: figure.decimals,
    useGrouping: figure.grouped,
  });
  return `${figure.sign}${digits}${figure.suffix}`;
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

interface AnimatedNumberProps {
  value: ReactNode;
}

export const AnimatedNumber = ({ value }: AnimatedNumberProps) => {
  const figure = parseFigure(value);
  const target = figure?.value ?? null;
  const [shown, setShown] = useState<number | null>(() => (prefersReducedMotion() ? target : 0));
  const shownRef = useRef<number | null>(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (target === null) return undefined;
    const from = shownRef.current ?? 0;
    if (from === target || prefersReducedMotion()) {
      setShown(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      setShown(from + (target - from) * easeOutExpo(progress));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // Frames pause in background or throttled tabs; the figure must still end
    // up true rather than wait there at a stale value.
    const settle = window.setTimeout(() => {
      cancelAnimationFrame(frame);
      setShown(target);
    }, DURATION_MS + 50);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [target]);

  if (!figure || shown === null) return <>{value}</>;
  return <>{formatFigure(shown, figure)}</>;
};
