import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { CheckCircleOutlined, InfoCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { cssVar, useDesignTokens } from '../../design-system/utils';

type InlineHintTone = 'info' | 'warning' | 'success';

interface InlineHintProps {
  tone?: InlineHintTone;
  icon?: ReactNode;
  children: ReactNode;
}

const toneIcon: Record<InlineHintTone, ReactNode> = {
  info: <InfoCircleOutlined />,
  warning: <WarningOutlined />,
  success: <CheckCircleOutlined />,
};

/**
 * Compact status note — a smaller, quieter alternative to a full-width antd
 * Alert for routine "here's the current state of this field" messages
 * (e.g. "No restrictions configured"). Reserve full Alert for messages that
 * genuinely need to interrupt the reader.
 */
export const InlineHint = ({ tone = 'info', icon, children }: InlineHintProps) => {
  const { spacing } = useDesignTokens();
  const colors = cssVar.legacy;
  const toneColor =
    tone === 'warning' ? colors.warning[600] : tone === 'success' ? colors.success[600] : cssVar.text.secondary;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing[2], marginTop: spacing[1] }}>
      <span style={{ color: toneColor, fontSize: 13, lineHeight: 1.6 }}>{icon ?? toneIcon[tone]}</span>
      <Typography.Text type="secondary" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        {children}
      </Typography.Text>
    </div>
  );
};
