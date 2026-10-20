export interface UserAgentInfo {
  /** Short name to show, e.g. "Chrome on macOS" or "curl 8.7.1". */
  label: string;
  kind: 'browser' | 'tool' | 'app' | 'unknown';
}

export interface CallerInfo {
  clientIp: string | null;
  /** Every address in X-Forwarded-For, caller side first. */
  forwardedChain: string[];
  userAgent: string | null;
  agent: UserAgentInfo | null;
  host: string | null;
  protocol: string | null;
  port: string | null;
  origin: string | null;
  referer: string | null;
  contentLength: number | null;
  requestId: string | null;
}

const header = (headers: Record<string, unknown>, name: string): string | null => {
  const value = headers[name];
  if (value === undefined || value === null || value === '') return null;
  return Array.isArray(value) ? value.join(', ') : String(value);
};

const isPrivateIp = (ip: string): boolean => {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
};

const cleanIp = (raw: string): string | null => {
  let v = raw.trim();
  const bracket = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) v = bracket[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(':'));
  if (v.toLowerCase().startsWith('::ffff:') && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(v.slice(7))) v = v.slice(7);
  const isV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(v);
  const isV6 = v.includes(':') && /^[0-9a-f:.]+$/i.test(v);
  return isV4 || isV6 ? v : null;
};

/**
 * Same rule the backend applies when it stores clientIp: proxies append on the right, so the
 * first public address walking from the right is the caller. Used for logs written before the
 * backend stored it.
 */
export function resolveClientIpFromChain(forwardedFor: string | null): string | null {
  const chain = (forwardedFor || '')
    .split(',')
    .map(cleanIp)
    .filter((ip): ip is string => Boolean(ip));
  if (chain.length === 0) return null;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!isPrivateIp(chain[i])) return chain[i];
  }
  return chain[chain.length - 1];
}

const OS_PATTERNS: Array<[RegExp, string]> = [
  [/Windows NT/i, 'Windows'],
  [/Android/i, 'Android'],
  [/iPhone|iPad|iPod|iOS/i, 'iOS'],
  [/Mac OS X|Macintosh/i, 'macOS'],
  [/CrOS/i, 'ChromeOS'],
  [/Linux|X11/i, 'Linux'],
];

const TOOL_PATTERNS: Array<[RegExp, string]> = [
  [/^curl\/([\d.]+)/i, 'curl'],
  [/PostmanRuntime\/([\d.]+)/i, 'Postman'],
  [/insomnia\/([\d.]+)/i, 'Insomnia'],
  [/^python-requests\/([\d.]+)/i, 'python-requests'],
  [/^axios\/([\d.]+)/i, 'axios'],
  [/^node-fetch\/([\d.]+)|^node-fetch/i, 'node-fetch'],
  [/^okhttp\/([\d.]+)/i, 'OkHttp'],
  [/^Apache-HttpClient\/([\d.]+)/i, 'Apache HttpClient'],
  [/^Java\/([\d.]+)/i, 'Java'],
  [/^Go-http-client\/([\d.]+)/i, 'Go HTTP client'],
  [/^Dart\/([\d.]+)/i, 'Dart'],
  [/^got\b/i, 'got'],
  [/^undici/i, 'undici'],
  [/^Wget\/([\d.]+)/i, 'Wget'],
  [/^HTTPie\/([\d.]+)/i, 'HTTPie'],
];

const BROWSER_PATTERNS: Array<[RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\/([\d.]+)/i, 'Edge'],
  [/OPR\/([\d.]+)|Opera\/([\d.]+)/i, 'Opera'],
  [/(?:Chrome|CriOS)\/([\d.]+)/i, 'Chrome'],
  [/(?:Firefox|FxiOS)\/([\d.]+)/i, 'Firefox'],
  [/Version\/([\d.]+).*Safari/i, 'Safari'],
];

/** Read what is useful from a User-Agent string; unknown agents are shown as they are. */
export function parseUserAgent(userAgent: string | null): UserAgentInfo | null {
  const ua = (userAgent || '').trim();
  if (!ua) return null;

  for (const [pattern, name] of TOOL_PATTERNS) {
    const match = ua.match(pattern);
    if (match) {
      const version = match.slice(1).find(Boolean);
      return { label: version ? `${name} ${version}` : name, kind: 'tool' };
    }
  }

  const os = OS_PATTERNS.find(([pattern]) => pattern.test(ua))?.[1];
  if (/Mozilla\//i.test(ua)) {
    for (const [pattern, name] of BROWSER_PATTERNS) {
      const match = ua.match(pattern);
      if (match) {
        const major = (match.slice(1).find(Boolean) || '').split('.')[0];
        const browser = major ? `${name} ${major}` : name;
        return { label: os ? `${browser} on ${os}` : browser, kind: 'browser' };
      }
    }
    return { label: os ? `Browser on ${os}` : ua, kind: 'browser' };
  }

  // Anything else is usually a named client such as "AcmeApp/2.3 (Android)": show it verbatim.
  return { label: ua.length > 80 ? `${ua.slice(0, 77)}…` : ua, kind: 'app' };
}

/**
 * Who called an inbound endpoint, from the headers the gateway saved. `storedClientIp` is the
 * backend-resolved value on newer logs; older logs are resolved here from X-Forwarded-For.
 */
export function getCallerInfo(
  inboundHeaders: Record<string, unknown> | null | undefined,
  storedClientIp?: string | null
): CallerInfo | null {
  const headers: Record<string, unknown> = {};
  Object.entries(inboundHeaders || {}).forEach(([k, v]) => {
    headers[k.toLowerCase()] = v;
  });

  const forwardedFor = header(headers, 'x-forwarded-for');
  const clientIp = storedClientIp || resolveClientIpFromChain(forwardedFor);
  const userAgent = header(headers, 'user-agent');
  if (!clientIp && !userAgent && !forwardedFor) return null;

  const contentLength = Number(header(headers, 'content-length'));
  return {
    clientIp,
    forwardedChain: (forwardedFor || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
    userAgent,
    agent: parseUserAgent(userAgent),
    host: header(headers, 'x-forwarded-host') || header(headers, 'host'),
    protocol: header(headers, 'x-forwarded-proto'),
    port: header(headers, 'x-forwarded-port'),
    origin: header(headers, 'origin'),
    referer: header(headers, 'referer'),
    contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null,
    requestId: header(headers, 'x-amzn-trace-id') || header(headers, 'x-request-id'),
  };
}
