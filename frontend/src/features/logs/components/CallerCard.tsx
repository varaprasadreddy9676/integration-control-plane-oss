import { App, Descriptions, Space, Tooltip } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from "../../../components/common/Icon";
import { useDesignTokens } from '../../../design-system/utils';
import { copyTextToClipboard } from '../../../utils/clipboard';
import type { CallerInfo } from '../../../utils/caller';
import { Button } from '../../../components/common/LegacyButton';

interface CallerCardProps {
  info: CallerInfo;
  onFilterIp?: (ip: string) => void;
}

const formatBytes = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/** Who called an inbound endpoint: address, client and the route the call took in. */
export const CallerCard = ({ info, onFilterIp }: CallerCardProps) => {
  const { token } = useDesignTokens();
  const { message } = App.useApp();
  const empty = <Text type="supporting" color="secondary">Not sent</Text>;

  const copy = async (value: string, what: string) => {
    const copied = await copyTextToClipboard(value);
    if (copied) message.success(`${what} copied`);
    else message.error('Failed to copy to clipboard');
  };

  // Addresses left of the caller were written by the caller itself, so they are claims, not hops.
  const callerAt = info.clientIp ? info.forwardedChain.lastIndexOf(info.clientIp) : -1;
  const claimed = callerAt > 0 ? info.forwardedChain.slice(0, callerAt) : [];
  const via = callerAt >= 0 ? info.forwardedChain.slice(callerAt + 1) : [];

  return (
    <Descriptions
      size="small"
      column={1}
      colon={false}
      styles={{ label: { width: 150, color: token.colorTextSecondary } }}
      style={{ padding: `${token.paddingXS}px 0` }}
    >
      <Descriptions.Item label="Client IP">
        {info.clientIp ? (
          <Space size="small" wrap>
            <Text type="code">{info.clientIp}</Text>
            <Tooltip title="Copy IP">
              <Button
                size="small"
                type="text"
                icon={<GatewayIcon name="CopyOutlined" />}
                aria-label="Copy client IP"
                onClick={() => copy(info.clientIp as string, 'IP')}
              />
            </Tooltip>
            {onFilterIp && (
              <Button
                size="small"
                type="link"
                icon={<GatewayIcon name="FilterOutlined" />}
                onClick={() => onFilterIp(info.clientIp as string)}
              >
                Show all calls from this IP
              </Button>
            )}
          </Space>
        ) : (
          empty
        )}
      </Descriptions.Item>
      <Descriptions.Item label="Client">
        {info.agent ? (
          <Space size="small" wrap>
            <span>{info.agent.label}</span>
            <Text type="supporting" color="secondary">
              {info.agent.kind === 'browser' ? 'Browser' : info.agent.kind === 'tool' ? 'API tool' : 'Application'}
            </Text>
          </Space>
        ) : (
          empty
        )}
      </Descriptions.Item>
      {info.userAgent && (
        <Descriptions.Item label="User-Agent">
          <Text type="supporting" color="secondary" className="console-word-break-all">
            {info.userAgent}
          </Text>
        </Descriptions.Item>
      )}
      <Descriptions.Item label="Called">{info.host || empty}</Descriptions.Item>
      {(info.protocol || info.port) && (
        <Descriptions.Item label="Connection">
          {[info.protocol?.toUpperCase(), info.port && `port ${info.port}`].filter(Boolean).join(' · ')}
        </Descriptions.Item>
      )}
      {via.length > 0 && (
        <Descriptions.Item label="Passed through">
          <Text type="supporting" color="secondary">{via.join(' → ')}</Text>
        </Descriptions.Item>
      )}
      {claimed.length > 0 && (
        <Descriptions.Item label="Claimed by caller">
          <Tooltip title="The caller put these in X-Forwarded-For itself. They are not verified and are ignored when working out the Client IP.">
            <Text type="supporting" color="secondary">{claimed.join(', ')} (unverified)</Text>
          </Tooltip>
        </Descriptions.Item>
      )}
      {info.origin && <Descriptions.Item label="Origin">{info.origin}</Descriptions.Item>}
      {info.referer && (
        <Descriptions.Item label="Referer">
          <span className="console-word-break-all">{info.referer}</span>
        </Descriptions.Item>
      )}
      {info.contentLength !== null && (
        <Descriptions.Item label="Request size">{formatBytes(info.contentLength)}</Descriptions.Item>
      )}
      {info.requestId && (
        <Descriptions.Item label="Load balancer trace">
          <Space size="small">
            <Text type="supporting" color="secondary">{info.requestId}</Text>
            <Tooltip title="Copy load balancer trace">
              <Button
                size="small"
                type="text"
                icon={<GatewayIcon name="CopyOutlined" />}
                aria-label="Copy load balancer trace"
                onClick={() => copy(info.requestId as string, 'Request ID')}
              />
            </Tooltip>
          </Space>
        </Descriptions.Item>
      )}
    </Descriptions>
  );
};
