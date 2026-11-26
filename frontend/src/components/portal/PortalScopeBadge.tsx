import { Tooltip } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from '../common/Icon';
import { useAuth } from '../../app/auth-context';
import { StatusBadge } from '../common/StatusBadge';

interface StoredUser {
  isPortalSession?: boolean;
  allowedIntegrationIds?: string[];
  allowedTags?: string[];
  allowedViews?: string[];
  profileId?: string;
}

/**
 * PortalScopeBadge
 *
 * Renders a visible "Scoped View" badge when the current session is a portal
 * session with integration restrictions. Helps users understand they are seeing
 * a limited subset of integrations.
 *
 * Accessibility:
 * - Uses the shared Astryx status-badge component
 * - Tooltip provides additional context for screen readers
 * - Icon has aria-hidden (decorative)
 */
export const PortalScopeBadge = () => {
  const { user } = useAuth();

  const storedUser = (() => {
    try {
      const raw = localStorage.getItem('integration_gateway_user');
      return raw ? (JSON.parse(raw) as StoredUser) : null;
    } catch {
      return null;
    }
  })();

  if (!user?.isPortalSession && !storedUser?.isPortalSession) return null;

  const allowedIds = storedUser?.allowedIntegrationIds ?? [];
  const allowedTags = storedUser?.allowedTags ?? [];
  const allowedViews = storedUser?.allowedViews ?? [];

  const hasIdScope = allowedIds.length > 0;
  const hasTagScope = allowedTags.length > 0;
  const isScoped = hasIdScope || hasTagScope;

  const tooltipParts: string[] = [];
  if (hasIdScope) tooltipParts.push(`${allowedIds.length} integration(s)`);
  if (hasTagScope) tooltipParts.push(`tags: ${allowedTags.join(', ')}`);
  if (allowedViews.length > 0) tooltipParts.push(`views: ${allowedViews.join(', ')}`);

  const tooltipContent = isScoped
    ? `Scoped portal view — ${tooltipParts.join(' · ')}`
    : `Portal session — all org integrations visible · ${tooltipParts[tooltipParts.length - 1] || ''}`;

  return (
    <Tooltip title={tooltipContent} placement="bottomLeft">
      <span role="status" aria-label={isScoped ? `Portal scoped to ${tooltipParts.join(' and ')}` : 'Portal session'}>
        <StatusBadge
          label={
            <>
              <GatewayIcon name="EyeOutlined" aria-hidden="true" /> {isScoped ? 'Scoped view' : 'Portal session'}
            </>
          }
          variant={isScoped ? 'info' : 'neutral'}
        />
      </span>
    </Tooltip>
  );
};
