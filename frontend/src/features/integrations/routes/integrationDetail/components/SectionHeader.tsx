import { Heading } from '@astryxdesign/core/Heading';
import type { ReactNode } from 'react';
import { spacingToNumber } from '../../../../../design-system/utils';

interface SectionHeaderProps {
  icon: ReactNode;
  title: string;
  spacing: Record<string, string>;
}

export const SectionHeader = ({ icon, title, spacing }: SectionHeaderProps) => (
  <div className="console-flex-center-gap-2">
    {icon}
    <div>
      <Heading level={5} className="console-section-heading-inline">
        {title}
      </Heading>
    </div>
  </div>
);
