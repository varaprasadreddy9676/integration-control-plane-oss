import { Badge } from '@astryxdesign/core/Badge';
import type { ReactNode } from 'react';

interface MetaTagProps {
  children: ReactNode;
  variant?: 'event' | 'method' | 'flow' | 'category' | 'neutral';
  size?: 'small' | 'default';
}

const badgeVariants = {
  event: 'neutral',
  method: 'blue',
  flow: 'neutral',
  category: 'warning',
  neutral: 'neutral',
} as const;

/** Astryx metadata badge for event, method, flow and category labels. */
export const MetaTag = ({ children, variant = 'neutral', size = 'default' }: MetaTagProps) => (
  <Badge
    className={`meta-tag meta-tag--${size}`}
    data-size={size}
    label={children}
    variant={badgeVariants[variant]}
  />
);
