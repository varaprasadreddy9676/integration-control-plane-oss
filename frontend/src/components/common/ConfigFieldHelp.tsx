import type { ReactNode } from 'react';
import { Typography } from 'antd';

interface ConfigFieldHelpProps {
  children: ReactNode;
}

/**
 * Consistent small helper/description text under a field — for use as a
 * `Form.Item`'s `extra` content so helper copy reads the same size and
 * color everywhere instead of relying on antd's default `extra` styling.
 */
export const ConfigFieldHelp = ({ children }: ConfigFieldHelpProps) => (
  <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
    {children}
  </Typography.Text>
);
