'use strict';

/**
 * The global MySQL pool is optional: events can arrive through per-org event
 * sources instead. Only a configured pool that is down is worth a warning.
 */
function describeMysqlHealth({ configured, available }) {
  if (!configured) {
    return {
      report: { configured: false, available: false, status: 'not_configured', note: null },
      degradesHealth: false,
    };
  }
  return {
    report: {
      configured: true,
      available,
      status: available ? 'connected' : 'disconnected',
      note: available ? null : 'Global MySQL pool is unreachable; MySQL polling that uses it is paused until it reconnects',
    },
    degradesHealth: !available,
  };
}

module.exports = { describeMysqlHealth };
