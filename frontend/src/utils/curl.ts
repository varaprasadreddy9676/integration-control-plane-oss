import type { IntegrationConfig } from '../mocks/types';
import { getApiBaseUrl } from '../services/api';

/**
 * Turn a logged request path into a copyable URL. The backend logs the path after the reverse
 * proxy stripped its mount prefix (e.g. /integration-gateway-server), so restore it from the
 * configured API base.
 */
export function resolveGatewayUrl(requestUrl: string, apiBase: string): string {
  if (/^https?:\/\//i.test(requestUrl)) return requestUrl.trim();
  let origin = '';
  let basePath = '';
  try {
    const parsed = new URL(apiBase);
    origin = parsed.origin;
    basePath = parsed.pathname.replace(/\/$/, '');
  } catch {
    // relative or invalid base: fall through with no origin
  }
  const path = requestUrl.startsWith('/') ? requestUrl : `/${requestUrl}`;
  const loggedPrefix = '/api/v1';
  const needsPrefix =
    basePath.endsWith(loggedPrefix) && basePath !== loggedPrefix && path.startsWith(`${loggedPrefix}/`);
  return `${origin}${needsPrefix ? basePath + path.slice(loggedPrefix.length) : path}`;
}

/**
 * Generate a curl command from integration configuration.
 *
 * Credentials are masked by default, because this command gets copied into
 * tickets and chat. Pass `revealCredentials` to emit a command that actually
 * runs — that is an explicit, deliberate action, gated on an admin in the UI,
 * never the default.
 */
export function generateCurlCommand(
  integration: IntegrationConfig,
  payload: Record<string, unknown>,
  requestHeaders?: Record<string, unknown>,
  options?: {
    direction?: string;
    request?: { url?: string; method?: string };
    orgId?: number | string;
    inboundRequestHeaders?: Record<string, unknown>;
    /** Emit real credential values instead of [REDACTED]. Opt in only. */
    revealCredentials?: boolean;
  }
): string {
  if (!integration && !requestHeaders) return 'N/A';

  const direction = options?.direction;
  const reveal = options?.revealCredentials === true;
  // Single place that decides mask-vs-show, so no branch can forget.
  const maskIf = (isSecret: boolean, actual: unknown) => (isSecret && !reveal ? '[REDACTED]' : actual);
  const isInbound = direction === 'INBOUND';
  const apiBase = getApiBaseUrl();

  const httpMethod = isInbound
    ? String(options?.request?.method || 'GET').toUpperCase()
    : integration?.httpMethod || 'POST';
  const requestUrl = options?.request?.url;
  const targetUrl = isInbound
    ? (() => {
        if (typeof requestUrl === 'string' && requestUrl.trim()) {
          if (/^https?:\/\//i.test(requestUrl)) return requestUrl.trim();
          return resolveGatewayUrl(requestUrl, apiBase);
        }
        const fallbackOrgId = options?.orgId != null ? String(options.orgId) : '<orgId>';
        return `${apiBase}/integrations/${encodeURIComponent((integration as any)?.type || 'integration')}?orgId=${fallbackOrgId}`;
      })()
    : integration?.targetUrl || '';

  let curl = `curl -X ${httpMethod} "${targetUrl}"`;

  if (isInbound) {
    // The caller's own key goes here; the console never holds a gateway key to fill in.
    const gatewayApiKey = reveal ? 'YOUR_API_KEY' : '[REDACTED]';
    curl += ` \\\n  -H "X-API-Key: ${gatewayApiKey}"`;
    if (httpMethod !== 'GET') {
      curl += ` \\\n  -H "Content-Type: application/json"`;
    }
    // For customHeaders placeholders: use actual inbound caller headers for real values
    // (e.g. partnerId: IN2910001941). inboundRequestHeaders = what the caller sent to the gateway.
    const customHeaders = (integration as any)?.customHeaders || {};
    const lowerReqHeaders: Record<string, string> = {};
    const callerHeaders = options?.inboundRequestHeaders || requestHeaders;
    if (callerHeaders && typeof callerHeaders === 'object') {
      Object.entries(callerHeaders).forEach(([k, v]) => {
        lowerReqHeaders[k.toLowerCase()] = String(v);
      });
    }
    // Logs written without the caller's headers still hold what the gateway sent upstream
    // (e.g. x-partner-id: IN123), so a header whose value is exactly "{{partnerId}}" can be read back from it.
    const sentUpstream: Record<string, string> = {};
    if (requestHeaders && typeof requestHeaders === 'object') {
      Object.entries(requestHeaders).forEach(([k, v]) => {
        sentUpstream[k.toLowerCase()] = String(v);
      });
    }
    const seen = new Set<string>();
    Object.entries(customHeaders).forEach(([headerName, value]: [string, unknown]) => {
      const matches = String(value).match(/\{\{(\w+)\}\}/g);
      if (matches) {
        matches.forEach((match: string) => {
          const placeholder = match.replace(/\{\{|\}\}/g, '');
          if (!seen.has(placeholder)) {
            seen.add(placeholder);
            const fromUpstream = String(value).trim() === match ? sentUpstream[headerName.toLowerCase()] : undefined;
            const actual = maskIf(
              isCredentialField(placeholder),
              lowerReqHeaders[placeholder.toLowerCase()] ?? fromUpstream
            );
            curl += ` \\\n  -H "${placeholder}: ${actual ?? `<your-${placeholder}>`}"`;
          }
        });
      }
    });
    if (httpMethod !== 'GET') {
      const payloadStr = JSON.stringify(payload || {}, null, 2);
      curl += ` \\\n  -d '${payloadStr}'`;
    }
    return curl;
  }

  // Custom authentication headers are protected alongside conventional credential headers.
  if (requestHeaders && typeof requestHeaders === 'object') {
    Object.entries(requestHeaders).forEach(([key, value]) => {
      const customAuthHeader = integration?.outgoingAuthConfig?.headerName;
      const isSecret =
        isCredentialField(key) ||
        (typeof customAuthHeader === 'string' && key.toLowerCase() === customAuthHeader.toLowerCase());
      value = maskIf(isSecret, value);
      curl += ` \\\n  -H "${key}: ${value}"`;
    });
  } else if (integration) {
    // Fallback: Reconstruct from integration config (redacted for security)
    curl += ` \\\n  -H "Content-Type: application/json"`;

    // Add auth headers with redaction
    if (integration.outgoingAuthType === 'API_KEY' && integration.outgoingAuthConfig) {
      const headerName = (integration.outgoingAuthConfig.headerName as string) || 'X-API-Key';
      curl += ` \\\n  -H "${headerName}: ${maskIf(true, integration.outgoingAuthConfig.value)}"`;
    } else if (integration.outgoingAuthType === 'BEARER' && integration.outgoingAuthConfig) {
      curl += ` \\\n  -H "Authorization: Bearer ${maskIf(true, integration.outgoingAuthConfig.value)}"`;
    } else if (integration.outgoingAuthType === 'BASIC' && integration.outgoingAuthConfig) {
      curl += ` \\\n  -H "Authorization: Basic [REDACTED]"`;
    }
  }

  // Add complete payload (scrollable in UI)
  if (httpMethod !== 'GET') {
    const payloadStr = JSON.stringify(payload || {}, null, 2);
    curl += ` \\\n  -d '${payloadStr}'`;
  }

  return curl;
}

/**
 * Header/field names that carry secrets. Exported so the delivery-log detail
 * view redacts exactly the same set — it has its own cURL builder, and the two
 * drifting apart is how the unredacted copy survived there.
 */
export function isCredentialField(name: string): boolean {
  return /authorization|cookie|password|secret|token|api[-_]?key|credential|signature/i.test(name);
}
