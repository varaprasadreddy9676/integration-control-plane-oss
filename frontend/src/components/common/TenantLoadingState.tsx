import { useEffect, useState } from 'react';
import { Button, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useDesignTokens, cssVar } from '../../design-system/utils';
import { StatePanel } from './StatePanel';

interface Props {
  variant: 'loading' | 'error';
  title: string;
  description: string;
  /** Re-runs the tenant fetch. Falls back to a full reload. */
  onRetry?: () => void;
}

/**
 * How long to wait before admitting something is wrong.
 *
 * The tenant call gates the entire console, and when it hangs — which it does,
 * on a slow or half-down API — the old version of this screen showed a spinner
 * with no timeout, no error and no way out, so the product simply looked dead.
 * After SLOW_AFTER_MS we say it is taking longer than usual; after STUCK_AFTER_MS
 * we stop pretending and offer a retry.
 */
const SLOW_AFTER_MS = 6_000;
const STUCK_AFTER_MS = 15_000;

type Phase = 'normal' | 'slow' | 'stuck';

export const TenantLoadingState = ({ variant, title, description, onRetry }: Props) => {
  const { spacing } = useDesignTokens();
  const [phase, setPhase] = useState<Phase>('normal');

  useEffect(() => {
    if (variant !== 'loading') return;
    const slow = window.setTimeout(() => setPhase('slow'), SLOW_AFTER_MS);
    const stuck = window.setTimeout(() => setPhase('stuck'), STUCK_AFTER_MS);
    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(stuck);
    };
  }, [variant]);

  const retry = onRetry ?? (() => window.location.reload());

  const shellStyle = {
    minHeight: '100dvh',
    display: 'grid',
    placeItems: 'center',
    background: cssVar.bg.base,
    padding: spacing[6],
  } as const;

  const isError = variant === 'error' || phase === 'stuck';

  return (
    <div style={shellStyle}>
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: cssVar.bg.surface,
          border: `1px solid ${cssVar.border.subtle}`,
          borderRadius: 12,
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.06)',
        }}
      >
        <StatePanel
          glyph={isError ? 'disrupted' : 'connecting'}
          tone={isError ? 'critical' : 'busy'}
          glyphSize={140}
          title={
            variant === 'error'
              ? title
              : phase === 'stuck'
                ? 'Still waiting on the gateway'
                : phase === 'slow'
                  ? 'Taking longer than usual'
                  : title
          }
          description={
            variant === 'error'
              ? description
              : phase === 'stuck'
                ? 'The workspace has not responded yet. It may be under load or temporarily unavailable.'
                : phase === 'slow'
                  ? 'Still loading your workspace — hang tight.'
                  : description
          }
          actions={
            isError ? (
              <>
                <Button type="primary" icon={<ReloadOutlined />} onClick={retry}>
                  Try again
                </Button>
                <Button href="/integration-gateway/docs">View docs</Button>
              </>
            ) : undefined
          }
          footnote={
            phase === 'stuck' && variant === 'loading' ? (
              <Typography.Text style={{ fontSize: 12, color: cssVar.text.muted }}>
                If this keeps happening, check the gateway service status with your administrator.
              </Typography.Text>
            ) : undefined
          }
        />
      </div>
    </div>
  );
};
