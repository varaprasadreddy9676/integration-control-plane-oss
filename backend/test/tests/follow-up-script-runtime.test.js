'use strict';

/**
 * The follow-up script runs through the real transform-script sandbox, not a
 * mock: the delivery, the integration headers, async http and skip() must all
 * reach it, and what it returns must survive normalization.
 */

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/data/delivery-follow-ups', () => ({ enqueue: jest.fn(), saveCheck: jest.fn(), markLog: jest.fn() }));
jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn(async () => ({ 'QIKCHAT-API-KEY': 'k' })),
}));
const mockAxios = { get: jest.fn() };
jest.mock('axios', () => mockAxios);

const followUp = require('../../src/services/delivery-follow-up');

const SCRIPT = `
const id = delivery.response?.data?.[0]?.id;
if (!id) return skip('No message id in the response');
const res = await http.get('https://provider.example/v1/messages?msgid=' + id, { headers: context.headers });
const m = res.data.message.payload.message;
return { status: m.status, deliveredAt: m.deliveredAt, readAt: m.readAt, errorCode: m.errorCode };`;

const integration = { id: 'i1', orgId: 1, name: 'WA', outgoingAuthType: 'API_KEY' };

describe('follow-up script in the real sandbox', () => {
  beforeEach(() => mockAxios.get.mockReset());

  it('asks the provider with the integration headers and returns the normalized status', async () => {
    mockAxios.get.mockResolvedValue({
      status: 200,
      data: { message: { payload: { message: { status: 'read', deliveredAt: '2026-10-22T10:00:20Z', readAt: '2026-10-22T10:00:40Z' } } } },
      headers: {},
    });
    const out = await followUp.testFollowUpScript({
      integration,
      script: SCRIPT,
      delivery: { statusCode: 200, response: { data: [{ id: 'wamid.1' }] } },
    });
    expect(out.outcome).toBe('RESULT');
    expect(out.result).toMatchObject({ status: 'READ', readAt: new Date('2026-10-22T10:00:40Z') });
    expect(mockAxios.get).toHaveBeenCalledWith(
      'https://provider.example/v1/messages?msgid=wamid.1',
      expect.objectContaining({ headers: { 'QIKCHAT-API-KEY': 'k' } })
    );
    expect(out.httpCalls[0]).toMatchObject({ method: 'GET', statusCode: 200 });
  });

  it('skip() ends tracking with its reason', async () => {
    const out = await followUp.testFollowUpScript({ integration, script: SCRIPT, delivery: { statusCode: 200, response: {} } });
    expect(out).toMatchObject({ outcome: 'SKIPPED', reason: 'No message id in the response' });
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  it('shows a script error instead of throwing', async () => {
    mockAxios.get.mockRejectedValue(new Error('ECONNRESET'));
    const out = await followUp.testFollowUpScript({
      integration,
      script: SCRIPT,
      delivery: { statusCode: 200, response: { data: [{ id: 'x' }] } },
    });
    expect(out.outcome).toBe('ERROR');
    expect(out.error).toMatch(/ECONNRESET/);
  });
});
