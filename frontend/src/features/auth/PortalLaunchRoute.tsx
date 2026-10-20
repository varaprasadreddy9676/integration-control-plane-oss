import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Spin, Alert, Typography, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { exchangePortalLaunchCredential } from '../../services/api';

const { Paragraph, Text } = Typography;
const ORG_STORAGE_KEY = 'integration_gateway_org_id';
const LEGACY_ORG_STORAGE_KEY = 'integration_gateway_entity_rid';

/**
 * PortalLaunchRoute
 *
 * Public route: /portal/launch?pid=<profileId>&secret=<linkSecret>
 *
 * This page:
 *   1. Reads pid + secret from query params.
 *   2. Calls POST /auth/portal/launch to exchange them for a short-lived access
 *      token + refresh token (server-side validation, not client-side JWT parsing).
 *   3. Stores the tokens in localStorage and fires auth-storage event.
 *   4. Redirects to the configured embedded view (dashboard or logs).
 *   5. Cleans the pid/secret from the URL so they are not preserved in history.
 *
 * The tokens replace the old "magic JWT in URL" pattern — the launch URL contains
 * only an opaque credential; the actual session token is issued by the server.
 *
 * Accessibility:
 * - Proper focus management on error states
 * - ARIA live regions for status announcements
 * - Keyboard-accessible retry button
 * - Semantic HTML structure
 */
export const PortalLaunchRoute = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pid = params.get('pid');
    const secret = params.get('secret');

    if (!pid || !secret) {
      setError('Invalid portal launch link. Missing required parameters.');
      setIsLoading(false);
      return;
    }

    // Clean the credentials from the URL immediately before any async work
    // so they are not stored in browser history.
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('pid');
      clean.searchParams.delete('secret');
      window.history.replaceState({}, '', clean.toString());
    } catch {
      // URL cleanup failure is non-critical, continue with auth flow
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await exchangePortalLaunchCredential(pid, secret);

        if (cancelled) return;

        // Store access token + refresh token
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

        // Notify other tabs/windows of auth change
        window.dispatchEvent(new Event('auth-storage'));

        // Redirect to the first allowed view
        const allowedViews = result.profile.allowedViews ?? ['dashboard'];
        const firstView = allowedViews.includes('dashboard')
          ? '/dashboard'
          : allowedViews.includes('logs')
            ? '/logs'
            : allowedViews.includes('system_status')
              ? '/status/system'
              : '/dashboard';
        const nextParams = new URLSearchParams({
          embedded: 'true',
          orgId: orgIdValue,
        });
        navigate(`${firstView}?${nextParams.toString()}`, { replace: true });
      } catch (err: unknown) {
        if (!cancelled) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to launch portal';
          setError(errorMessage || 'Failed to launch portal. The link may be expired or revoked.');
          setIsLoading(false);

          // Focus retry button for keyboard users
          requestAnimationFrame(() => {
            retryButtonRef.current?.focus();
          });
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle retry by reloading the page (user needs to re-enter credentials)
  const handleRetry = () => {
    window.location.reload();
  };

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          padding: 24,
          minHeight: '400px'
        }}
        role="status"
        aria-live="polite"
        aria-label="Launching portal"
      >
        <Space direction="vertical" size="middle" align="center">
          <Spin size="large" tip="Launching portal..." />
          <Text type="secondary" style={{ fontSize: 14 }}>
            Please wait while we set up your secure session...
          </Text>
        </Space>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          padding: 24
        }}
      >
        <div style={{ maxWidth: 480, width: '100%' }}>
          <Alert
            message="Portal Access Failed"
            description={error}
            type="error"
            showIcon
            role="alert"
            aria-live="assertive"
          />

          <div style={{ marginTop: 24 }}>
            <Paragraph type="secondary" style={{ marginBottom: 16, textAlign: 'center' }}>
              Contact your administrator to get a new portal link.
            </Paragraph>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Button
                ref={retryButtonRef}
                type="primary"
                icon={<ReloadOutlined />}
                onClick={handleRetry}
              >
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Fallback (should not reach here)
  return null;
};
