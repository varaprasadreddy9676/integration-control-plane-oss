'use strict';

const adapterRegistry = require('../../communication/adapter-registry');
const { summaryText } = require('./format');

module.exports = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send alerts over WhatsApp with the Meta Cloud API.',
  fields: [
    { key: 'phoneNumberId', label: 'Phone number ID', type: 'text', required: true, help: 'From Meta Business Manager → WhatsApp → API setup.' },
    { key: 'accessToken', label: 'Access token', type: 'secret', required: true, help: 'A permanent system user token.' },
    {
      key: 'recipients',
      label: 'Recipients',
      type: 'list',
      itemPattern: '^\\+[1-9]\\d{6,14}$',
      itemPatternMessage: 'is not a phone number in +<country code><number> format',
      required: true,
      placeholder: '+15550001111, +15550002222',
    },
    {
      key: 'templateName',
      label: 'Message template',
      type: 'text',
      required: false,
      help: 'WhatsApp only delivers free-form text inside a 24-hour conversation window. For alerts, create an approved template with one body variable and enter its name here.',
    },
    { key: 'templateLanguage', label: 'Template language', type: 'text', required: false, placeholder: 'en_US' },
  ],

  async send(alert, config) {
    const text = summaryText(alert);
    const credentials = { phoneNumberId: config.phoneNumberId, accessToken: config.accessToken };
    for (const to of config.recipients) {
      const payload = config.templateName
        ? {
            to,
            type: 'template',
            templateName: config.templateName,
            templateLanguage: config.templateLanguage || 'en_US',
            templateComponents: [{ type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }],
          }
        : { to, type: 'text', text };
      await adapterRegistry.send('WHATSAPP', 'META', payload, credentials);
    }
  },
};
