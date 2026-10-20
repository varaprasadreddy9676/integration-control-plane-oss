'use strict';

/**
 * Host memory was computed from os.freemem(), which leaves out reclaimable
 * page cache: production showed "99% used" with 12 GB actually available.
 */

const { parseMeminfo } = require('../../src/utils/host-memory');

const SAMPLE = [
  'MemTotal:       64469308 kB',
  'MemFree:          440320 kB',
  'MemAvailable:   13178624 kB',
  'SwapTotal:       4194300 kB',
  'SwapFree:           6764 kB',
].join('\n');

describe('parseMeminfo', () => {
  it('reads available memory and swap in MB', () => {
    expect(parseMeminfo(SAMPLE)).toEqual({ availableMB: 12870, swapTotalMB: 4096, swapUsedMB: 4089 });
  });

  it('returns null when MemAvailable is missing (non-Linux or old kernels)', () => {
    expect(parseMeminfo('MemTotal: 1000 kB')).toBeNull();
  });
});
