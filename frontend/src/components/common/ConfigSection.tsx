import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { cssVar, useDesignTokens } from '../../design-system/utils';

interface ConfigSectionProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Consistent section header (icon + title + optional description/actions)
 * for grouping related fields within a config/editor tab. Replaces the
 * repeated ad-hoc `<Icon/><Text strong>Title</Text>` pattern.
 */
export const ConfigSection = ({ icon, title, description, actions, children }: ConfigSectionProps) => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: spacing[3],
          marginBottom: spacing[3],
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          {icon && <span style={{ fontSize: 16, color: colors.primary[600], display: 'flex' }}>{icon}</span>}
          <Typography.Text strong style={{ fontSize: 14 }}>
            {title}
          </Typography.Text>
        </div>
        {actions}
      </div>
      {description && (
        <Typography.Text
          type="secondary"
          style={{
            display: 'block',
            fontSize: 13,
            lineHeight: 1.5,
            marginTop: `-${spacing[2]}`,
            marginBottom: spacing[3],
          }}
        >
          {description}
        </Typography.Text>
      )}
      <div>{children}</div>
    </div>
  );
};
