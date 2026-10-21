'use strict';

const crypto = require('crypto');

jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const { verifySignedRequest } = require('../../src/services/integration-signing');

const secret = 'whsec_test_5f2b9c';
const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
// Stripe signs "<timestamp>.<raw body>" with the endpoint secret (HMAC-SHA256, hex).
const stripeHeader = (t, payload = body, key = secret) =>
  `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${payload}`).digest('hex')}`;
const now = () => Math.floor(Date.now() / 1000);
const config = { scheme: 'STRIPE', secret };

describe('Stripe webhook signatures (HMAC scheme STRIPE)', () => {
  it('accepts a correctly signed event', () => {
    expect(verifySignedRequest(config, { 'stripe-signature': stripeHeader(now()) }, body)).toBe(true);
  });

  it('rejects a modified body', () => {
    expect(verifySignedRequest(config, { 'stripe-signature': stripeHeader(now()) }, `${body} `)).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    expect(verifySignedRequest(config, { 'stripe-signature': stripeHeader(now(), body, 'whsec_other') }, body)).toBe(false);
  });

  it('rejects an event older than the tolerance (replay)', () => {
    expect(verifySignedRequest(config, { 'stripe-signature': stripeHeader(now() - 600) }, body)).toBe(false);
  });

  it('accepts when any v1 signature matches (secret rolling)', () => {
    const t = now();
    const header = `t=${t},v1=${'0'.repeat(64)},${stripeHeader(t).split(',')[1]}`;
    expect(verifySignedRequest(config, { 'Stripe-Signature': header }, body)).toBe(true);
  });

  it('rejects a missing or malformed header', () => {
    expect(verifySignedRequest(config, {}, body)).toBe(false);
    expect(verifySignedRequest(config, { 'stripe-signature': 'v1=abc' }, body)).toBe(false);
  });
});
