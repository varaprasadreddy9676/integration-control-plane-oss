import { Space } from "@/components/common/LegacyAntdControls";
import { Banner } from '@astryxdesign/core/Banner';
import type { CSSProperties } from 'react';
import { InlineHint } from '../../../../components/common/InlineHint';

export interface FormAlertsProps {
  /**
   * Show disabled/paused status warning
   */
  isDisabled?: boolean;

  /**
   * Reason why the form is disabled (e.g., "Circuit breaker is open")
   */
  disabledReason?: string;

  /**
   * List of validation errors to display
   */
  validationErrors?: string[];

  /**
   * Show "event type required" warning
   */
  requiresEventType?: boolean;

  /**
   * Event type help text (if requiresEventType is true)
   */
  eventTypeHelpText?: string;

  /**
   * Spacing between alerts (Ant Design spacing object or CSS value)
   */
  spacing?: any;

  /**
   * Additional styles for the container
   */
  style?: CSSProperties;

  /**
   * Callback when disabled alert is closed
   */
  onDismissDisabled?: () => void;

  /**
   * Callback when validation errors alert is closed
   */
  onDismissValidation?: () => void;

  /**
   * Callback when event type alert is closed
   */
  onDismissEventType?: () => void;
}

/**
 * Reusable form alert banners component
 *
 * Displays contextual alerts for form states:
 * - Disabled/paused status
 * - Validation errors
 * - Missing required fields (e.g., event type)
 *
 * @example
 * ```tsx
 * <FormAlerts
 *   isDisabled={!isActive}
 *   disabledReason="This integration is paused. Enable it to make changes."
 *   validationErrors={['Action 1: Missing transformation script', 'Action 2: Invalid URL']}
 *   requiresEventType={!eventType}
 *   spacing={spacing}
 * />
 * ```
 */
export const FormAlerts = ({
  isDisabled,
  disabledReason,
  validationErrors = [],
  requiresEventType,
  eventTypeHelpText = 'Choose an event type above to configure transformations.',
  spacing = { 4: '16px' },
  style,
  onDismissDisabled,
  onDismissValidation,
}: FormAlertsProps) => {
  const alerts = [];
  const spacingValue = typeof spacing === 'object' && spacing[4] ? spacing[4] : spacing || '16px';

  // Circuit breaker / disabled status banner
  if (isDisabled) {
    alerts.push(
      <Banner
        key="disabled-status"
        status="warning"
        title="Integration is paused"
        description={disabledReason || 'This integration is currently inactive. Enable it to process events.'}
        isDismissable={!!onDismissDisabled}
        onDismiss={onDismissDisabled}
      />
    );
  }

  // Validation errors banner
  if (validationErrors.length > 0) {
    alerts.push(
      <Banner
        key="validation-errors"
        status="error"
        title={`${validationErrors.length} validation error${validationErrors.length > 1 ? 's' : ''} found`}
        isDismissable={!!onDismissValidation}
        onDismiss={onDismissValidation}
      >
        <ul className="console-list-reset-indent">
          {validationErrors.map((error, idx) => (
            <li key={idx}>{error}</li>
          ))}
        </ul>
      </Banner>
    );
  }

  // Event type required hint
  if (requiresEventType) {
    alerts.push(
      <InlineHint key="event-type-required">
        Select event type first — {eventTypeHelpText}
      </InlineHint>
    );
  }

  if (alerts.length === 0) {
    return null;
  }

  return (
    <Space
      direction="vertical"
      size={spacingValue}
      style={{
        width: '100%',
        ...style,
      }}
    >
      {alerts}
    </Space>
  );
};
