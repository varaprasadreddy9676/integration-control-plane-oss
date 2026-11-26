import { SchedulingSection } from '../../../components/detail/SchedulingSection';
import type { DeliveryPanelProps } from './DeliveryPanel.types';
import { StatePanel } from '../../../../../components/common/StatePanel';

export const DeliveryTimingSection = ({
  deliveryModeValue,
  schedulingScriptValidation,
  isValidatingScript,
  onValidateScript,
  onCopyExampleScript,
  onValidationClose,
  spacing,
  token,
  colors,
  form,
  currentEventType,
  isLoading = false,
  integrationId,
}: DeliveryPanelProps) => {
  if (isLoading) {
    return <StatePanel glyph="connecting" tone="busy" size="compact" title="Loading timing settings" />;
  }

  if (!currentEventType) {
    return <StatePanel title="Choose an event type first" description="Timing settings unlock after selection." size="compact" />;
  }

  return (
    <SchedulingSection
      deliveryModeValue={deliveryModeValue}
      schedulingScriptValidation={schedulingScriptValidation}
      isValidatingScript={isValidatingScript}
      onValidateScript={onValidateScript}
      onCopyExampleScript={onCopyExampleScript}
      onValidationClose={onValidationClose}
      spacing={spacing}
      token={token}
      colors={colors}
      form={form}
      currentEventType={currentEventType}
      integrationId={integrationId}
    />
  );
};
