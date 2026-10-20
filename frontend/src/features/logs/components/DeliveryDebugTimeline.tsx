import { Alert, Descriptions, Space, Tag, Timeline, Typography } from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FieldTimeOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { formatDateTime } from '../../../utils/format';
import { useDesignTokens } from '../../../design-system/utils';

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

function statusColor(status?: string | null) {
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED' || status === 'ABANDONED') return 'error';
  if (status === 'RETRYING' || status === 'PENDING') return 'processing';
  return 'default';
}

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
    <Space direction="vertical" style={{ width: '100%' }} size={compact ? 'small' : 'middle'}>
      {classification && classification !== 'Accepted' && (
        <Alert
          type={status === 'SUCCESS' ? 'info' : 'warning'}
          showIcon
          message={classification}
          description={errorMessage || 'Review request, response, and transformation details for this delivery.'}
        />
      )}

      <Timeline
        style={{ marginBottom: 0 }}
        items={[
          {
            dot: <ApiOutlined />,
            color: 'blue',
            children: (
              <Descriptions size="small" column={compact ? 1 : 2}>
                <Descriptions.Item label="Protocol">
                  <Tag>{protocol}</Tag>
                </Descriptions.Item>
                {createdAt && <Descriptions.Item label="Started">{formatDateTime(createdAt)}</Descriptions.Item>}
                {target && (
                  <Descriptions.Item label="Target" span={compact ? 1 : 2}>
                    <Text code style={{ wordBreak: 'break-all' }}>
                      {target}
                    </Text>
                  </Descriptions.Item>
                )}
              </Descriptions>
            ),
          },
          {
            dot: <SendOutlined />,
            color: 'blue',
            children: (
              <Space size="small" wrap>
                <Text>Request prepared</Text>
                {stage === 'transformation' && <Tag color="error">failed at transformation</Tag>}
                {stage && stage !== 'transformation' && <Tag>{stage}</Tag>}
              </Space>
            ),
          },
          {
            dot: hasResponse ? <CheckCircleOutlined /> : <FieldTimeOutlined />,
            color: hasResponse ? 'green' : 'gray',
            children: (
              <Space size="small" wrap>
                <Text>{hasResponse ? 'Response captured' : 'No response captured'}</Text>
                {hasResponse && <Tag color={responseStatus && responseStatus >= 200 && responseStatus < 300 ? 'success' : 'error'}>{responseStatus}</Tag>}
                {responseTimeMs !== undefined && responseTimeMs !== null && <Text type="secondary">{responseTimeMs} ms</Text>}
              </Space>
            ),
          },
          {
            dot: status === 'SUCCESS' ? <CheckCircleOutlined /> : <CloseCircleOutlined />,
            color: status === 'SUCCESS' ? 'green' : status === 'FAILED' || status === 'ABANDONED' ? 'red' : 'blue',
            children: (
              <Space size="small" wrap>
                <Text>Final status</Text>
                {status && <Tag color={statusColor(status)}>{status}</Tag>}
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
