import { useEffect, useRef, useState } from 'react';
import { Input, Radio, Select, Space, Typography } from 'antd';
import type { CredentialOption, StageConfig } from '../../../../services/stages-api';
import { KeyValueEditor } from './SchemaForm';

const { Text } = Typography;

type Auth = StageConfig['auth'];
type Mode = 'bearer' | 'apiKey' | 'custom';

/** The value a credential most likely holds when it has several, in the order worth trying. */
const LIKELY_FIELDS = ['token', 'accessToken', 'access_token', 'apiKey', 'api_key', 'key', 'secret'];
const bestField = (fields: Array<{ key: string }>) =>
  LIKELY_FIELDS.find((name) => fields.some((field) => field.key === name)) || fields[0]?.key || 'token';

const ref = (field: string) => `{{ credential.${field} }}`;
const BEARER = /^Bearer \{\{ credential\.([\w-]+) \}\}$/;
const PLAIN = /^\{\{ credential\.([\w-]+) \}\}$/;

/** How the headers send the credential, in the three ways people ask for. */
const readHeaders = (headers: Record<string, string> | undefined): { mode: Mode; field?: string; name?: string } => {
  const entries = Object.entries(headers || {});
  if (entries.length === 0) return { mode: 'bearer' };
  if (entries.length === 1) {
    const [name, value] = entries[0];
    const bearer = name === 'Authorization' ? BEARER.exec(value) : null;
    if (bearer) return { mode: 'bearer', field: bearer[1] };
    const plain = name !== 'Authorization' ? PLAIN.exec(value) : null;
    if (plain) return { mode: 'apiKey', field: plain[1], name };
  }
  return { mode: 'custom' };
};

const buildHeaders = (mode: Mode, field: string, name: string): Record<string, string> =>
  mode === 'apiKey' ? { [name || 'X-API-Key']: ref(field) } : { Authorization: `Bearer ${ref(field)}` };

/** The address (scheme, host, port) a call goes to, when the step says it plainly. */
const originOf = (url?: string): string | null => {
  if (!url || url.includes('{{')) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

interface StepSignInProps {
  auth: Auth;
  onChange: (auth: Auth) => void;
  /** The organization's credentials; undefined when they could not be listed. */
  credentials?: CredentialOption[];
  /** The address the step calls, when it has one (an HTTP step): the sign-in is sent only there. */
  url?: string;
  errors?: { credentialRef?: string; headers?: string; allowedOrigins?: string };
}

const Block = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) => (
  <div>
    <Text strong style={{ display: 'block', marginBottom: 4 }}>
      {label}
    </Text>
    {children}
    {hint && !error && (
      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
        {hint}
      </Text>
    )}
    {error && (
      <Text type="danger" role="alert" style={{ display: 'block', fontSize: 12 }}>
        {error}
      </Text>
    )}
  </div>
);

/**
 * How a step signs in to the service it calls, in three plain choices. A saved credential is sent as a
 * bearer token or an API key header without the person writing a template, and it is sent only to the
 * address the step calls, which is filled in and kept in step with the address.
 */
export const StepSignIn = ({ auth, onChange, credentials, url, errors = {} }: StepSignInProps) => {
  const origin = originOf(url);
  const mode: 'none' | 'integration' | 'credential' = auth ? (auth.source === 'integration' ? 'integration' : 'credential') : 'none';
  const origins = auth?.allowedOrigins || [];
  const [moreAddresses, setMoreAddresses] = useState(false);

  // The sign-in goes only to the address the step calls: follow it, unless the person chose their own.
  const lastOrigin = useRef(origin);
  useEffect(() => {
    const previous = lastOrigin.current;
    lastOrigin.current = origin;
    if (!auth || !origin) return;
    const following = origins.length === 0 || (origins.length === 1 && origins[0] === previous);
    if (following && origins[0] !== origin) onChange({ ...auth, allowedOrigins: [origin] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, auth?.source, auth?.credentialRef]);

  const choose = (next: 'none' | 'integration' | 'credential') => {
    if (next === 'none') return onChange(undefined);
    const allowedOrigins = origin ? [origin] : origins;
    if (next === 'integration') return onChange({ source: 'integration', allowedOrigins });
    onChange({ credentialRef: '', headers: {}, allowedOrigins });
  };

  const chosen = credentials?.find((option) => option.placeholderId === auth?.credentialRef);
  const fields = chosen?.fields || [];
  const sent = readHeaders(auth?.headers);
  const field = sent.field && fields.some((entry) => entry.key === sent.field) ? sent.field : bestField(fields);
  const headerName = sent.name || 'X-API-Key';

  const send = (nextMode: Mode, nextField = field, nextName = headerName) => {
    if (!auth) return;
    onChange({ ...auth, headers: nextMode === 'custom' ? auth.headers || {} : buildHeaders(nextMode, nextField, nextName) });
  };

  const pickCredential = (credentialRef: string) => {
    const next = credentials?.find((option) => option.placeholderId === credentialRef);
    const nextField = bestField(next?.fields || []);
    const keep = sent.field && next?.fields.some((entry) => entry.key === sent.field) ? sent.field : nextField;
    onChange({
      ...(auth as NonNullable<Auth>),
      credentialRef,
      headers: sent.mode === 'custom' ? auth?.headers || {} : buildHeaders(sent.mode, keep, headerName),
    });
  };

  const addressesField = (
    <Select
      aria-label="Addresses it may be sent to"
      mode="tags"
      style={{ width: '100%' }}
      placeholder="https://api.example.com"
      tokenSeparators={[',', ' ']}
      value={origins}
      onChange={(allowedOrigins: string[]) => auth && onChange({ ...auth, allowedOrigins })}
    />
  );
  const showAddresses = !origin || moreAddresses || origins.length > 1 || (origins.length === 1 && origins[0] !== origin);

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Radio.Group value={mode} onChange={(event) => choose(event.target.value)} style={{ width: '100%' }}>
        <Space direction="vertical" size={10}>
          <Radio value="none">
            <span style={{ fontWeight: 500 }}>None</span>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              The call goes out without signing in.
            </Text>
          </Radio>
          <Radio value="integration">
            <span style={{ fontWeight: 500 }}>Same as this integration</span>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              Use the sign-in set on the Authentication tab.
            </Text>
          </Radio>
          <Radio value="credential">
            <span style={{ fontWeight: 500 }}>A saved credential</span>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              Pick one of your organization&apos;s credentials.
            </Text>
          </Radio>
        </Space>
      </Radio.Group>

      {mode === 'credential' && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Block label="Credential" error={errors.credentialRef}>
            {credentials === undefined ? (
              <Input aria-label="Credential ID" value={auth?.credentialRef} placeholder="cred_..." onChange={(e) => onChange({ ...(auth as NonNullable<Auth>), credentialRef: e.target.value })} />
            ) : credentials.length === 0 ? (
              <Text type="secondary">You have no saved credentials yet. Add one under Credentials, then pick it here.</Text>
            ) : (
              <Select
                aria-label="Credential"
                style={{ width: '100%' }}
                placeholder="Choose a credential"
                value={auth?.credentialRef || undefined}
                options={credentials.map((option) => ({ value: option.placeholderId, label: `${option.name} · ${option.provider}` }))}
                onChange={pickCredential}
              />
            )}
          </Block>

          {chosen && (
            <>
              <Block label="How to send it" error={errors.headers}>
                <Select
                  aria-label="How to send it"
                  style={{ width: '100%' }}
                  value={sent.mode}
                  options={[
                    { value: 'bearer', label: 'Bearer token' },
                    { value: 'apiKey', label: 'API key in a header' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                  onChange={(next: Mode) => send(next)}
                />
              </Block>
              {sent.mode !== 'custom' && fields.length > 1 && (
                <Block label="Value to send">
                  <Select
                    aria-label="Value to send"
                    style={{ width: '100%' }}
                    value={field}
                    options={fields.map((entry) => ({ value: entry.key, label: entry.label || entry.key }))}
                    onChange={(next: string) => send(sent.mode, next)}
                  />
                </Block>
              )}
              {sent.mode === 'apiKey' && (
                <Block label="Header name">
                  <Input aria-label="Header name" value={headerName} onChange={(e) => send('apiKey', field, e.target.value)} />
                </Block>
              )}
              {sent.mode === 'custom' && (
                <Block label="Headers" hint="Use {{ credential.<value> }} where the secret goes.">
                  <KeyValueEditor label="Credential header" value={auth?.headers} onChange={(headers) => auth && onChange({ ...auth, headers })} />
                </Block>
              )}
            </>
          )}
        </Space>
      )}

      {mode !== 'none' && (
        <Block
          label="Sent only to"
          error={errors.allowedOrigins}
          hint="Calls to any other address go out without it."
        >
          {origin && !showAddresses ? (
            <Space size={8} wrap>
              <Text>
                Only sent to <Text code>{origin}</Text>, the address this step calls.
              </Text>
              <a role="button" onClick={() => setMoreAddresses(true)}>
                Add more
              </a>
            </Space>
          ) : (
            addressesField
          )}
        </Block>
      )}
    </Space>
  );
};
