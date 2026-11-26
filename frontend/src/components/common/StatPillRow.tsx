import type { ReactNode } from 'react';
import type { CSSProperties } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { cssVar, useDesignTokens, withAlpha } from '../../design-system/utils';
import { AnimatedNumber } from '../motion/AnimatedNumber';

export interface StatPillItem {
  title: string;
  value: number | null | undefined;
  icon: ReactNode;
  tone: string;
  /** null marks the "all"/total pill — clicking it clears the filter. */
  filterValue: string | null;
}

interface StatPillRowProps {
  items: StatPillItem[];
  activeFilter: string | undefined;
  onFilterChange: (filterValue: string | undefined) => void;
}

/**
 * Clickable, color-coded stat pills — the pattern Delivery Logs already used for its
 * Total/Success/Failed/Skipped/Pending row. Extracted so other screens summarizing
 * the same kind of counts (e.g. Event Audit) render them the same way instead of a
 * plain-text list, which read as a different, less scannable pattern on a sibling
 * screen covering the same underlying data.
 */
export const StatPillRow = ({ items, activeFilter, onFilterChange }: StatPillRowProps) => {
  const { spacing, borderRadius } = useDesignTokens();

  const toggle = (filterValue: string | null) => {
    if (filterValue === null) {
      onFilterChange(undefined);
    } else {
      onFilterChange(activeFilter === filterValue ? undefined : filterValue);
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing[2], alignItems: 'center' }}>
      {items.map((item) => {
        const isActive = item.filterValue === null ? !activeFilter : activeFilter === item.filterValue;
        return (
          <button
            key={item.title}
            type="button"
            className="stat-pill"
            onClick={() => toggle(item.filterValue)}
            aria-label={`Filter by ${item.title}: ${item.value?.toLocaleString() ?? 0}${isActive ? ', currently selected' : ', click to filter'}`}
            aria-pressed={isActive}
            style={
              {
                display: 'inline-flex',
                alignItems: 'center',
                gap: spacing[1],
                padding: `${spacing[1]} ${spacing[3]}`,
                background: isActive ? withAlpha(item.tone, 0.15) : cssVar.bg.surface,
                border: `1px solid ${isActive ? item.tone : cssVar.border.default}`,
                borderRadius: borderRadius.full,
                cursor: 'pointer',
                font: 'inherit',
                transition: 'background-color 150ms ease, border-color 150ms ease',
                '--stat-pill-tone': item.tone,
              } as CSSProperties
            }
          >
            <span className="stat-pill__icon" style={{ color: item.tone }}>{item.icon}</span>
            <Text
              as="span"
              type="supporting"
              className="console-caption-secondary"
            >
              {item.title}:
            </Text>
            <Text
              as="span"
              className="stat-pill__value"
            >
              <AnimatedNumber value={item.value ?? 0} />
            </Text>
          </button>
        );
      })}
    </div>
  );
};
