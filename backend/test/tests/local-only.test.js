'use strict';

const localOnly = require('../../src/middleware/local-only');

function run(remoteAddress, headers = {}) {
  const req = { socket: { remoteAddress }, headers, path: '/event-coalesce' };
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  const next = jest.fn();
  localOnly(req, res, next);
  return { res, next };
}

describe('localOnly', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('lets a direct call from %s through', (addr) => {
    expect(run(addr).next).toHaveBeenCalled();
  });

  it('refuses a call from another machine', () => {
    const { res, next } = run('203.0.113.9');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it.each([{ 'x-forwarded-for': '203.0.113.9' }, { forwarded: 'for=203.0.113.9' }, { 'x-real-ip': '203.0.113.9' }])(
    'refuses a loopback call relayed by a proxy (%p)',
    (headers) => {
      const { res, next } = run('127.0.0.1', headers);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    }
  );
});
