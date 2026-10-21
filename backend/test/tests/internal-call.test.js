'use strict';

const { INTERNAL_CALL_HEADER, internalCallToken, isInternalCall } = require('../../src/utils/internal-call');

describe('internal calls', () => {
  it('uses a long random token that only this process knows', () => {
    expect(internalCallToken()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('recognises the token in either header casing, and nothing else', () => {
    expect(isInternalCall({ [INTERNAL_CALL_HEADER]: internalCallToken() })).toBe(true);
    expect(isInternalCall({ [INTERNAL_CALL_HEADER.toUpperCase()]: internalCallToken() })).toBe(true);
    expect(isInternalCall({ [INTERNAL_CALL_HEADER]: 'nope' })).toBe(false);
    expect(isInternalCall({ [INTERNAL_CALL_HEADER]: '' })).toBe(false);
    expect(isInternalCall({})).toBe(false);
  });
});
