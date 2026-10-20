'use strict';

/**
 * Puppeteer 25 is ESM-only; on production's Node 14 `require('puppeteer')`
 * throws ERR_REQUIRE_ESM rather than MODULE_NOT_FOUND. The guard only knew the
 * latter, so capture threw a raw loader error instead of the clear
 * PUPPETEER_NOT_INSTALLED the routes already handle.
 */

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock(
  'puppeteer',
  () => {
    const error = new Error('Must use import to load ES Module: puppeteer/lib/cjs/index.js');
    error.code = 'ERR_REQUIRE_ESM';
    throw error;
  },
  { virtual: true }
);

const dashboardCaptureService = require('../../src/services/dashboard-capture');

describe('dashboard capture when Puppeteer cannot load', () => {
  it('reports capture as unavailable instead of throwing the loader error', async () => {
    await expect(dashboardCaptureService.initializeBrowser()).rejects.toMatchObject({
      code: 'PUPPETEER_NOT_INSTALLED',
    });
  });
});
