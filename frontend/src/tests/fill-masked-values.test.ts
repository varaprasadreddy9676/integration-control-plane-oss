import { describe, expect, it } from 'vitest';
import { SECRET_MASK, fillMaskedValues } from '../utils/credentials';

// Super admins reveal stored credentials into an open form: only the fields
// still showing the mask may change, so unsaved edits are never overwritten.
describe('fillMaskedValues', () => {
  it('replaces masked leaves with the revealed values', () => {
    const current = { outgoingAuthConfig: { username: 'lab', password: SECRET_MASK } };
    const revealed = { outgoingAuthConfig: { username: 'lab', password: 'real' } };
    expect(fillMaskedValues(current, revealed)).toEqual({ outgoingAuthConfig: { username: 'lab', password: 'real' } });
  });

  it('keeps anything the user already changed', () => {
    const current = { outgoingAuthConfig: { username: 'edited', password: 'typed-new' } };
    const revealed = { outgoingAuthConfig: { username: 'lab', password: 'real' } };
    expect(fillMaskedValues(current, revealed)).toEqual(current);
  });

  it('fills masks inside a JSON-string field (inbound custom headers)', () => {
    const current = { customHeaders: JSON.stringify({ Authorization: SECRET_MASK, 'x-partner-id': '{{partnerId}}' }, null, 2) };
    const revealed = { customHeaders: { Authorization: 'Bearer abc', 'x-partner-id': '{{partnerId}}' } };
    const filled = fillMaskedValues(current, revealed);
    expect(JSON.parse(filled.customHeaders)).toEqual({ Authorization: 'Bearer abc', 'x-partner-id': '{{partnerId}}' });
  });

  it('fills key/value header rows from a revealed header object (outbound CUSTOM_HEADERS)', () => {
    const current = { outgoingAuthConfig: { headers: [{ key: 'X-Api-Key', value: SECRET_MASK }, { key: 'X-Other', value: 'kept' }] } };
    const revealed = { outgoingAuthConfig: { headers: { 'X-Api-Key': 'k-1', 'X-Other': 'k-2' } } };
    expect(fillMaskedValues(current, revealed).outgoingAuthConfig.headers).toEqual([
      { key: 'X-Api-Key', value: 'k-1' },
      { key: 'X-Other', value: 'kept' },
    ]);
  });

  it('fills masked items in arrays such as HMAC secrets and multi-action configs', () => {
    const current = {
      inboundAuthConfig: { secrets: [SECRET_MASK, SECRET_MASK] },
      actions: [{ communicationConfig: { smtp: { password: SECRET_MASK } } }],
    };
    const revealed = {
      inboundAuthConfig: { secrets: ['a', 'b'] },
      actions: [{ communicationConfig: { smtp: { password: 'pw' } } }],
    };
    expect(fillMaskedValues(current, revealed)).toEqual(revealed);
  });

  it('leaves a mask alone when nothing was revealed for it', () => {
    const current = { outgoingAuthConfig: { password: SECRET_MASK } };
    expect(fillMaskedValues(current, {})).toEqual(current);
  });
});
