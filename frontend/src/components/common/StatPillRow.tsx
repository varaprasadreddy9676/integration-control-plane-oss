import type { ReactNode } from 'react';
import { Typography } from 'antd';
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
          <div
            key={item.title}
            onClick={() => toggle(item.filterValue)}
            role="button"
            tabIndex={0}
            aria-label={`Filter by ${item.title}: ${item.value?.toLocaleString() ?? 0}${isActive ? ', currently selected' : ', click to filter'}`}
            aria-pressed={isActive}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle(item.filterValue);
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: spacing[1],
              padding: `${spacing[1]} ${spacing[3]}`,
              background: isActive ? withAlpha(item.tone, 0.15) : cssVar.bg.surface,
              border: `1px solid ${isActive ? item.tone : cssVar.border.default}`,
              borderRadius: borderRadius.full,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.borderColor = item.tone;
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.borderColor = cssVar.border.default;
            }}
          >
            <span style={{ color: item.tone, fontSize: 13, display: 'flex' }}>{item.icon}</span>
            <Typography.Text style={{ fontSize: 12.5, color: cssVar.text.secondary }}>{item.title}:</Typography.Text>
            <Typography.Text strong style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
              <AnimatedNumber value={item.value ?? 0} />
            </Typography.Text>
          </div>
        );
      })}
    </div>
  );
};
