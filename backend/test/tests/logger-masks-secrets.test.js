'use strict';

/**
 * Credentials in logged URLs and request headers never reach the log files.
 */

describe('logger', () => {
  it('masks URL and header credentials in log metadata', () => {
    jest.isolateModules(() => {
      const winston = require('winston');
      const written = [];
      const spy = jest.spyOn(winston.Logger.prototype, 'log').mockImplementation(function (entry) {
        written.push(entry);
        return this;
      });
      const { log } = require('../../src/logger');
      log('info', 'Delivering', {
        targetUrl: 'https://api.example.com/hook?api_key=url-secret',
        headers: { Authorization: 'Bearer header-secret', Accept: 'json' },
      });
      spy.mockRestore();
      const text = JSON.stringify(written);
      expect(text).not.toMatch(/url-secret|header-secret/);
      expect(text).toContain('api.example.com/hook');
    });
  });
});
