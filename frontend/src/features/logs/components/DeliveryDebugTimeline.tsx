import { Descriptions, Space, Timeline } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import { Banner } from '@astryxdesign/core/Banner';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { formatDateTime } from '../../../utils/format';
import { useDesignTokens } from '../../../design-system/utils';
import { StatusBadge } from '../../../components/common/StatusBadge';

const { Text } = Typography;

type DeliveryDebugTimelineProps = {
  protocol: string;
  status?: string | null;
  target?: string | null;
  createdAt?: string | null;
  responseStatus?: number | null;
  responseTimeMs?: number | null;
  classification?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, any> | null;
  compact?: boolean;
};

export function DeliveryDebugTimeline({
  protocol,
  status,
  target,
  createdAt,
  responseStatus,
  responseTimeMs,
  classification,
  errorMessage,
  metadata,
  compact = false,
}: DeliveryDebugTimelineProps) {
  const { spacing } = useDesignTokens();
  const stage = metadata?.errorContext?.stage || metadata?.stage || null;
  const hasResponse = responseStatus !== undefined && responseStatus !== null;

  return (
    <Space direction="vertical" className="console-width-full" size={compact ? 'small' : 'middle'}>
      {classification && classification !== 'Accepted' && (
        <Banner
          status={status === 'SUCCESS' ? 'info' : 'warning'}
          title={classification}
          description={errorMessage || 'Review request, response, and transformation details for this delivery.'}
        />
      )}

      <Timeline className="console-margin-bottom-none"
        items={[
          {
            dot: <GatewayIcon name="ApiOutlined" />,
            color: 'blue',
            children: (
              <Descriptions size="small" column={compact ? 1 : 2}>
                <Descriptions.Item label="Protocol">
                  <AstryxText>{protocol}</AstryxText>
                </Descriptions.Item>
                {createdAt && <Descriptions.Item label="Started">{formatDateTime(createdAt)}</Descriptions.Item>}
                {target && (
                  <Descriptions.Item label="Target" span={compact ? 1 : 2}>
                    <Text code className="console-word-break-all">
                      {target}
                    </Text>
                  </Descriptions.Item>
                )}
              </Descriptions>
            ),
          },
          {
            dot: <GatewayIcon name="SendOutlined" />,
            color: 'blue',
            children: (
              <Space size="small" wrap>
                <Text>Request prepared</Text>
                {stage === 'transformation' && <StatusBadge status="FAILED" label="Failed at transformation" />}
                {stage && stage !== 'transformation' && (
                  <AstryxText type="supporting" color="secondary">
                    {stage}
                  </AstryxText>
                )}
              </Space>
            ),
          },
          {
            dot: hasResponse ? <GatewayIcon name="CheckCircleOutlined" /> : <GatewayIcon name="FieldTimeOutlined" />,
            color: hasResponse ? 'green' : 'gray',
            children: (
              <Space size="small" wrap>
                <Text>{hasResponse ? 'Response captured' : 'No response captured'}</Text>
                {hasResponse && <AstryxText type="code">{responseStatus}</AstryxText>}
                {responseTimeMs !== undefined && responseTimeMs !== null && (
                  <Text type="secondary">{responseTimeMs} ms</Text>
                )}
              </Space>
            ),
          },
          {
            dot:
              status === 'SUCCESS' ? (
                <GatewayIcon name="CheckCircleOutlined" />
              ) : (
                <GatewayIcon name="CloseCircleOutlined" />
              ),
            color: status === 'SUCCESS' ? 'green' : status === 'FAILED' || status === 'ABANDONED' ? 'red' : 'blue',
            children: (
              <Space size="small" wrap>
                <Text>Final status</Text>
                {status && <StatusBadge status={status} />}
                {classification && <Text type="secondary">{classification}</Text>}
              </Space>
            ),
          },
        ]}
      />

      {errorMessage && (
        <Text type="danger" style={{ display: 'block', marginTop: spacing[1], wordBreak: 'break-word' }}>
          {errorMessage}
        </Text>
      )}
    </Space>
  );
}
