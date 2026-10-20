export type TenantErrorKind = 'org-missing' | 'own-org-missing' | 'no-access' | 'offline';

/**
 * Why the selected organization could not be loaded. Only a failure to reach
 * the gateway is a connection problem; a missing or forbidden organization
 * needs its own message and a way out.
 */
export function classifyTenantError(
  error: unknown,
  requestedOrgId: number,
  userOrgId: number | null | undefined
): TenantErrorKind {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status === 404) {
    return userOrgId && userOrgId === requestedOrgId ? 'own-org-missing' : 'org-missing';
  }
  if (status === 403) return 'no-access';
  return 'offline';
}
