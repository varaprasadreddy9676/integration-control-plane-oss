import { Alert, Col, Row, Skeleton } from 'antd';
import { SchedulingSection } from '../../../components/detail/SchedulingSection';
import { spacingToNumber } from '../../../../../design-system/utils';
import type { DeliveryPanelProps } from './DeliveryPanel.types';

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
    return (
      <div style={{ padding: spacing[3] }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (!currentEventType) {
    return (
      <Row gutter={[spacingToNumber(spacing[4]), 0]}>
        <Col xs={24}>
          <Alert
            type="info"
            showIcon
            message="Select an event type first"
            description="Timing and follow-up options will appear after you select an event type in Basic Info."
            style={{ marginBottom: 0 }}
          />
        </Col>
      </Row>
    );
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
