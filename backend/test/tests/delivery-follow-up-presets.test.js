'use strict';

/**
 * A preset recognizes a provider by its URL and supplies the follow-up script
 * for it, so every integration for that provider follows up by default and
 * any single one can switch it off.
 */

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const presets = require('../../src/services/delivery-follow-up-presets');
const { validateDeliveryFollowUp } = require('../../src/services/delivery-follow-up-config');

const qikchat = { targetUrl: 'https://api.qikchat.in/v1/messages' };

describe('preset lookup', () => {
  it('recognizes a Qikchat integration by its target host', () => {
    expect(presets.findPreset(qikchat).id).toBe('qikchat');
    expect(presets.findPreset({ targetUrl: 'https://API.QIKCHAT.IN/v1/messages?x=1' }).id).toBe('qikchat');
  });

  it('does not match other providers, look-alikes or nothing', () => {
    expect(presets.findPreset({ targetUrl: 'https://example.com/v1/messages' })).toBeNull();
    expect(presets.findPreset({ targetUrl: 'https://api.qikchat.in.evil.example/v1/messages' })).toBeNull();
    expect(presets.findPreset({ targetUrl: 'https://notqikchat.in/v1/messages' })).toBeNull();
    expect(presets.findPreset({ targetUrl: 'not a url' })).toBeNull();
    expect(presets.findPreset({})).toBeNull();
    expect(presets.findPreset(null)).toBeNull();
  });
});

describe('default follow-up for a new integration', () => {
  it('fills in the preset when none was given', () => {
    for (const none of [undefined, null]) {
      const config = presets.defaultFollowUpFor({ ...qikchat, deliveryFollowUp: none });
      expect(config).toMatchObject({ enabled: true, checkAfterSeconds: [30, 300, 3600, 86400] });
      expect(validateDeliveryFollowUp(config)).toBeNull();
    }
  });

  it('never overrides what the integration says, including switched off', () => {
    const off = { enabled: false, script: '' };
    expect(presets.defaultFollowUpFor({ ...qikchat, deliveryFollowUp: off })).toBe(off);
    const own = { enabled: true, script: 'return null;', checkAfterSeconds: [60] };
    expect(presets.defaultFollowUpFor({ ...qikchat, deliveryFollowUp: own })).toBe(own);
  });

  it('adds nothing for other providers', () => {
    expect(presets.defaultFollowUpFor({ targetUrl: 'https://example.com', deliveryFollowUp: undefined })).toBeUndefined();
    expect(presets.defaultFollowUpFor({ targetUrl: 'https://example.com', deliveryFollowUp: null })).toBeNull();
  });

  it('hands out a copy, so one integration cannot change the preset for another', () => {
    const a = presets.defaultFollowUpFor({ ...qikchat });
    a.checkAfterSeconds.push(1);
    a.script = 'x';
    const b = presets.defaultFollowUpFor({ ...qikchat });
    expect(b.checkAfterSeconds).toEqual([30, 300, 3600, 86400]);
    expect(b.script).not.toBe('x');
  });
});

describe('the Qikchat script, run for real', () => {
  const { testFollowUpScript } = (() => {
    jest.resetModules();
    jest.doMock('axios', () => ({ get: mockGet }));
    jest.doMock('../../src/data/delivery-follow-ups', () => ({}));
    jest.doMock('../../src/processor/auth-helper', () => ({
      buildAuthHeaders: jest.fn(async () => ({ 'QIKCHAT-API-KEY': 'key', 'Content-Type': 'application/json' })),
    }));
    return require('../../src/services/delivery-follow-up');
  })();

  const sendResponse = { status: true, message: 'ok', data: [{ id: 'abc123', channel: 'whatsapp', status: 'processing' }] };
  const run = (response = sendResponse) =>
    testFollowUpScript({
      integration: { id: 'i', orgId: 1, ...qikchat },
      script: presets.findPreset(qikchat).config.script,
      delivery: { statusCode: 200, response },
    });
  const dlr = (message, status = 200) =>
    mockGet.mockResolvedValueOnce({ status, data: { status: true, message: { event: 'whatsapp:message:dlr', payload: { message } } }, headers: {} });

  beforeEach(() => mockGet.mockReset());

  it('asks Qikchat about the message id from the send response, with the integration headers', async () => {
    dlr({ status: 'read', sentAt: '2026-10-22T10:00:00Z', deliveredAt: '2026-10-22T10:00:20Z', readAt: '2026-10-22T10:00:40Z' });
    const out = await run();
    expect(mockGet).toHaveBeenCalledWith(
      'https://api.qikchat.in/v1/messages?msgid=abc123',
      expect.objectContaining({ headers: { 'QIKCHAT-API-KEY': 'key', 'Content-Type': 'application/json' } })
    );
    expect(out.outcome).toBe('RESULT');
    expect(out.result).toMatchObject({ status: 'READ', readAt: new Date('2026-10-22T10:00:40Z') });
  });

  it.each([
    ['processing', 'SENT'],
    ['queued', 'SENT'],
    ['sent', 'SENT'],
    ['delivered', 'DELIVERED'],
    ['read', 'READ'],
    ['failed', 'FAILED'],
    ['undelivered', 'FAILED'],
  ])('maps Qikchat "%s" to %s', async (qikchatStatus, expected) => {
    dlr({ status: qikchatStatus });
    expect((await run()).result.status).toBe(expected);
  });

  it('keeps the failure reason when Qikchat gives one, and something to go on when it does not', async () => {
    dlr({ status: 'failed', errorCode: 131026, errorMessage: 'Message undeliverable' });
    expect((await run()).result).toMatchObject({ status: 'FAILED', errorCode: '131026', errorMessage: 'Message undeliverable' });
    dlr({ status: 'failed', sentAt: '2026-10-22T10:00:00Z' });
    const bare = (await run()).result;
    expect(bare.status).toBe('FAILED');
    expect(bare.errorMessage).toContain('failed'); // the raw status object, until Qikchat's error fields are known
  });

  it('shows a status it does not know as an error, so the vocabulary can be learned', async () => {
    dlr({ status: 'frobnicated' });
    const out = await run();
    expect(out.outcome).toBe('ERROR');
    expect(out.error).toMatch(/frobnicated/);
  });

  it('treats an HTTP error from Qikchat as a failed check to retry, not as a status', async () => {
    mockGet.mockResolvedValueOnce({ status: 400, data: { error: 'Invalid request' }, headers: {} });
    const out = await run();
    expect(out.outcome).toBe('ERROR');
    expect(out.error).toMatch(/400/);
  });

  it('stops tracking a send that returned no message id', async () => {
    const out = await run({ status: false, message: 'rejected' });
    expect(out).toMatchObject({ outcome: 'SKIPPED' });
    expect(mockGet).not.toHaveBeenCalled();
  });
});

const mockGet = jest.fn();
