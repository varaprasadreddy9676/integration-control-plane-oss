import { useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Skeleton, Table } from 'antd';
import { StatePanel } from './StatePanel';
import type { TableProps, ColumnType } from 'antd/es/table';
import { Resizable } from 'react-resizable';
import type { ResizeCallbackData } from 'react-resizable';
import 'react-resizable/css/styles.css';
import { cssVar, useDesignTokens } from '../../design-system/utils';
import { useIsMobile } from '../../hooks/use-mobile';

interface ResizableColumnType<T> extends ColumnType<T> {
  resizable?: boolean;
}

const ResizableTitle = (props: any) => {
  const { onResize, width, ...restProps } = props;

  if (!width || !onResize) {
    return <th {...restProps} />;
  }

  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="react-resizable-handle"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            right: -5,
            bottom: 0,
            zIndex: 1,
            width: 10,
            height: '100%',
            cursor: 'col-resize',
            background: 'transparent',
          }}
        />
      }
      onResize={onResize}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} />
    </Resizable>
  );
};

interface ModernTableProps<T> extends TableProps<T> {
  columns: ResizableColumnType<T>[];
  enableResize?: boolean;
  stickyHeader?: boolean;
  emptyState?: {
    icon?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
  };
}

export function ModernTable<T extends object>({
  columns: initialColumns,
  enableResize = true,
  stickyHeader = true,
  emptyState,
  ...tableProps
}: ModernTableProps<T>) {
  const { token } = useDesignTokens();
  const isMobile = useIsMobile();
  const [columns, setColumns] = useState(initialColumns);

  // Add a useEffect to update columns when initialColumns changes
  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);

  const isLoading =
    typeof tableProps.loading === 'boolean'
      ? tableProps.loading
      : Boolean(tableProps.loading && (tableProps.loading as any).spinning);

  const paginationConfig = typeof tableProps.pagination === 'object' ? tableProps.pagination : undefined;
  const skeletonRowCount = typeof paginationConfig?.pageSize === 'number' ? paginationConfig.pageSize : 10;
  const skeletonRows = Array.from({ length: skeletonRowCount }, (_, index) => ({
    __skeleton: true,
    __skeletonKey: `skeleton-${index}`,
  })) as any[];
  const rowKey = tableProps.rowKey;

  const handleResize = useCallback(
    (index: number) =>
      (_: any, { size }: ResizeCallbackData) => {
        setColumns((prev) => {
          const nextColumns = [...prev];
          nextColumns[index] = {
            ...nextColumns[index],
            width: size.width,
          };
          return nextColumns;
        });
      },
    []
  );

  const mergedColumns = columns.map((col, index) => {
    const originalRender = col.render;
    const skeletonWidth =
      typeof col.width === 'number' ? Math.max(80, Math.min(160, Math.round(col.width * 0.6))) : 120;

    const label = typeof col.title === 'string' ? col.title : '';

    return {
      ...col,
      // `fixed` pins a column via antd's floating cloned-table overlay, which
      // has no meaning once card mode replaces horizontal scrolling — leaving
      // it set would render a second, disconnected copy of that column.
      fixed: isMobile ? undefined : col.fixed,
      width: isMobile ? undefined : col.width,
      render: (value: any, record: any, renderIndex: number) => {
        if (record?.__skeleton) {
          return <Skeleton.Input active size="small" style={{ width: skeletonWidth }} />;
        }
        return originalRender ? originalRender(value, record, renderIndex) : value;
      },
      onHeaderCell: (column: ResizableColumnType<T>) => ({
        width: column.width,
        onResize: enableResize && col.resizable !== false ? handleResize(index) : undefined,
      }),
      onCell: isMobile ? () => ({ 'data-label': label }) : col.onCell,
    };
  });

  const effectiveRowKey = (() => {
    if (isLoading) {
      return (record: any) => {
        if (record?.__skeletonKey) return record.__skeletonKey;
        if (typeof rowKey === 'function') return rowKey(record);
        if (rowKey) return record[rowKey];
        return record?.key ?? record?.id ?? record?._id ?? undefined;
      };
    }

    if (rowKey) {
      return (record: any) => (typeof rowKey === 'function' ? rowKey(record) : record[rowKey]);
    }

    return undefined;
  })();

  const mergedLocale = (() => {
    if (!emptyState || isLoading) return tableProps.locale;

    // Every list in the console empties out through here, so this is the one
    // place worth spending a real illustration on — it keeps "no rows" looking
    // like a designed state on every screen rather than AntD's default grey box.
    const emptyText = (
      <StatePanel
        glyph="searching"
        size="compact"
        title={emptyState.title}
        description={emptyState.description}
        actions={emptyState.action}
      />
    );

    return {
      ...(tableProps.locale || {}),
      emptyText,
    };
  })();

  return (
    <div
      style={{
        width: '100%',
        position: 'relative',
        overflow: 'auto',
      }}
    >
      <style>
        {`
          .modern-table-wrapper {
            overflow-x: auto;
            overflow-y: visible;
          }

          .modern-table-wrapper .ant-table {
            min-width: 100%;
          }

          .modern-table-wrapper .ant-table-thead > tr > th {
            background: var(--color-bg-surface);
            font-weight: 500;
            font-size: 12px;
            color: var(--color-text-muted);
            text-transform: none;
            letter-spacing: 0.01em;
            border-bottom: 1px solid var(--color-border-subtle);
            padding: 10px 12px;
            position: ${stickyHeader ? 'sticky' : 'relative'};
            top: ${stickyHeader ? '0' : 'auto'};
            z-index: ${stickyHeader ? '10' : 'auto'};
          }

          .modern-table-wrapper .ant-table-thead > tr > th::before {
            display: none;
          }

          .modern-table-wrapper .ant-table-tbody > tr > td {
            padding: 12px;
            border-bottom: 1px solid var(--color-border-subtle);
            font-size: 0.875rem;
            font-variant-numeric: tabular-nums;
            color: var(--color-text-primary);
            transition: background-color 120ms var(--motion-ease-out);
          }

          .modern-table-wrapper .ant-table-tbody > tr:last-child > td {
            border-bottom: none;
          }

          .modern-table-wrapper .ant-table-tbody > tr.ant-table-row:hover > td {
            background: var(--color-row-hover) !important;
          }

          /* A thin accent on the hovered row's leading edge marks which row the
             pointer is on without repainting the whole row in a stronger color. */
          .modern-table-wrapper .ant-table-tbody > tr.ant-table-row:hover > td:first-child {
            box-shadow: inset 2px 0 0 var(--color-primary-500);
          }

          .modern-table-wrapper .ant-table-tbody > tr.ant-table-row-selected > td {
            background: var(--color-row-selected) !important;
            color: var(--color-text-primary) !important;
          }

          .modern-table-wrapper .ant-table-tbody > tr.ant-table-row-selected:hover > td {
            background: var(--color-row-active) !important;
            color: var(--color-text-primary) !important;
          }

          .modern-table-wrapper .ant-table-column-sorter {
            color: var(--color-text-muted);
          }

          .modern-table-wrapper .ant-table-column-sorter-up.active,
          .modern-table-wrapper .ant-table-column-sorter-down.active {
            color: var(--color-primary-600);
          }

          .modern-table-wrapper .ant-table-pagination {
            margin: 12px;
          }

          .modern-table-wrapper .ant-pagination-item-active {
            border-color: var(--color-primary-600);
            background: var(--color-primary-50);
          }

          .modern-table-wrapper .ant-pagination-item-active a {
            color: var(--color-text-primary);
            font-weight: 600;
          }

          .modern-table-wrapper .ant-empty-description {
            color: var(--color-text-muted);
          }

          /* Resizable handle styling */
          .modern-table-wrapper .react-resizable-handle {
            position: absolute;
            right: -5px;
            bottom: 0;
            z-index: 1;
            width: 10px;
            height: 100%;
            cursor: col-resize;
          }

          .modern-table-wrapper .react-resizable-handle:hover::after {
            content: '';
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            width: 2px;
            height: 60%;
            background: var(--color-primary-600);
            border-radius: 2px;
            box-shadow: 0 0 4px var(--color-primary-400);
          }

          /* Loading state */
          .modern-table-wrapper .ant-table-placeholder {
            background: ${cssVar.bg.surface};
          }

          /* Expandable row styling */
          .modern-table-wrapper .ant-table-expanded-row > td {
            padding: 0;
            background: var(--color-row-selected);
          }

          .modern-table-wrapper .ant-table-row-expand-icon {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
            color: var(--color-text-secondary);
            background: ${cssVar.bg.surface};
            border: 1px solid ${cssVar.border.default};
            border-radius: ${token.borderRadiusSM}px;
            cursor: pointer;
            transition: all 0.2s ease;
            pointer-events: auto;
          }

          .modern-table-wrapper .ant-table-row-expand-icon:hover {
            color: var(--color-primary-600);
            border-color: var(--color-primary-600);
            background: var(--color-primary-50);
          }

          .modern-table-wrapper .ant-table-row-expand-icon::before,
          .modern-table-wrapper .ant-table-row-expand-icon::after {
            position: absolute;
            background: currentColor;
            transition: transform 0.2s ease;
            content: '';
            pointer-events: none;
          }

          .modern-table-wrapper .ant-table-row-expand-icon::before {
            width: 10px;
            height: 2px;
          }

          .modern-table-wrapper .ant-table-row-expand-icon::after {
            width: 2px;
            height: 10px;
          }

          .modern-table-wrapper .ant-table-row-expand-icon-collapsed::after {
            transform: rotate(0deg);
          }

          .modern-table-wrapper .ant-table-row-expand-icon-expanded::after {
            transform: rotate(90deg);
          }

          /* Selection column */
          .modern-table-wrapper .ant-table-selection-column {
            padding-left: 16px;
          }

          /* Mobile card mode: each row becomes a stacked card instead of a
             horizontally-scrolling table row, since sideways-scrolling a
             table with checkboxes/badges on a phone is unusable. */
          .modern-table-wrapper.mobile-card-mode .ant-table-thead {
            display: none;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-tbody > tr {
            display: block;
            margin: 0 0 12px;
            border: 1px solid var(--color-border-subtle);
            border-radius: ${token.borderRadiusLG}px;
            background: var(--color-bg-surface);
            overflow: hidden;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-tbody > tr:hover {
            transform: none;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-tbody > tr > td {
            display: block;
            width: 100% !important;
            max-width: none !important;
            padding: 10px 12px;
            border-bottom: 1px solid var(--color-border-subtle);
            white-space: normal !important;
            word-break: break-word;
            overflow: visible !important;
            text-overflow: clip !important;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-tbody > tr > td:last-child {
            border-bottom: none;
          }

          /* antd's ellipsis/single-line truncation assumes a fixed table
             column width to clip against; that assumption breaks once the
             row is no longer a table row, so force full wrapping instead
             of letting truncated text render at its untruncated intrinsic
             width (which is what caused the earlier overflow/misalignment). */
          .modern-table-wrapper.mobile-card-mode .ant-table-cell-ellipsis,
          .modern-table-wrapper.mobile-card-mode .ant-typography-ellipsis-single-line {
            white-space: normal !important;
            text-overflow: clip !important;
            overflow: visible !important;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-tbody > tr > td::before {
            content: attr(data-label);
            display: block;
            margin-bottom: 4px;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--color-text-secondary);
            text-align: left;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-tbody > tr > td:not([data-label])::before,
          .modern-table-wrapper.mobile-card-mode .ant-table-tbody > tr > td[data-label='']::before {
            content: none;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-selection-column,
          .modern-table-wrapper.mobile-card-mode .ant-table-row-expand-icon-cell {
            padding-left: 12px;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-expanded-row > td {
            display: block;
          }

          .modern-table-wrapper.mobile-card-mode .ant-table-pagination {
            justify-content: center;
          }
        `}
      </style>
      <div className={`modern-table-wrapper${isMobile ? ' mobile-card-mode' : ''}`}>
        <Table<T>
          {...tableProps}
          loading={isLoading ? false : tableProps.loading}
          columns={mergedColumns as ColumnType<T>[]}
          dataSource={isLoading ? (skeletonRows as T[]) : tableProps.dataSource}
          rowKey={effectiveRowKey as any}
          rowSelection={isLoading ? undefined : tableProps.rowSelection}
          expandable={isLoading ? undefined : tableProps.expandable}
          scroll={isMobile ? undefined : { x: 'max-content', ...tableProps.scroll }}
          locale={mergedLocale}
          components={{
            header: {
              cell: ResizableTitle,
            },
          }}
        />
      </div>
    </div>
  );
}
