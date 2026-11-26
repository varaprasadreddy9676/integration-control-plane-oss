import type { ReactNode } from 'react';
import { Text } from '@astryxdesign/core/Text';

interface ConfigFieldHelpProps {
  children: ReactNode;
}

/**
 * Consistent small helper/description text under a field — for use as a
 * `Form.Item`'s `extra` content so helper copy reads the same size and
 * color everywhere instead of relying on antd's default `extra` styling.
 */
export const ConfigFieldHelp = ({ children }: ConfigFieldHelpProps) => (
  <Text as="span" type="supporting" className="config-field-help">
    {children}
  </Text>
);
