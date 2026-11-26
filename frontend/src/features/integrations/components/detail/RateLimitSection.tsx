import { Form, InputNumber, Row, Col, Space } from '@/components/common/LegacyAntdControls';
import { Typography } from '@/components/common/LegacyTypography';
import { Icon as GatewayIcon } from '../../../../components/common/Icon';
import { spacingToNumber, cssVar } from '../../../../design-system/utils';
import { InlineHint } from '../../../../components/common/InlineHint';
import { ToggleSettingRow } from '../../../../components/common/ToggleSettingRow';

const { Text } = Typography;

interface RateLimitSectionProps {
  form?: any;
  spacing: any;
}

/**
 * RateLimitSection - Configure per-integration rate limiting
 *
 * Allows users to set:
 * - Enable/disable rate limiting
 * - Maximum requests per window
 * - Window duration in seconds
 */
export const RateLimitSection = ({ form, spacing }: RateLimitSectionProps) => {
  const colors = cssVar.legacy;

  const rateLimitEnabled = Form.useWatch(['rateLimits', 'enabled'], form);

  return (
    <div>
      <ToggleSettingRow
        name={['rateLimits', 'enabled']}
        icon={<GatewayIcon name="ThunderboltOutlined" />}
        title="Per-integration rate limiting"
        description="Limit requests to this integration to prevent abuse or accidental traffic spikes."
      />

      {!rateLimitEnabled && (
        <InlineHint tone="info">
          Rate limiting is disabled. This integration will not enforce any request rate limits.
        </InlineHint>
      )}

      {rateLimitEnabled && (
        <Space direction="vertical" size={spacing[3]} style={{ width: '100%', marginTop: spacing[3] }}>
          <InlineHint tone="warning">
            Requests exceeding the configured limit will be rejected with a 429 status code and a Retry-After header.
          </InlineHint>

          <Row gutter={[spacingToNumber(spacing[4]), 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name={['rateLimits', 'maxRequests']}
                label={
                  <Space size={4}>
                    Maximum Requests
                    <Text type="supporting" color="secondary">
                      per window
                    </Text>
                  </Space>
                }
                rules={[
                  { required: rateLimitEnabled, message: 'Max requests is required when rate limiting is enabled' },
                  {
                    type: 'number',
                    min: 1,
                    max: 10000,
                    message: 'Must be between 1 and 10,000 requests',
                  },
                ]}
                tooltip="Maximum number of requests allowed within the time window"
              >
                <InputNumber
                  min={1}
                  max={10000}
                  step={10}
                  className="console-width-full"
                  addonAfter="requests"
                  placeholder="100"
                />
              </Form.Item>
            </Col>

            <Col xs={24} md={12}>
              <Form.Item
                name={['rateLimits', 'windowSeconds']}
                label={
                  <Space size={4}>
                    Time Window
                    <Text type="supporting" color="secondary">
                      duration
                    </Text>
                  </Space>
                }
                rules={[
                  { required: rateLimitEnabled, message: 'Time window is required when rate limiting is enabled' },
                  {
                    type: 'number',
                    min: 1,
                    max: 3600,
                    message: 'Must be between 1 and 3,600 seconds (1 hour)',
                  },
                ]}
                tooltip="Duration of the rate limit window in seconds. Rate limits are enforced per window."
              >
                <InputNumber
                  min={1}
                  max={3600}
                  step={10}
                  className="console-width-full"
                  addonAfter="seconds"
                  placeholder="60"
                />
              </Form.Item>
            </Col>
          </Row>

          {/* Preview Calculation */}
          <RateLimitPreview form={form} spacing={spacing} colors={colors} />
        </Space>
      )}
    </div>
  );
};

/**
 * Preview component showing calculated rate limit in different time units
 */
const RateLimitPreview = ({ form, spacing, colors }: any) => {
  const maxRequests = Form.useWatch(['rateLimits', 'maxRequests'], form) || 100;
  const windowSeconds = Form.useWatch(['rateLimits', 'windowSeconds'], form) || 60;

  // Calculate rates per minute, hour, day
  const perMinute = Math.floor((maxRequests / windowSeconds) * 60);
  const perHour = Math.floor((maxRequests / windowSeconds) * 3600);
  const perDay = Math.floor((maxRequests / windowSeconds) * 86400);

  return (
    <div
      style={{
        background: colors.primary[50],
        border: `1px solid ${colors.primary[200]}`,
        borderRadius: 8,
        padding: spacing[3],
      }}
    >
      <Space direction="vertical" size={spacing[2]} className="console-width-full">
        <div className="console-flex-center-gap-2">
          <GatewayIcon size="sm" name="ThunderboltOutlined" className="console-text-accent" />
          <Text strong style={{ color: colors.primary[700] }}>
            Rate Limit Preview
          </Text>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: spacing[3] }}>
          <div>
            <Text type="secondary" className="console-caption-block">
              Per {windowSeconds}s window
            </Text>
            <Text strong className="console-title-accent">
              {maxRequests} reqs
            </Text>
          </div>

          {windowSeconds !== 60 && (
            <div>
              <Text type="secondary" className="console-caption-block">
                Per Minute
              </Text>
              <Text strong className="console-type-title">
                ≈ {perMinute.toLocaleString()} reqs
              </Text>
            </div>
          )}

          <div>
            <Text type="secondary" className="console-caption-block">
              Per Hour
            </Text>
            <Text strong className="console-type-title">
              ≈ {perHour.toLocaleString()} reqs
            </Text>
          </div>

          <div>
            <Text type="secondary" className="console-caption-block">
              Per Day
            </Text>
            <Text strong className="console-type-title">
              ≈ {perDay.toLocaleString()} reqs
            </Text>
          </div>
        </div>

        <InlineHint tone="info">
          Sliding window: requests are counted within {windowSeconds}-second windows. Each request checks whether the
          limit has been reached in the current window.
        </InlineHint>
      </Space>
    </div>
  );
};
