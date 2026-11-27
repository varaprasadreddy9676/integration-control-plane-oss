import type { ReactNode } from 'react';
import { Space } from '@/components/common/LegacyAntdControls';
import { Panel } from '../../../../../design-system/primitives';
import { spacingToNumber } from '../../../../../design-system/utils';

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
  muted,
}: SectionCardProps) => {
  return (
    <Panel
      title={
        <Space align="start" size={spacingToNumber(spacing['2.5'])}>
          {icon && <span className="console-text-accent">{icon}</span>}
          <span className="console-type-section console-font-weight-semibold console-text-primary">{title}</span>
        </Space>
      }
      description={description && <span className="console-type-body console-text-secondary">{description}</span>}
      actions={headerExtras}
      className={muted ? 'integration-section-card--muted' : undefined}
      style={muted ? { opacity: 0.55, pointerEvents: 'none' } : undefined}
    >
      {children}
    </Panel>
  );
};
