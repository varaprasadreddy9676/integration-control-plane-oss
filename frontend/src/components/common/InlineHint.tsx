import type { ReactNode } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from './Icon';
import { cssVar } from '../../design-system/utils';

type InlineHintTone = 'info' | 'warning' | 'success' | 'error';

interface InlineHintProps {
  tone?: InlineHintTone;
  icon?: ReactNode;
  children: ReactNode;
}

const toneIcon: Record<InlineHintTone, ReactNode> = {
  info: <GatewayIcon name="InfoCircleOutlined" />,
  warning: <GatewayIcon name="WarningOutlined" />,
  success: <GatewayIcon name="CheckCircleOutlined" />,
  error: <GatewayIcon name="CloseCircleOutlined" />,
};

/**
 * Compact status note — a smaller, quieter alternative to a full-width antd
 * Alert for routine "here's the current state of this field" messages
 * (e.g. "No restrictions configured"). Reserve full Alert for messages that
 * genuinely need to interrupt the reader.
 */
export const InlineHint = ({ tone = 'info', icon, children }: InlineHintProps) => {
  const toneColor =
    tone === 'error'
      ? cssVar.error.text
      : tone === 'warning'
        ? cssVar.warning.text
        : tone === 'success'
          ? cssVar.success.text
          : cssVar.text.secondary;

  return (
    <div data-tone={tone} className="inline-hint">
      <span className="inline-hint__icon" style={{ color: toneColor }}>
        {icon ?? toneIcon[tone]}
      </span>
      <Text as="span" type="supporting" className="inline-hint__text">
        {children}
      </Text>
    </div>
  );
};
