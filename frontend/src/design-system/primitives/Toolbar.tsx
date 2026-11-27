import type { ReactNode } from 'react';
import './primitives.css';

export interface ToolbarProps {
  /** Filters and search. Wraps before it overflows. */
  children: ReactNode;
  /** Commands on the right: refresh, export, view switch. */
  actions?: ReactNode;
  className?: string;
}

/** One filter row. Filters scope a view; they never share a row with view tabs. */
export const Toolbar = ({ children, actions, className }: ToolbarProps) => (
  <div className={['ds-toolbar', className].filter(Boolean).join(' ')}>
    <div className="ds-toolbar__filters">{children}</div>
    {actions && <div className="ds-toolbar__actions">{actions}</div>}
  </div>
);
