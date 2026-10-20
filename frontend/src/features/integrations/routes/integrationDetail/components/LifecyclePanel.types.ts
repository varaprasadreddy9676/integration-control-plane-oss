import type { FormInstance } from 'antd';

export interface LifecyclePanelSurfaceProps {
  token: any;
  colors: any;
  isReadOnly?: boolean;
  onSwitchToDefault?: () => void;
}

export interface LifecyclePanelTokenProps {
  token: any;
}

export interface LifecyclePanelContentProps extends LifecyclePanelSurfaceProps {
  form: FormInstance;
  eventTypes: any[];
  hasPersistedConfig?: boolean;
  deliveryModeValue?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING' | 'WAIT_FOR_CONDITION' | 'WAIT_FOR_EVENT';
  spacing: Record<string, string>;
  isLoading?: boolean;
  isReadOnly?: boolean;
}
