'use strict';

const emailService = require('../../email-service');
const { isResolved, escapeHtml } = require('./format');

module.exports = {
  type: 'email',
  name: 'Email',
  description: 'Email alerts to a list of addresses, through the gateway’s configured mailer.',
  fields: [
    {
      key: 'recipients',
      label: 'Recipients',
      type: 'list',
      itemPattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      itemPatternMessage: 'is not an email address',
      required: true,
      placeholder: 'ops@example.com, oncall@example.com',
      help: 'Separate addresses with commas.',
    },
  ],

  async send(alert, config) {
    const resolved = isResolved(alert);
    const html = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #111827;">
        <h2 style="margin: 0 0 12px; color: ${resolved ? '#15803d' : '#b91c1c'};">${escapeHtml(alert.title)}</h2>
        ${alert.integration?.name ? `<div>Integration: ${escapeHtml(alert.integration.name)}</div>` : ''}
        <div>Organization: ${escapeHtml(alert.orgName || alert.orgId)}</div>
        ${alert.message && !resolved ? `<div style="margin-top: 8px;">Error: <code>${escapeHtml(alert.message)}</code></div>` : ''}
        ${alert.link ? `<div style="margin-top: 12px;"><a href="${escapeHtml(alert.link)}">Open delivery logs</a></div>` : ''}
      </div>`;
    const result = await emailService.sendEmail({ to: config.recipients, subject: alert.title, html });
    if (!result?.success) throw new Error(result?.reason || result?.error || 'Email was not sent');
  },
};
