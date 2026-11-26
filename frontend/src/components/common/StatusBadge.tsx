import { Badge } from '@astryxdesign/core/Badge';
import type { BadgeVariant } from '@astryxdesign/core/Badge';
import type { ReactNode } from 'react';
import type { DeliveryStatus, IntegrationScope } from '../../mocks/types';

export type StatusBadgeVariant = Extract<
  BadgeVariant,
  'neutral' | 'info' | 'success' | 'warning' | 'error' | 'blue' | 'green' | 'orange' | 'red'
>;

const statusLabels: Record<string, string> = {
  RECEIVED: 'Pending',
  PROCESSING: 'Pending',
  SUCCESS: 'Delivered',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  RETRYING: 'Retrying',
  PENDING: 'Pending',
  QUEUED: 'Pending',
  PENDING_OR_RETRYING: 'Pending',
  SKIPPED: 'Skipped',
  ABANDONED: 'Abandoned',
  STUCK: 'Failed',
  ENTITY_ONLY: 'Entity only',
  INCLUDE_CHILDREN: 'Include children',
  INHERITED: 'Inherited',
  LOCAL: 'Local',
};

export const getStatusLabel = (status?: string): string => {
  const normalizedStatus = String(status || '').toUpperCase();
  return statusLabels[normalizedStatus] ?? status ?? 'Unknown';
};

const statusVariants: Record<string, StatusBadgeVariant> = {
  RECEIVED: 'warning',
  PROCESSING: 'warning',
  SUCCESS: 'success',
  DELIVERED: 'success',
  FAILED: 'error',
  RETRYING: 'warning',
  PENDING: 'warning',
  QUEUED: 'warning',
  PENDING_OR_RETRYING: 'warning',
  SKIPPED: 'neutral',
  ABANDONED: 'error',
  STUCK: 'error',
  ENTITY_ONLY: 'blue',
  INCLUDE_CHILDREN: 'blue',
  INHERITED: 'neutral',
  LOCAL: 'info',
};

type LegacyStatus = DeliveryStatus | 'INHERITED' | 'LOCAL' | 'PENDING_OR_RETRYING' | IntegrationScope;

interface StatusBadgeProps {
  status?: LegacyStatus | string;
  label?: ReactNode;
  variant?: StatusBadgeVariant;
  size?: 'small' | 'default' | 'large';
  showIcon?: boolean;
  className?: string;
}

/** Astryx badge for consistent status and metadata labels across the console. */
export const StatusBadge = ({
  status,
  label,
  variant,
  size = 'default',
  showIcon = true,
  className,
}: StatusBadgeProps) => {
  const normalizedStatus = String(status || '').toUpperCase();
  const text = label ?? getStatusLabel(status);
  const resolvedVariant = variant ?? statusVariants[normalizedStatus] ?? 'neutral';

  return (
    <Badge
      className={`status-badge status-badge--${size} status-badge--tone-${resolvedVariant}${className ? ` ${className}` : ''}`}
      data-size={size}
      icon={showIcon && status ? <span aria-hidden="true" className="status-badge__dot" /> : undefined}
      label={text}
      data-status={normalizedStatus || undefined}
      variant="neutral"
    />
  );
};
