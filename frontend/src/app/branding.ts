/**
 * Product branding, resolved in this order:
 *   1. the organisation's `branding` in the `ui_config` document;
 *   2. the deployment's environment (VITE_APP_NAME / VITE_WORKSPACE_NAME / VITE_LOGO_URL);
 *   3. the generic defaults below.
 *
 * A fork sets environment values; an organisation can override them from the
 * console. Nothing here is Medics-specific — the wordmark in the rail, the
 * login screen, the document title and the mobile header all read from this.
 */
export interface Branding {
  /** The product's name, e.g. "Integration Gateway". */
  productName: string;
  /** Optional workspace/brand shown above the product name in the rail. */
  workspaceName: string | null;
  /** Optional logo URL; falls back to the built-in mark. */
  logoUrl: string | null;
}

const env = import.meta.env as unknown as Record<string, string | undefined>;

const clean = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const DEFAULT_BRANDING: Branding = {
  productName: clean(env.VITE_APP_NAME) ?? 'Integration Gateway',
  workspaceName: clean(env.VITE_WORKSPACE_NAME),
  logoUrl: clean(env.VITE_LOGO_URL),
};

/** Accepts arbitrary persisted input and always returns a complete branding object. */
export const normalizeBranding = (input: unknown): Branding => {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof Branding, unknown>>;
  return {
    productName: clean(raw.productName) ?? DEFAULT_BRANDING.productName,
    // An explicit empty string means "no workspace wordmark", not "use default".
    workspaceName:
      raw.workspaceName === '' ? null : (clean(raw.workspaceName) ?? DEFAULT_BRANDING.workspaceName),
    logoUrl: raw.logoUrl === '' ? null : (clean(raw.logoUrl) ?? DEFAULT_BRANDING.logoUrl),
  };
};

export const brandingDocumentTitle = (branding: Branding): string =>
  branding.workspaceName ? `${branding.workspaceName} · ${branding.productName}` : branding.productName;
