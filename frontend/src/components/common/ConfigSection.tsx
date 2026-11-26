import type { ReactNode } from 'react';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
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
    <section className="config-section" aria-label={title}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: spacing[3],
          marginBottom: spacing[3],
        }}
      >
        <div className="console-flex-center-gap-2">
          {icon && (
            <span style={{ fontSize: 'var(--console-type-section)', color: colors.primary[600], display: 'flex' }}>
              {icon}
            </span>
          )}
          <Heading level={5} className="console-section-heading-inline">
            {title}
          </Heading>
        </div>
        {actions}
      </div>
      {description && (
        <Text
          type="supporting"
          as="div"
          style={{
            display: 'block',
            fontSize: 'var(--console-type-body)',
            lineHeight: 1.5,
            marginTop: `-${spacing[2]}`,
            marginBottom: spacing[3],
          }}
        >
          {description}
        </Text>
      )}
      <div>{children}</div>
    </section>
  );
};
