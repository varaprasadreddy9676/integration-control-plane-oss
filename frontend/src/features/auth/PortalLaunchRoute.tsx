import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
import { StatePanel } from '../../components/common/StatePanel';
import { PageTemplate } from '../../components/common/PageTemplate';
import { exchangePortalLaunchCredential } from '../../services/api';

const ORG_STORAGE_KEY = 'integration_gateway_org_id';
const LEGACY_ORG_STORAGE_KEY = 'integration_gateway_entity_rid';

type LaunchCredential = { pid: string; secret: string };

export const PortalLaunchRoute = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const retryActionRef = useRef<HTMLDivElement>(null);
  const credentialsRef = useRef<LaunchCredential | null>(null);
  const requestIdRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const launchPortal = useCallback(
    async (pid: string, secret: string) => {
      const requestId = ++requestIdRef.current;
      setError(null);
      setIsLoading(true);

      try {
        const result = await exchangePortalLaunchCredential(pid, secret);
        if (requestId !== requestIdRef.current) return;

        localStorage.setItem('integration_gateway_token', result.accessToken);
        localStorage.setItem('portal_refresh_token', result.refreshToken);
        localStorage.setItem(
          'integration_gateway_user',
          JSON.stringify({
            id: `portal_${result.profile.id}`,
            email: `portal@profile-${result.profile.id}.local`,
            role: result.profile.role,
            orgId: result.profile.orgId,
            isPortalSession: true,
            profileId: result.profile.id,
            allowedIntegrationIds: result.profile.allowedIntegrationIds,
            allowedTags: result.profile.allowedTags,
            allowedViews: result.profile.allowedViews,
          })
        );
        const orgIdValue = String(result.profile.orgId);
        localStorage.setItem(ORG_STORAGE_KEY, orgIdValue);
        sessionStorage.setItem(ORG_STORAGE_KEY, orgIdValue);
        localStorage.setItem(LEGACY_ORG_STORAGE_KEY, orgIdValue);
        sessionStorage.setItem(LEGACY_ORG_STORAGE_KEY, orgIdValue);

        window.dispatchEvent(new Event('auth-storage'));
        const allowedViews = result.profile.allowedViews ?? ['dashboard'];
        const firstView = allowedViews.includes('dashboard')
          ? '/dashboard'
          : allowedViews.includes('logs')
            ? '/logs'
            : allowedViews.includes('system_status')
              ? '/status/system'
              : '/dashboard';
        const nextParams = new URLSearchParams({ embedded: 'true', orgId: orgIdValue });
        credentialsRef.current = null;
        navigate(`${firstView}?${nextParams.toString()}`, { replace: true });
      } catch (err: unknown) {
        if (requestId !== requestIdRef.current) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to launch portal';
        setError(errorMessage || 'The portal link may have expired or been revoked.');
        setIsLoading(false);
      }
    },
    [navigate]
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pid = params.get('pid');
    const secret = params.get('secret');

    if (!pid || !secret) {
      setError('The launch link is invalid or incomplete. Ask your administrator for a new link.');
      setIsLoading(false);
      return;
    }

    credentialsRef.current = { pid, secret };
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('pid');
      clean.searchParams.delete('secret');
      window.history.replaceState({}, '', clean.toString());
    } catch {
      // Continue the exchange if browser history cleanup is unavailable.
    }

    void launchPortal(pid, secret);
    return () => {
      requestIdRef.current += 1;
    };
  }, [launchPortal, location.search]);

  useEffect(() => {
    if (!error || !credentialsRef.current) return;
    requestAnimationFrame(() => retryActionRef.current?.querySelector('button')?.focus());
  }, [error]);

  const handleRetry = () => {
    const credentials = credentialsRef.current;
    if (credentials) void launchPortal(credentials.pid, credentials.secret);
  };

  if (isLoading) {
    return (
      <PageTemplate as="main" className="portal-launch-page" contentClassName="portal-launch-page__content">
        <StatePanel
          glyph="connecting"
          tone="busy"
          size="full"
          title="Securing portal session"
          description="Validating the launch link and preparing your workspace."
        />
      </PageTemplate>
    );
  }

  if (error) {
    return (
      <PageTemplate as="main" className="portal-launch-page" contentClassName="portal-launch-page__content">
        <StatePanel
          glyph="disrupted"
          tone="critical"
          size="regular"
          title="Portal access unavailable"
          description="We could not establish your secure session. Contact your administrator if the problem continues."
          footnote={error}
          actions={
            credentialsRef.current ? (
              <div ref={retryActionRef}>
                <AstryxButton label="Retry launch" variant="secondary" onClick={handleRetry} />
              </div>
            ) : undefined
          }
        />
      </PageTemplate>
    );
  }

  return null;
};
