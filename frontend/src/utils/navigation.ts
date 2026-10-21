import { useLocation, useNavigate, NavigateOptions } from 'react-router-dom';
import { useCallback, useRef } from 'react';
import { withViewTransition } from '../design-system/view-transition';

const EXTERNAL_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const SPECIAL_PROTOCOL_PATTERN = /^(?:mailto:|tel:|sms:)/i;

const getCurrentOrgIdFromUrl = (): string | null => {
  const currentParams = new URLSearchParams(window.location.search);
  return currentParams.get('orgId');
};

/**
 * Custom hook that wraps useNavigate to automatically preserve orgId query parameter
 * This ensures the parameter persists across all navigation throughout the app
 */
export const useNavigateWithParams = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // A ref, so the returned function keeps one identity across route changes.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const navigateWithParams = useCallback((to: string | number, options?: NavigateOptions) => {
    // If navigating back/forward with a number, use default navigate
    if (typeof to === 'number') {
      return navigate(to);
    }

    if (typeof to === 'string') {
      const target = buildUrlWithOrgId(to);
      // Animate moves between pages; a query-only change (filters, tabs) stays instant.
      const current = pathnameRef.current;
      const changesPage = new URL(target, `http://router${current}`).pathname !== current;
      if (changesPage) {
        withViewTransition(() => navigate(target, options));
        return;
      }
      return navigate(target, options);
    }

    return navigate(to, options);
  }, [navigate]);

  return navigateWithParams;
};

/**
 * Helper to build URLs with orgId preserved
 * Useful for Link components or manual URL construction
 */
export const buildUrlWithOrgId = (path: string): string => {
  if (!path || EXTERNAL_URL_PATTERN.test(path) || SPECIAL_PROTOCOL_PATTERN.test(path)) {
    return path;
  }

  const orgId = getCurrentOrgIdFromUrl();
  if (!orgId) return path;

  const hashIndex = path.indexOf('#');
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;

  const queryIndex = withoutHash.indexOf('?');
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const queryString = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';

  const params = new URLSearchParams(queryString);
  params.set('orgId', orgId);

  const rebuiltQuery = params.toString();
  return `${pathname}${rebuiltQuery ? `?${rebuiltQuery}` : ''}${hash}`;
};

/**
 * Record identifiers are tenant-owned. When the tenant changes, keep users on
 * tenant-safe pages but leave record detail routes so an old ID is never opened
 * under the new organization.
 */
/** Only an open organization has unsaved work to lose; picking the first one needs no confirmation. */
export const shouldConfirmOrgSwitch = (currentOrgId: number | null | undefined): boolean => Boolean(currentOrgId);

export const getOrgSwitchDestination = (pathname: string): string | null => {
  const detailRoutes: Array<{ pattern: RegExp; destination: string }> = [
    { pattern: /^\/integrations\/(?!new(?:\/|$))[^/]+$/, destination: '/integrations' },
    { pattern: /^\/inbound-integrations\/[^/]+$/, destination: '/integrations?tab=inbound' },
    { pattern: /^\/scheduled-jobs\/[^/]+$/, destination: '/scheduled-jobs' },
    { pattern: /^\/lookups\/(?!stats(?:\/|$))[^/]+$/, destination: '/lookups' },
    { pattern: /^\/templates\/(?!new(?:\/|$))[^/]+$/, destination: '/templates' },
    { pattern: /^\/logs\/[^/]+$/, destination: '/logs' },
    { pattern: /^\/versions\/[^/]+$/, destination: '/integrations' },
    { pattern: /^\/flow-builder\/(?!new(?:\/|$))[^/]+$/, destination: '/flow-builder' },
  ];

  return detailRoutes.find(({ pattern }) => pattern.test(pathname))?.destination ?? null;
};
