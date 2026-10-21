'use strict';

function loadConfigWith(logLevel) {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  const previous = process.env.LOG_LEVEL;
  if (logLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = logLevel;
  try {
    jest.isolateModules(() => require('../../src/config'));
    return [...warn.mock.calls, ...info.mock.calls].map((args) => String(args[0]));
  } finally {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
    warn.mockRestore();
    info.mockRestore();
  }
}

describe('config startup notices', () => {
  it('stays quiet when LOG_LEVEL is warn (CLI scripts such as create-user)', () => {
    const printed = loadConfigWith('warn');
    expect(printed.some((line) => line.includes('[config] Effective FRONTEND_URL'))).toBe(false);
    expect(printed.some((line) => line.includes('config.json not found'))).toBe(false);
  });

  it('still prints the effective frontend URL at the default level', () => {
    const printed = loadConfigWith(undefined);
    expect(printed.some((line) => line.includes('[config] Effective FRONTEND_URL'))).toBe(true);
  });
});
