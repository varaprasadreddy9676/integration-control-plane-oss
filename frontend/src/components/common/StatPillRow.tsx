import type { ReactNode } from 'react';
import { AnimatedNumber } from '../motion/AnimatedNumber';
import './stat-pill-row.css';

export interface StatPillItem {
  title: string;
  value: number | null | undefined;
  /** Kept for call sites that pass a glyph; the row communicates status with a dot. */
  icon?: ReactNode;
  /** A CSS colour string for the status dot. */
  tone: string;
  /** null marks the "all"/total item — clicking it clears the filter. */
  filterValue: string | null;
}

interface StatPillRowProps {
  items: StatPillItem[];
  activeFilter: string | undefined;
  onFilterChange: (filterValue: string | undefined) => void;
}

/**
 * Status counts as one compact filter row, not a row of coloured pills.
 * Only the dot carries colour; the label and the figure stay neutral, so a
 * failure count is noticeable without turning the toolbar into a traffic light.
 */
export const StatPillRow = ({ items, activeFilter, onFilterChange }: StatPillRowProps) => {
  const toggle = (filterValue: string | null) => {
    if (filterValue === null) {
      onFilterChange(undefined);
    } else {
      onFilterChange(activeFilter === filterValue ? undefined : filterValue);
    }
  };

  return (
    <div className="stat-filters" role="group" aria-label="Filter by status">
      {items.map((item) => {
        const isActive = item.filterValue === null ? !activeFilter : activeFilter === item.filterValue;
        return (
          <button
            key={item.title}
            type="button"
            className="stat-filters__item"
            onClick={() => toggle(item.filterValue)}
            aria-label={`Filter by ${item.title}: ${item.value?.toLocaleString() ?? 0}${isActive ? ', currently selected' : ', click to filter'}`}
            aria-pressed={isActive}
          >
            {item.filterValue !== null && (
              <span
                className="stat-filters__dot"
                aria-hidden="true"
                style={{ background: item.tone }}
              />
            )}
            <span className="stat-filters__label">{item.title}</span>
            <span className="stat-filters__value">
              <AnimatedNumber value={item.value ?? 0} />
            </span>
          </button>
        );
      })}
    </div>
  );
};
