import type { ReactNode } from 'react';
import './primitives.css';

export interface RowListProps {
  children: ReactNode;
  className?: string;
  /** Accessible name for the group of rows. */
  label?: string;
}

/**
 * A divided list of rows inside a panel. Repeatable items (checks, rules,
 * templates, roles) are rows separated by hairlines, not cards inside a card.
 */
export const RowList = ({ children, className, label }: RowListProps) => (
  <div className={['ds-rows', className].filter(Boolean).join(' ')} role="list" aria-label={label}>
    {children}
  </div>
);

export interface RowProps {
  /** The row body. Optional: a title/value row may carry everything in title + actions. */
  children?: ReactNode;
  /** Optional leading title; keep it short — the body is the content. */
  title?: ReactNode;
  /** Right-aligned controls for this row. */
  actions?: ReactNode;
  className?: string;
}

export const Row = ({ children, title, actions, className }: RowProps) => (
  <div className={['ds-row', className].filter(Boolean).join(' ')} role="listitem">
    {(title || actions) && (
      <div className="ds-row__head">
        {title && <span className="ds-row__title">{title}</span>}
        {actions && <span className="ds-row__actions">{actions}</span>}
      </div>
    )}
    {children !== undefined && children !== null && <div className="ds-row__body">{children}</div>}
  </div>
);
