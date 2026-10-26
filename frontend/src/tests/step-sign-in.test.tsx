import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StepSignIn } from '../features/stages/components/delivery-tab/StepSignIn';
import type { CredentialOption, StageConfig } from '../services/stages-api';

type Auth = StageConfig['auth'];

const credentials: CredentialOption[] = [
  { placeholderId: 'cred_1', name: 'Qikchat', provider: 'Qikchat', environment: 'production', status: 'READY', fields: [{ key: 'apiKey', label: 'API key' }] },
  { placeholderId: 'cred_2', name: 'Portal', provider: 'Acme', environment: 'production', status: 'READY', fields: [{ key: 'username' }, { key: 'token' }] },
];

/** The editor owns the auth: this keeps it between renders and reports each change. */
const Harness = ({ initial, url = 'https://api.example.com/v1/messages', onAuth, list = credentials }: { initial?: Auth; url?: string; onAuth?: (auth: Auth) => void; list?: CredentialOption[] | 'unavailable' }) => {
  const [auth, setAuth] = useState<Auth>(initial);
  return (
    <StepSignIn
      auth={auth}
      credentials={list === 'unavailable' ? undefined : list}
      url={url}
      onChange={(next) => {
        setAuth(next);
        onAuth?.(next);
      }}
    />
  );
};

const choose = async (name: RegExp) => fireEvent.click(await screen.findByRole('radio', { name }));
const pick = async (label: string, option: RegExp | string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content, .ant-select-item-option-content *' }));
};

describe('a step\'s sign-in', () => {
  it('offers three choices in plain words, and starts with none', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: /^None/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Same as this integration/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /A saved credential/ })).toBeInTheDocument();
    expect(screen.queryByText(/credential\./)).not.toBeInTheDocument();
  });

  it('reuses the integration\'s own sign-in, sent only to the address being called', async () => {
    const onAuth = vi.fn();
    render(<Harness onAuth={onAuth} />);
    await choose(/Same as this integration/);
    expect(onAuth).toHaveBeenLastCalledWith({ source: 'integration', allowedOrigins: ['https://api.example.com'] });
    expect(screen.getByText(/Only sent to/)).toHaveTextContent('https://api.example.com');
  });

  it('sends a saved credential as a bearer token by default, using the value it has', async () => {
    const onAuth = vi.fn();
    render(<Harness onAuth={onAuth} />);
    await choose(/A saved credential/);
    await pick('Credential', /Qikchat/);
    expect(onAuth).toHaveBeenLastCalledWith({
      credentialRef: 'cred_1',
      headers: { Authorization: 'Bearer {{ credential.apiKey }}' },
      allowedOrigins: ['https://api.example.com'],
    });
  });

  it('prefers a field called token, and lets the person pick which value to send when there are several', async () => {
    const onAuth = vi.fn();
    render(<Harness onAuth={onAuth} />);
    await choose(/A saved credential/);
    await pick('Credential', /Portal/);
    expect(onAuth).toHaveBeenLastCalledWith(expect.objectContaining({ headers: { Authorization: 'Bearer {{ credential.token }}' } }));
    await pick('Value to send', /username/);
    expect(onAuth).toHaveBeenLastCalledWith(expect.objectContaining({ headers: { Authorization: 'Bearer {{ credential.username }}' } }));
  });

  it('can send it as an API key header instead', async () => {
    const onAuth = vi.fn();
    render(<Harness onAuth={onAuth} />);
    await choose(/A saved credential/);
    await pick('Credential', /Qikchat/);
    await pick('How to send it', /API key in a header/);
    expect(onAuth).toHaveBeenLastCalledWith(expect.objectContaining({ headers: { 'X-API-Key': '{{ credential.apiKey }}' } }));
    fireEvent.change(screen.getByLabelText('Header name'), { target: { value: 'X-Auth' } });
    expect(onAuth).toHaveBeenLastCalledWith(expect.objectContaining({ headers: { 'X-Auth': '{{ credential.apiKey }}' } }));
  });

  it('shows a credential set up another way as custom headers, and keeps them', () => {
    const initial: Auth = { credentialRef: 'cred_1', headers: { Authorization: 'Token {{ credential.apiKey }}', 'X-Tenant': '{{ credential.apiKey }}' }, allowedOrigins: ['https://api.example.com'] };
    render(<Harness initial={initial} />);
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByLabelText('Credential header name 1')).toBeInTheDocument();
  });

  it('follows the address as it changes, until the person has chosen their own', async () => {
    const onAuth = vi.fn();
    const { rerender } = render(<StepSignIn auth={{ source: 'integration', allowedOrigins: ['https://api.example.com'] }} credentials={credentials} url="https://api.example.com/a" onChange={onAuth} />);
    rerender(<StepSignIn auth={{ source: 'integration', allowedOrigins: ['https://api.example.com'] }} credentials={credentials} url="https://other.example.org/a" onChange={onAuth} />);
    await waitFor(() => expect(onAuth).toHaveBeenLastCalledWith({ source: 'integration', allowedOrigins: ['https://other.example.org'] }));
    onAuth.mockClear();
    rerender(<StepSignIn auth={{ source: 'integration', allowedOrigins: ['https://mine.example.com'] }} credentials={credentials} url="https://third.example.net/a" onChange={onAuth} />);
    expect(onAuth).not.toHaveBeenCalled();
  });

  it('asks for the address when the step does not name one (a script)', async () => {
    const onAuth = vi.fn();
    render(<Harness url="" onAuth={onAuth} />);
    await choose(/Same as this integration/);
    expect(onAuth).toHaveBeenLastCalledWith({ source: 'integration', allowedOrigins: [] });
    expect(screen.getAllByLabelText('Addresses it may be sent to').length).toBeGreaterThan(0);
  });

  it('says so, and offers no list, when the organization has no credentials yet', async () => {
    render(<Harness list={[]} />);
    await choose(/A saved credential/);
    expect(await screen.findByText(/no saved credentials/i)).toBeInTheDocument();
  });

  it('keeps working when the credentials cannot be listed, by asking for the credential\'s ID', async () => {
    render(<Harness list="unavailable" />);
    await choose(/A saved credential/);
    expect(within(document.body).getByLabelText('Credential ID')).toBeInTheDocument();
  });
});
