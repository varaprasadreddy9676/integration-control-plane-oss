export interface DeliveryPanelProps {
  deliveryModeValue?: 'IMMEDIATE' | 'DELAYED' | 'RECURRING' | 'WAIT_FOR_CONDITION' | 'WAIT_FOR_EVENT';
  uiConfig: any;
  schedulingScriptValidation: { status: 'idle' | 'success' | 'error'; message?: string };
  isValidatingScript: boolean;
  onValidateScript: () => void;
  onCopyExampleScript: (mode: 'DELAYED' | 'RECURRING') => void;
  onValidationClose: () => void;
  spacing: Record<string, string>;
  token: any;
  colors: any;
  form?: any;
  currentEventType?: string;
  isLoading?: boolean;
  integrationId?: string;
}
