export type ScheduledDeliveryMode = 'DELAYED' | 'RECURRING';
export type HoldDeliveryMode = 'WAIT_FOR_CONDITION' | 'WAIT_FOR_EVENT';
type DeliveryMode = 'IMMEDIATE' | ScheduledDeliveryMode | HoldDeliveryMode | string | undefined;

export const isScheduledDeliveryMode = (deliveryMode?: DeliveryMode): deliveryMode is ScheduledDeliveryMode =>
  deliveryMode === 'DELAYED' || deliveryMode === 'RECURRING';

export const isHoldDeliveryMode = (deliveryMode?: DeliveryMode): deliveryMode is HoldDeliveryMode =>
  deliveryMode === 'WAIT_FOR_CONDITION' || deliveryMode === 'WAIT_FOR_EVENT';

export const getDeliveryModeLabel = (deliveryMode?: DeliveryMode): string => {
  switch (deliveryMode) {
    case 'IMMEDIATE':
    case undefined:
      return 'Send immediately';
    case 'DELAYED':
      return 'Send later';
    case 'RECURRING':
      return 'Send on a recurring schedule';
    case 'WAIT_FOR_CONDITION':
    case 'WAIT_FOR_EVENT':
      return 'Hold until a follow-up event arrives';
    default:
      return String(deliveryMode);
  }
};

export const getDeliveryModeChipLabel = (deliveryMode?: DeliveryMode): string => {
  switch (deliveryMode) {
    case 'IMMEDIATE':
    case undefined:
      return 'Immediate';
    case 'DELAYED':
      return 'Delayed';
    case 'RECURRING':
      return 'Recurring';
    case 'WAIT_FOR_CONDITION':
    case 'WAIT_FOR_EVENT':
      return 'Hold';
    default:
      return String(deliveryMode);
  }
};

export const getDeliveryModeSummaryText = (deliveryMode?: DeliveryMode): string => {
  switch (deliveryMode) {
    case 'IMMEDIATE':
    case undefined:
      return 'Delivery will happen immediately.';
    case 'DELAYED':
      return 'Delivery will be scheduled for a future time.';
    case 'RECURRING':
      return 'Delivery will run on a recurring schedule.';
    case 'WAIT_FOR_CONDITION':
    case 'WAIT_FOR_EVENT':
      return 'Delivery will be held until a matching follow-up event arrives.';
    default:
      return `Delivery will use ${String(deliveryMode).toLowerCase()}.`;
  }
};
