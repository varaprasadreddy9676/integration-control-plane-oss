import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Typography } from '@/components/common/LegacyTypography';
import { Drawer, Space, Divider, Checkbox, Input, Row, Col } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../../../components/common/Icon';
import { cssVar, useDesignTokens, spacingToNumber } from '../../../../../design-system/utils';
import { getDeliveryModeLabel, getDeliveryModeSummaryText } from '../utils/deliveryMode';
import { Button } from '../../../../../components/common/LegacyButton';
import { InlineNotice as Notice } from '../../../../../components/common';
import { Text as AstryxText } from '@astryxdesign/core/Text';

const { Title, Text } = Typography;

interface ReviewItem {
  label: string;
  value: string | React.ReactNode;
  icon: React.ReactNode;
  critical?: boolean;
}

interface ReadinessCheck {
  label: string;
  isComplete: boolean;
  warning?: string;
  /** Shown as a warning, but does not block activation. */
  advisory?: boolean;
}

interface ReviewConfirmDrawerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (action: 'activate' | 'draft') => void;
  isCreating: boolean;

  // Rule configuration for review
  ruleName: string;
  eventType: string;
  targetUrl: string;
  httpMethod: string;
  scope: string;
  deliveryMode: string;
  retryPolicy: string;
  authMethod: string;
  transformationType?: string;

  // Readiness checks
  readinessChecks: ReadinessCheck[];

  // Loading state
  isSaving: boolean;
}

export const ReviewConfirmDrawer = ({
  open,
  onClose,
  onConfirm,
  isCreating,
  ruleName,
  eventType,
  targetUrl,
  httpMethod,
  scope,
  deliveryMode,
  retryPolicy,
  authMethod,
  transformationType,
  readinessChecks,
  isSaving,
}: ReviewConfirmDrawerProps) => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const [activationChoice, setActivationChoice] = useState<'activate' | 'draft'>('draft');
  const [confirmText, setConfirmText] = useState('');
  const [hasReadImpact, setHasReadImpact] = useState(false);

  const isReadyToActivate = readinessChecks.every((check) => check.isComplete || check.advisory);
  const requiresConfirmation = activationChoice === 'activate';
  const confirmationMatch = confirmText.toUpperCase() === 'ACTIVATE';
  const canProceed = activationChoice === 'draft' || (requiresConfirmation && confirmationMatch && hasReadImpact);

  const handleConfirm = () => {
    if (canProceed) {
      onConfirm(activationChoice);
      // Reset state
      setConfirmText('');
      setHasReadImpact(false);
    }
  };

  // Build review items
  const reviewItems: ReviewItem[] = [
    {
      label: 'Trigger Event',
      value: eventType || 'Not configured',
      icon: <GatewayIcon name="ThunderboltOutlined" className="console-text-accent" />,
      critical: true,
    },
    {
      label: 'Target Endpoint',
      value: (
        <Space direction="vertical" size={2}>
          <Text code className="console-type-caption">
            {httpMethod}
          </Text>
          <Text className="console-type-caption console-word-break-all">{targetUrl}</Text>
        </Space>
      ),
      icon: <GatewayIcon name="ApiOutlined" className="console-text-accent" />,
      critical: true,
    },
    {
      label: 'Scope',
      value: scope === 'ALL' ? 'All entities' : scope === 'TENANT' ? 'Current tenant only' : scope,
      icon: <GatewayIcon name="GlobalOutlined" className="console-text-secondary" />,
    },
    {
      label: 'Delivery',
      value: getDeliveryModeLabel(deliveryMode),
      icon: <GatewayIcon name="ClockCircleOutlined" className="console-text-secondary" />,
    },
    {
      label: 'Retry Policy',
      value: retryPolicy,
      icon: <GatewayIcon name="SyncOutlined" className="console-text-secondary" />,
    },
    {
      label: 'Authentication',
      value: authMethod || 'None',
      icon: <GatewayIcon name="LockOutlined" className="console-text-secondary" />,
    },
  ];

  if (transformationType) {
    reviewItems.push({
      label: 'Transformation',
      value: transformationType,
      icon: <GatewayIcon name="ApiOutlined" className="console-text-secondary" />,
    });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={null}
      width={640}
      closable={false}
      styles={{
        body: { padding: 'var(--spacing-0)' },
      }}
    >
      <div className="review-confirm-content">
        {/* Header */}
        <div className="review-confirm-header">
          <Space direction="vertical" size={spacingToNumber(spacing[2])}>
            <Title level={3} className="console-margin-none">
              {isCreating ? 'Final Step: Create Event Rule' : 'Review Changes'}
            </Title>
            <Text type="secondary" className="console-text-secondary">
              {isCreating
                ? 'Review the rule, then choose whether to create it as a draft or create and activate it now.'
                : 'Review what will change before saving or re-activating this event rule.'}
            </Text>
          </Space>
          <Button type="text" icon={<GatewayIcon name="CloseOutlined" />} onClick={onClose} />
        </div>

        {/* Impact Summary */}
        <AstryxText as="p" display="block" type="supporting" className="console-margin-bottom-5">
          {isCreating ? 'You are about to create this rule:' : 'This rule will:'} Automatically send{' '}
          <AstryxText weight="semibold">{httpMethod}</AstryxText> requests to{' '}
          <AstryxText type="code">{targetUrl}</AstryxText> when{' '}
          <AstryxText weight="semibold">{eventType}</AstryxText> events occur{' '}
          {scope === 'ALL' ? 'across all entities' : 'in the current tenant'}.
          {deliveryMode && ` ${getDeliveryModeSummaryText(deliveryMode)}`}
        </AstryxText>

        {/* Configuration Details */}
        <div className="console-margin-bottom-5">
          <Text strong className="review-confirm-section-heading">
            Configuration Details
          </Text>
          <Space direction="vertical" size={spacingToNumber(spacing[3])} className="console-width-full">
            {reviewItems.map((item, idx) => (
              <Row key={idx} gutter={16} align="middle">
                <Col span={1}>
                  <div className="console-type-section">{item.icon}</div>
                </Col>
                <Col span={7}>
                  <Text type="secondary" className="console-caption-secondary">
                    {item.label}
                  </Text>
                </Col>
                <Col span={16}>
                  <div>
                    {typeof item.value === 'string' ? (
                      <Text strong={item.critical} className="console-type-body">
                        {item.value}
                      </Text>
                    ) : (
                      item.value
                    )}
                  </div>
                </Col>
              </Row>
            ))}
          </Space>
        </div>

        <Divider />

        {/* Readiness Checklist */}
        <div className="console-margin-bottom-5">
          <Text strong className="review-confirm-section-heading">
            Readiness Checklist
          </Text>
          <Space direction="vertical" size={spacingToNumber(spacing[2])} className="console-width-full">
            {readinessChecks.map((check, idx) => (
              <div
                key={idx}
                className="review-readiness-check"
                data-state={check.isComplete ? 'complete' : 'incomplete'}
              >
                {check.isComplete ? (
                  <GatewayIcon
                    size="sm"
                    name="CheckCircleOutlined"
                    className="console-text-success console-margin-top-1"
                  />
                ) : (
                  <GatewayIcon
                    size="sm"
                    name="ExclamationCircleOutlined"
                    className="console-text-warning console-margin-top-1"
                  />
                )}
                <div className="console-flex-fill">
                  <Text className="console-type-body">{check.label}</Text>
                  {check.warning && (
                    <div className="console-margin-top-1">
                      <Text type="secondary" className="console-caption-secondary">
                        {check.warning}
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Space>
        </div>

        <Divider />

        {/* Activation Choice */}
        <div className="console-margin-bottom-5">
          <Text strong className="review-confirm-section-heading">
            {isCreating ? 'How should this new rule be created?' : 'What would you like to do?'}
          </Text>
          <Space
            direction="vertical"
            size={spacingToNumber(spacing[2])}
            className="console-width-full"
            role="radiogroup"
            aria-label={isCreating ? 'New rule activation choice' : 'Rule activation choice'}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (
                event.key !== 'ArrowDown' &&
                event.key !== 'ArrowRight' &&
                event.key !== 'ArrowUp' &&
                event.key !== 'ArrowLeft'
              ) {
                return;
              }
              const choices = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')
              ).filter((choice) => !choice.disabled);
              if (choices.length === 0) return;
              const focusedIndex = choices.indexOf(document.activeElement as HTMLButtonElement);
              const selectedIndex = choices.findIndex((choice) => choice.getAttribute('aria-checked') === 'true');
              const current = focusedIndex >= 0 ? focusedIndex : selectedIndex;
              if (current < 0) return;
              const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
              const next = (current + direction + choices.length) % choices.length;
              choices[next]?.focus();
              choices[next]?.click();
              event.preventDefault();
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={activationChoice === 'draft'}
              className="review-activation-choice"
              data-choice="draft"
              data-selected={activationChoice === 'draft'}
              tabIndex={activationChoice === 'draft' ? 0 : -1}
              onClick={() => setActivationChoice('draft')}
            >
              <span className="review-activation-choice-content">
                <GatewayIcon
                  size="md"
                  name="SaveOutlined"
                  className={activationChoice === 'draft' ? 'console-text-accent' : 'console-text-secondary'}
                />
                <span>
                  <Text strong className="console-display-block console-type-control">
                    {isCreating ? 'Create as Draft' : 'Save as Draft'}
                  </Text>
                  <Text type="secondary" className="console-caption-secondary">
                    {isCreating
                      ? 'Create it now, but keep it inactive until you are ready'
                      : 'Keep the rule inactive until you are ready'}
                  </Text>
                </span>
              </span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={activationChoice === 'activate'}
              disabled={!isReadyToActivate}
              className="review-activation-choice"
              data-choice="activate"
              data-selected={activationChoice === 'activate'}
              tabIndex={activationChoice === 'activate' ? 0 : -1}
              onClick={() => setActivationChoice('activate')}
            >
              <span className="review-activation-choice-content">
                <GatewayIcon
                  size="md"
                  name="ThunderboltOutlined"
                  className={activationChoice === 'activate' ? 'console-text-success' : 'console-text-secondary'}
                />
                <span>
                  <Text strong className="console-display-block console-type-control">
                    {isCreating ? 'Create & Activate Now' : 'Activate Immediately'}
                  </Text>
                  <Text type="secondary" className="console-caption-secondary">
                    {isReadyToActivate
                      ? isCreating
                        ? 'Create the rule and start processing events right away'
                        : 'Start processing events right away'
                      : 'Complete all readiness checks first'}
                  </Text>
                </span>
              </span>
            </button>
          </Space>
        </div>

        {/* Activation Confirmation (High-impact action) */}
        {requiresConfirmation && (
          <Notice
            type="warning"
            className="console-margin-bottom-4"
            message="Confirmation Required"
            description={
              <Space
                direction="vertical"
                size={spacingToNumber(spacing[3])}
                className="console-width-full-margin-top-2"
              >
                <Checkbox checked={hasReadImpact} onChange={(e) => setHasReadImpact(e.target.checked)}>
                  <Text className="console-type-body">
                    I understand this rule will immediately start processing events and sending requests to the target
                    endpoint
                  </Text>
                </Checkbox>
                <div>
                  <Text className="console-type-body console-display-block console-margin-bottom-2">
                    Type{' '}
                    <Text strong code>
                      ACTIVATE
                    </Text>{' '}
                    to confirm:
                  </Text>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type ACTIVATE"
                    disabled={!hasReadImpact}
                    style={{
                      borderColor: confirmText && !confirmationMatch ? colors.error[400] : undefined,
                    }}
                  />
                </div>
              </Space>
            }
          />
        )}
      </div>

      {/* Footer Actions */}
      <div className="review-confirm-footer">
        <Button size="middle" onClick={onClose}>
          {isCreating ? 'Back to Setup' : 'Back to Edit'}
        </Button>
        <Button
          type={activationChoice === 'activate' ? 'primary' : 'default'}
          size="middle"
          icon={
            activationChoice === 'activate' ? (
              <GatewayIcon name="ThunderboltOutlined" />
            ) : (
              <GatewayIcon name="SaveOutlined" />
            )
          }
          onClick={handleConfirm}
          disabled={!canProceed}
          loading={isSaving}
        >
          {activationChoice === 'activate'
            ? isCreating
              ? 'Create & Activate'
              : 'Activate Event Rule'
            : isCreating
              ? 'Create Draft'
              : 'Save Draft'}
        </Button>
      </div>
    </Drawer>
  );
};
