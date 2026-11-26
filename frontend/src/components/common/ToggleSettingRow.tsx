import type { ReactNode } from 'react';
import { Form, Switch } from "@/components/common/LegacyAntdControls";
import type { NamePath } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
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
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: spacing[3],
        padding: spacing[3],
        background: cssVar.bg.subtle,
        border: `1px solid ${cssVar.border.subtle}`,
        borderRadius: 'var(--radius-base)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing[2] }}>
        {icon && (
          <span
            style={{
              fontSize: 'var(--console-type-section)',
              color: cssVar.primary[600],
              marginTop: 'var(--spacing-1)',
            }}
          >
            {icon}
          </span>
        )}
        <div>
          <Text as="div" className="console-font-weight-semibold">
            {title}
          </Text>
          <div>
            <Text as="span" type="supporting" className="console-type-caption">
              {description}
            </Text>
          </div>
        </div>
      </div>
      <Form.Item name={name} valuePropName="checked" noStyle>
        <Switch />
      </Form.Item>
    </div>
  );
};
