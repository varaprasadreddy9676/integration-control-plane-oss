'use strict';

/** Shared wording for alert plugins, so every channel says the same thing. */

const { RESOLVED_ALERT_TYPES } = require('../alert-events');

const isResolved = (alert) => RESOLVED_ALERT_TYPES.has(alert.type) || alert.severity === 'resolved';

/** One-line plain-text summary, for channels without rich formatting (WhatsApp, SMS). */
function summaryText(alert) {
  const lines = [alert.title];
  if (alert.message && !isResolved(alert)) lines.push(`Error: ${alert.message}`);
  if (alert.orgName || alert.orgId) lines.push(`Organization: ${alert.orgName || alert.orgId}`);
  if (alert.link) lines.push(alert.link);
  return lines.join('\n');
}

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = { isResolved, summaryText, escapeHtml };
