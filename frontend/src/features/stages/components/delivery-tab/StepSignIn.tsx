import { useEffect, useRef, useState } from 'react';
import { Input, Radio, Select, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '../../../../components/common/LegacyTypography';
import type { CredentialOption, StageConfig } from '../../../../services/stages-api';
import { KeyValueEditor } from './SchemaForm';

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

const Block = ({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) => (
  <div>
    <Text as="div" display="block" weight="semibold" className="console-margin-bottom-1">
      {label}
    </Text>
    {children}
    {hint && !error && (
      <Text as="div" display="block" type="supporting" color="secondary">
        {hint}
      </Text>
    )}
    {error && (
      <Text as="div" display="block" color="danger" role="alert">
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
  const mode: 'none' | 'integration' | 'credential' = auth
    ? auth.source === 'integration'
      ? 'integration'
      : 'credential'
    : 'none';
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
    onChange({
      ...auth,
      headers: nextMode === 'custom' ? auth.headers || {} : buildHeaders(nextMode, nextField, nextName),
    });
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
      className="console-width-full"
      placeholder="https://api.example.com"
      tokenSeparators={[',', ' ']}
      value={origins}
      onChange={(allowedOrigins: string[]) => auth && onChange({ ...auth, allowedOrigins })}
    />
  );
  const showAddresses =
    !origin || moreAddresses || origins.length > 1 || (origins.length === 1 && origins[0] !== origin);

  return (
    <Space direction="vertical" size={14} className="console-width-full">
      <Radio.Group value={mode} onChange={(event) => choose(event.target.value)} className="console-width-full">
        <Space direction="vertical" size={10}>
          <Radio value="none">
            <span className="console-font-weight-medium">None</span>
            <Text as="div" display="block" type="supporting" color="secondary">
              The call goes out without signing in.
            </Text>
          </Radio>
          <Radio value="integration">
            <span className="console-font-weight-medium">Same as this integration</span>
            <Text as="div" display="block" type="supporting" color="secondary">
              Use the sign-in set on the Authentication tab.
            </Text>
          </Radio>
          <Radio value="credential">
            <span className="console-font-weight-medium">A saved credential</span>
            <Text as="div" display="block" type="supporting" color="secondary">
              Pick one of your organization&apos;s credentials.
            </Text>
          </Radio>
        </Space>
      </Radio.Group>

      {mode === 'credential' && (
        <Space direction="vertical" size={12} className="console-width-full">
          <Block label="Credential" error={errors.credentialRef}>
            {credentials === undefined ? (
              <Input
                aria-label="Credential ID"
                value={auth?.credentialRef}
                placeholder="cred_..."
                onChange={(e) => onChange({ ...(auth as NonNullable<Auth>), credentialRef: e.target.value })}
              />
            ) : credentials.length === 0 ? (
              <Text type="supporting" color="secondary">
                You have no saved credentials yet. Add one under Credentials, then pick it here.
              </Text>
            ) : (
              <Select
                aria-label="Credential"
                className="console-width-full"
                placeholder="Choose a credential"
                value={auth?.credentialRef || undefined}
                options={credentials.map((option) => ({
                  value: option.placeholderId,
                  label: `${option.name} · ${option.provider}`,
                }))}
                onChange={pickCredential}
              />
            )}
          </Block>

          {chosen && (
            <>
              <Block label="How to send it" error={errors.headers}>
                <Select
                  aria-label="How to send it"
                  className="console-width-full"
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
                    className="console-width-full"
                    value={field}
                    options={fields.map((entry) => ({ value: entry.key, label: entry.label || entry.key }))}
                    onChange={(next: string) => send(sent.mode, next)}
                  />
                </Block>
              )}
              {sent.mode === 'apiKey' && (
                <Block label="Header name">
                  <Input
                    aria-label="Header name"
                    value={headerName}
                    onChange={(e) => send('apiKey', field, e.target.value)}
                  />
                </Block>
              )}
              {sent.mode === 'custom' && (
                <Block label="Headers" hint="Use {{ credential.<value> }} where the secret goes.">
                  <KeyValueEditor
                    label="Credential header"
                    value={auth?.headers}
                    onChange={(headers) => auth && onChange({ ...auth, headers })}
                  />
                </Block>
              )}
            </>
          )}
        </Space>
      )}

      {mode !== 'none' && (
        <Block label="Sent only to" error={errors.allowedOrigins} hint="Calls to any other address go out without it.">
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
