import { Button } from 'antd';
import { ApartmentOutlined, HomeOutlined, LogoutOutlined } from '@ant-design/icons';
import { ServerOfflineState } from './ServerOfflineState';
import { classifyTenantError } from '../../utils/tenant-error';

interface Props {
  error: unknown;
  orgId: number;
  userOrgId?: number | null;
  /** SUPER_ADMIN / ADMIN: may open the Org Directory and pick another organization. */
  canBrowseOrgs: boolean;
  onRetry: () => void;
  onOpenOrgDirectory: () => void;
  onGoToOwnOrg: () => void;
  onSignOut: () => void;
}

/**
 * Full-page state when the selected organization cannot be loaded. Says what
 * actually went wrong and offers the next step, instead of reporting every
 * failure as a lost connection.
 */
export const TenantErrorState = ({
  error,
  orgId,
  userOrgId,
  canBrowseOrgs,
  onRetry,
  onOpenOrgDirectory,
  onGoToOwnOrg,
  onSignOut,
}: Props) => {
  const kind = classifyTenantError(error, orgId, userOrgId);
  if (kind === 'offline') {
    return <ServerOfflineState onRetry={onRetry} />;
  }

  const hasOtherOwnOrg = Boolean(userOrgId && userOrgId !== orgId);
  const signOut = (
    <Button size="large" icon={<LogoutOutlined />} onClick={onSignOut}>
      Sign out
    </Button>
  );
  const wayOut = canBrowseOrgs ? (
    <Button type="primary" size="large" icon={<ApartmentOutlined />} onClick={onOpenOrgDirectory}>
      Open Org Directory
    </Button>
  ) : hasOtherOwnOrg ? (
    <Button type="primary" size="large" icon={<HomeOutlined />} onClick={onGoToOwnOrg}>
      Go to my organization
    </Button>
  ) : null;

  const content = {
    'org-missing': {
      title: 'Organization not found',
      description: `Organization ${orgId} does not exist or has been deleted. Check the link, or choose another organization.`,
    },
    'own-org-missing': {
      title: 'Your organization is no longer available',
      description: `Your account belongs to organization ${orgId}, which has been deleted. Ask an administrator to move your account to an active organization.`,
    },
    'no-access': {
      title: 'No access to this organization',
      description: `Your account cannot open organization ${orgId}.`,
    },
  }[kind];

  return (
    <ServerOfflineState
      glyph="searching"
      tone="neutral"
      title={content.title}
      description={content.description}
      actions={
        <>
          {wayOut}
          {signOut}
        </>
      }
    />
  );
};
