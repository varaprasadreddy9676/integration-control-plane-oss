'use strict';

/**
 * Production has no global MySQL connection (events come through per-org event
 * sources), yet /health reported "disconnected — delivery worker disabled" and
 * downgraded the whole gateway to "warning". Not configured is not a fault.
 */

const { describeMysqlHealth } = require('../../src/utils/mysql-health');

describe('describeMysqlHealth', () => {
  it('reports a deployment without global MySQL as not configured, not degraded', () => {
    expect(describeMysqlHealth({ configured: false, available: false })).toEqual({
      report: { configured: false, available: false, status: 'not_configured', note: null },
      degradesHealth: false,
    });
  });

  it('flags a configured MySQL that is down', () => {
    const { report, degradesHealth } = describeMysqlHealth({ configured: true, available: false });
    expect(report.status).toBe('disconnected');
    expect(report.note).toMatch(/MySQL/);
    expect(degradesHealth).toBe(true);
  });

  it('reports a connected MySQL', () => {
    expect(describeMysqlHealth({ configured: true, available: true }).report.status).toBe('connected');
  });
});
