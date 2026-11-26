import type { ReactNode } from 'react';
import { Button as AstryxButton, TextInput } from '@astryxdesign/core';
import { Icon as GatewayIcon } from "./Icon";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** A narrow screen: the box takes the whole row. */
  isNarrow?: boolean;
  /** Screen-reader name that identifies which list is being searched. */
  label?: string;
  placeholder?: string;
  width?: number | string;
}

/** The search box of a list page's toolbar. */
export const SearchInput = ({
  value,
  onChange,
  isNarrow = false,
  label = 'Search',
  placeholder = 'Search...',
  width = 240,
}: SearchInputProps) => {
  return (
    <div className={`list-search-input${isNarrow ? ' is-narrow' : ''}`} style={{ width: isNarrow ? '100%' : width }}>
      <TextInput
        label={label}
        isLabelHidden
        type="search"
        placeholder={placeholder}
        startIcon={<GatewayIcon name="SearchOutlined" aria-hidden="true" />}
        value={value}
        onChange={onChange}
        width="100%"
        size="md"
        hasClear
      />
    </div>
  );
};

interface ListActionsProps {
  onReset: () => void;
  onRefresh: () => void;
  /** What Refresh refreshes, for screen readers ("Refresh scheduled jobs"). */
  refreshLabel: string;
  /** Extra buttons after Reset and Refresh. */
  children?: ReactNode;
}

/** The Reset and Refresh buttons at the end of a list page's toolbar. */
export const ListActions = ({ onReset, onRefresh, refreshLabel, children }: ListActionsProps) => {
  return (
    <div className="list-actions">
      <AstryxButton
        label="Reset"
        icon={<GatewayIcon name="ClearOutlined" aria-hidden="true" />}
        variant="ghost"
        size="sm"
        onClick={onReset}
      />
      <AstryxButton
        label={refreshLabel}
        icon={<GatewayIcon name="ReloadOutlined" aria-hidden="true" />}
        variant="ghost"
        size="sm"
        isIconOnly
        tooltip={refreshLabel}
        onClick={onRefresh}
      />
      {children}
    </div>
  );
};
