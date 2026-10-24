import type { ReactNode } from 'react';
import { Button, Input } from 'antd';
import { CloseCircleOutlined, FilterOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useDesignTokens } from '../../design-system/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** A narrow screen: the box takes the whole row. */
  isNarrow?: boolean;
}

/** The search box of a list page's toolbar. */
export const SearchInput = ({ value, onChange, isNarrow = false }: SearchInputProps) => {
  const { token } = useDesignTokens();
  return (
    <Input
      placeholder="Search..."
      prefix={<SearchOutlined />}
      suffix={
        value ? <CloseCircleOutlined onClick={() => onChange('')} style={{ cursor: 'pointer', color: token.colorTextSecondary }} /> : null
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: isNarrow ? '100%' : 200 }}
      size="small"
      allowClear
    />
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
  const { spacing } = useDesignTokens();
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', gap: spacing[1] }}>
      <Button icon={<FilterOutlined />} size="small" type="text" onClick={onReset}>
        Reset
      </Button>
      <Button icon={<ReloadOutlined />} size="small" aria-label={refreshLabel} onClick={onRefresh} />
      {children}
    </div>
  );
};
