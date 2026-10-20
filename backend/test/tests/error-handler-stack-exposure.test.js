'use strict';

/**
 * Production does not set NODE_ENV, and the handler used to return stack traces
 * whenever NODE_ENV !== 'production' — so every production API error sent the
 * caller server file paths and the middleware chain. Stack traces are now
 * opt-in: only NODE_ENV=development or test.
 */

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const errorHandler = require('../../src/middleware/error-handler');

const respond = (nodeEnv, err) => {
  const previous = process.env.NODE_ENV;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  try {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const req = { path: '/api/v1/ops/org-diagnosis', method: 'GET', query: {}, headers: {}, ip: '127.0.0.1' };
    errorHandler(err, req, res, () => undefined);
    return res.json.mock.calls[0][0];
  } finally {
    process.env.NODE_ENV = previous;
  }
};

const forbidden = () => Object.assign(new Error('You do not have permission'), { name: 'ForbiddenError' });

describe('error handler stack exposure', () => {
  it.each([undefined, '', 'production', 'staging'])('hides the stack and path when NODE_ENV=%j', (env) => {
    const body = respond(env, forbidden());
    expect(body.stack).toBeUndefined();
    expect(body.path).toBeUndefined();
    expect(body.error).toBe('You do not have permission');
  });

  it.each(['development', 'test'])('shows the stack when NODE_ENV=%s', (env) => {
    expect(respond(env, forbidden()).stack).toContain('Error');
  });

  it('still returns validation details in production', () => {
    const err = Object.assign(new Error('Validation failed'), { name: 'ValidationError', details: [{ field: 'url' }] });
    expect(respond(undefined, err).details).toEqual([{ field: 'url' }]);
  });
});
