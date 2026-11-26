import { Space } from '@/components/common/LegacyAntdControls';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import type { ReactNode } from 'react';
import { spacingToNumber, cssVar } from '../../../../../design-system/utils';

interface SectionCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  headerExtras?: ReactNode;
  spacing: Record<string, string>;
  token: any;
  muted?: boolean;
}

export const SectionCard = ({
  title,
  description,
  icon,
  children,
  headerExtras,
  spacing,
  token,
  muted,
}: SectionCardProps) => {
  const colors = cssVar.legacy;
  return (
    <div
      className={`integration-section-card${muted ? ' integration-section-card--muted' : ''}`}
      style={{
        background: cssVar.bg.surface,
        border: `1px solid ${cssVar.border.default}`,
        borderRadius: token.borderRadiusLG,
        padding: 'var(--spacing-0)',
        opacity: muted ? 0.55 : 1,
        pointerEvents: muted ? 'none' : 'auto',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: spacingToNumber(spacing[2]),
          padding: `${spacing[3]} ${spacing[4]}`,
          borderBottom: `1px solid ${cssVar.border.default}`,
          background: 'transparent',
        }}
      >
        <Space align="start" size={spacingToNumber(spacing['2.5'])}>
          {icon && (
            <div
              style={{
                width: 20,
                height: 20,
                color: colors.primary[600],
                display: 'grid',
                placeItems: 'center',
                fontSize: 'var(--console-type-section)',
              }}
            >
              {icon}
            </div>
          )}
          <div>
            <Heading level={5} className="console-section-heading-inline">
              {title}
            </Heading>
            {description && (
              <Text
                type="supporting"
                as="div"
                style={{
                  display: 'block',
                  marginTop: 'var(--spacing-1)',
                  fontSize: 'var(--console-type-body)',
                  color: cssVar.text.secondary,
                }}
              >
                {description}
              </Text>
            )}
          </div>
        </Space>
        {headerExtras && <div style={{ display: 'flex', gap: spacingToNumber(spacing[2]) }}>{headerExtras}</div>}
      </div>
      <div style={{ padding: `${spacing[4]} ${spacing[4]}` }}>{children}</div>
    </div>
  );
};
