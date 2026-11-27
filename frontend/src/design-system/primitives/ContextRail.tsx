import type { ReactNode } from 'react';
import './primitives.css';

export interface ContextRailProps {
  children: ReactNode;
  /** Accessible name for the complementary landmark. */
  label: string;
  className?: string;
}

/**
 * The right column of a configuration page: what this thing is doing right
 * now, next to the thing being configured. Sticky on wide screens, stacked
 * below the document on narrow ones.
 */
export const ContextRail = ({ children, label, className }: ContextRailProps) => (
  <aside className={['ds-context-rail', className].filter(Boolean).join(' ')} aria-label={label}>
    {children}
  </aside>
);
