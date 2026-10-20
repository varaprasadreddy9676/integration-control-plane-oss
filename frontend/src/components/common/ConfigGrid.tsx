import type { ReactNode } from 'react';
import { Grid } from 'antd';
import { useDesignTokens } from '../../design-system/utils';

interface ConfigGridProps {
  columns?: 2 | 3;
  children: ReactNode;
}

/**
 * Responsive multi-column layout for form fields — collapses to a single
 * column below the `md` breakpoint. Replaces full-width stacked
 * `Form.Item`s on editor/config screens where fields are short enough to
 * sit side by side (e.g. name + type, method + timeout).
 */
export const ConfigGrid = ({ columns = 2, children }: ConfigGridProps) => {
  const { spacing } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: isNarrow ? '1fr' : `repeat(${columns}, 1fr)`,
        columnGap: spacing[4],
        rowGap: 0,
      }}
    >
      {children}
    </div>
  );
};
