import type { CSSProperties, ReactNode } from 'react';
import './primitives.css';

export interface PanelProps {
  /** Optional heading. Rendered as an h2 so the page keeps one h1. */
  title?: ReactNode;
  /** One line of context under the title. Never a paragraph of instructions. */
  description?: ReactNode;
  /** Secondary actions for the panel, right-aligned. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /**
   * Escape hatch for positioning (grid spans, widths, margins) when a panel is
   * placed in an ad-hoc layout. Not for colours, borders or padding — those
   * belong to the theme and the panel anatomy.
   */
  style?: CSSProperties;
}

/**
 * The one surface component. Pages are built from panels, not from stacked
 * cards: a hairline border, no shadow, a title row and a body.
 */
export const Panel = ({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  style,
}: PanelProps) => (
  <section className={['ds-panel', className].filter(Boolean).join(' ')} style={style}>
    {(title || actions) && (
      <header className="ds-panel__head">
        <div className="ds-panel__heading">
          {title && <h2 className="ds-panel__title">{title}</h2>}
          {description && <p className="ds-panel__description">{description}</p>}
        </div>
        {actions && <div className="ds-panel__actions">{actions}</div>}
      </header>
    )}
    <div className={['ds-panel__body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
  </section>
);
