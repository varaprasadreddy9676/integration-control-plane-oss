import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * One highlight that travels to the active nav row, instead of every row
 * painting its own. Moving between screens then reads as moving *from* one
 * place *to* another, which is what navigation is.
 *
 * Measured before paint on every sidebar render (a querySelector and four
 * offset reads) so it follows group collapse, the Recent list growing and the
 * rail collapsing without a separate observer for each. Placement skips the
 * slide the first time, so it never flies in from the corner.
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const ACTIVE_ROW = '[data-nav-primary][aria-current="page"]';

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

export const useActiveRowRect = (containerRef: RefObject<HTMLElement>): Rect | null => {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    const row = containerRef.current?.querySelector<HTMLElement>(ACTIVE_ROW);
    const next = row
      ? { top: row.offsetTop, left: row.offsetLeft, width: row.offsetWidth, height: row.offsetHeight }
      : null;
    setRect((prev) => (sameRect(prev, next) ? prev : next));
  });

  return rect;
};

interface SidebarActiveIndicatorProps {
  rect: Rect | null;
  rounded: number;
}

export const SidebarActiveIndicator = ({ rect, rounded }: SidebarActiveIndicatorProps) => {
  const [hasPlaced, setHasPlaced] = useState(false);

  useLayoutEffect(() => {
    if (rect && !hasPlaced) {
      const frame = requestAnimationFrame(() => setHasPlaced(true));
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [rect, hasPlaced]);

  const last = rect ?? { top: 0, left: 0, width: 0, height: 0 };

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: last.width,
        height: last.height,
        transform: `translate3d(${last.left}px, ${last.top}px, 0)`,
        opacity: rect ? 1 : 0,
        borderRadius: rounded,
        background: 'var(--color-sidebar-active-bg)',
        boxShadow: '0 0 14px rgba(59, 130, 246, 0.2)',
        borderLeft: '3px solid var(--color-sidebar-accent)',
        pointerEvents: 'none',
        transition: hasPlaced
          ? 'transform 380ms var(--motion-ease-out), height 380ms var(--motion-ease-out), width 380ms var(--motion-ease-out), opacity 200ms ease'
          : 'none',
      }}
    />
  );
};
