import type { ReactNode } from 'react';
import { useDesignTokens } from '../../design-system/utils';

interface Props {
  children: ReactNode;
  rightSlot?: ReactNode;
}

export const FilterBar = ({ children, rightSlot }: Props) => {
  const { spacing, zIndex: zIndexTokens } = useDesignTokens();

  return (
    <div
      className="filter-bar"
      role="search"
      aria-label="Filter results"
      style={{
        marginBottom: spacing[3],
        padding: `${spacing[2]} ${spacing[3]}`,
        position: 'sticky',
        zIndex: zIndexTokens.filterBar,
      }}
    >
      <div className="filter-bar-fields">{children}</div>
      {rightSlot && <div className="filter-bar-actions">{rightSlot}</div>}
    </div>
  );
};
