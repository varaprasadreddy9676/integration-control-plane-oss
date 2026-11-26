import type { CSSProperties, ReactNode } from 'react';
import { Banner } from '@astryxdesign/core/Banner';

type NoticeStatus = 'error' | 'info' | 'success' | 'warning';

export interface InlineNoticeProps {
  type?: NoticeStatus;
  message: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  closable?: boolean;
  onClose?: () => void;
  role?: 'alert' | 'status' | 'region' | undefined;
  className?: string;
  style?: CSSProperties;
}

/** Keeps the legacy notice call shape while rendering through Astryx Banner. */
export const InlineNotice = ({
  type = 'info',
  message,
  description,
  icon,
  action,
  closable = false,
  onClose,
  role = 'status',
  className,
  style,
}: InlineNoticeProps) => (
  <Banner
    status={type}
    title={message}
    description={description}
    icon={icon}
    endContent={action}
    isDismissable={closable}
    onDismiss={onClose}
    collapsible={false}
    role={role}
    className={className}
    style={style}
  />
);
