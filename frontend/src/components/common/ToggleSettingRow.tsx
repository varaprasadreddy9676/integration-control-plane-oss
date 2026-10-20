import type { ReactNode } from 'react';
import { Form, Switch, Typography } from 'antd';
import type { NamePath } from 'antd/es/form/interface';
import { cssVar, useDesignTokens } from '../../design-system/utils';

interface ToggleSettingRowProps {
  name: NamePath;
  title: string;
  description: string;
  icon?: ReactNode;
}

/**
 * Card-style row for an important boolean setting (title + description +
 * Switch). Gives on/off settings enough visual weight that the reader
 * doesn't mistake them for a minor cosmetic control, unlike a bare Switch
 * dropped into a form.
 */
export const ToggleSettingRow = ({ name, title, description, icon }: ToggleSettingRowProps) => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing[3],
        padding: spacing[3],
        background: colors.neutral[50],
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing[2] }}>
        {icon && <span style={{ fontSize: 16, color: colors.primary[600], marginTop: 2 }}>{icon}</span>}
        <div>
          <Typography.Text strong>{title}</Typography.Text>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {description}
            </Typography.Text>
          </div>
        </div>
      </div>
      <Form.Item name={name} valuePropName="checked" noStyle>
        <Switch />
      </Form.Item>
    </div>
  );
};
