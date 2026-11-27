import type { ReactNode } from 'react';
import './primitives.css';

export interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** `h2` by default; pass `h3` when nested inside a titled panel. */
  level?: 2 | 3;
}

export const SectionHeading = ({ title, description, actions, level = 2 }: SectionHeadingProps) => {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="ds-section-heading">
      <div className="ds-section-heading__text">
        <Heading className="ds-section-heading__title">{title}</Heading>
        {description && <p className="ds-section-heading__description">{description}</p>}
      </div>
      {actions && <div className="ds-section-heading__actions">{actions}</div>}
    </div>
  );
};
