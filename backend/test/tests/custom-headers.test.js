'use strict';

const { resolveCustomHeaders, resolveReplayCustomHeaders } = require('../../src/utils/custom-headers');

const CUSTOM = { 'x-partner-id': '{{partnerId}}', 'x-partner-name': '{{partnerName}}' };

describe('resolveCustomHeaders', () => {
  it('fills placeholders from the caller headers, case-insensitively', () => {
    expect(resolveCustomHeaders(CUSTOM, { PartnerId: 'IN1', partnername: 'Hospital' })).toEqual({
      'x-partner-id': 'IN1',
      'x-partner-name': 'Hospital',
    });
  });

  it('resolves a missing caller header to an empty string', () => {
    expect(resolveCustomHeaders(CUSTOM, {})).toEqual({ 'x-partner-id': '', 'x-partner-name': '' });
  });
});

describe('resolveReplayCustomHeaders', () => {
  it('prefers the caller headers when they exist', () => {
    expect(resolveReplayCustomHeaders(CUSTOM, { partnerid: 'NEW', partnername: 'N' }, { 'x-partner-id': 'OLD' })).toEqual({
      'x-partner-id': 'NEW',
      'x-partner-name': 'N',
    });
  });

  it('falls back to the headers originally sent upstream when the caller headers were not kept', () => {
    expect(
      resolveReplayCustomHeaders(CUSTOM, null, { 'X-Partner-Id': 'P-1001', 'x-partner-name': 'Northwind' })
    ).toEqual({ 'x-partner-id': 'P-1001', 'x-partner-name': 'Northwind' });
  });

  it('stays empty when neither source has the value', () => {
    expect(resolveReplayCustomHeaders(CUSTOM, null, null)).toEqual({ 'x-partner-id': '', 'x-partner-name': '' });
  });
});
