'use strict';

const axios = require('axios');
const { isResolved } = require('./format');

module.exports = {
  type: 'slack',
  name: 'Slack',
  description: 'Post alerts to a Slack channel through an incoming webhook.',
  fields: [
    {
      key: 'webhookUrl',
      label: 'Slack webhook URL',
      type: 'secret',
      required: true,
      placeholder: 'https://hooks.slack.com/services/…',
      help: 'In Slack: create an app, enable Incoming Webhooks, add one to the alert channel and copy its URL.',
      pattern: '^https://hooks\\.slack\\.com/services/',
      patternMessage: 'Slack webhook URLs start with https://hooks.slack.com/services/',
    },
  ],

  async send(alert, config) {
    const resolved = isResolved(alert);
    const details = [
      alert.integration?.name && `*Integration:* ${alert.integration.name}`,
      (alert.orgName || alert.orgId) && `*Organization:* ${alert.orgName || alert.orgId}`,
      alert.message && !resolved && `*Error:* \`${String(alert.message).slice(0, 500)}\``,
    ].filter(Boolean);
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: `*${alert.title}*` } },
      ...(details.length ? [{ type: 'section', text: { type: 'mrkdwn', text: details.join('\n') } }] : []),
      ...(alert.link
        ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open delivery logs' }, url: alert.link }] }]
        : []),
    ];
    await axios({
      method: 'POST',
      url: config.webhookUrl,
      data: { text: alert.title, attachments: [{ color: resolved ? '#12b76a' : '#d92d20', blocks }] },
      timeout: 10000,
    });
  },
};
