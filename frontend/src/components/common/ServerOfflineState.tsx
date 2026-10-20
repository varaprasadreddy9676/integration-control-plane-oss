import { Button } from 'antd';
import { ApiOutlined, SyncOutlined } from '@ant-design/icons';
import { cssVar, useDesignTokens } from '../../design-system/utils';
import { StatePanel } from './StatePanel';
import type { ReactNode } from 'react';
import type { StateGlyph } from './StatePanel';

interface Props {
  onRetry?: () => void;
  title?: string;
  description?: string;
  /** Underlying error text, shown small so it can be quoted in a ticket. */
  detail?: string;
  /** Other full-page problems (for example a missing organization) reuse this layout. */
  glyph?: StateGlyph;
  tone?: 'critical' | 'neutral';
  actions?: ReactNode;
}

export const ServerOfflineState = ({
  onRetry = () => window.location.reload(),
  title = 'Connection lost',
  description = 'We cannot reach the integration gateway right now. Your work is not lost — this screen will recover as soon as the service responds.',
  detail,
  glyph = 'disrupted',
  tone = 'critical',
  actions,
}: Props) => {
  const { spacing } = useDesignTokens();

  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100%',
        display: 'grid',
        placeItems: 'center',
        background: cssVar.bg.base,
        padding: spacing[6],
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: cssVar.bg.surface,
          borderRadius: 12,
          border: `1px solid ${cssVar.border.subtle}`,
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.06)',
        }}
      >
        <StatePanel
          glyph={glyph}
          tone={tone}
          glyphSize={168}
          title={title}
          description={description}
          actions={
            actions ?? (
            <>
              <Button type="primary" size="large" icon={<SyncOutlined />} onClick={onRetry}>
                Retry connection
              </Button>
              <Button size="large" icon={<ApiOutlined />} href="/integration-gateway/docs">
                System status
              </Button>
            </>
            )
          }
          footnote={detail}
        />
      </div>
    </div>
  );
};
