'use strict';

/**
 * Sends the gateway's own emails (failure reports, integration alerts, daily
 * reports) through an existing email integration's SMTP account, set with
 * MAIL_VIA_INTEGRATION_ID / MAIL_VIA_INTEGRATION_ORG_ID. The integration's
 * stored secrets are decrypted on read, as for its own deliveries.
 */

const config = require('../../config');
const mongodb = require('../../mongodb');
const adapterRegistry = require('../communication/adapter-registry');
const { log } = require('../../logger');

function isIntegrationMailConfigured() {
  return Boolean(config.mail?.viaIntegrationId && config.mail?.viaIntegrationOrgId);
}

async function loadEmailAction() {
  const { viaIntegrationId, viaIntegrationOrgId } = config.mail;
  const db = await mongodb.getDbSafe();
  const integration = await db
    .collection('integration_configs')
    .findOne({ _id: mongodb.toObjectId(viaIntegrationId), orgId: Number(viaIntegrationOrgId) });
  const action = (integration?.actions || []).find(
    (a) => a?.kind === 'COMMUNICATION' && a.communicationConfig?.channel === 'EMAIL'
  );
  if (!action) {
    throw new Error(`Mail integration ${viaIntegrationId} (org ${viaIntegrationOrgId}) has no email action`);
  }
  return action.communicationConfig;
}

/**
 * @param {{ to: string|string[], subject: string, html: string, attachments?: Array }} message
 */
async function deliverEmail({ to, subject, html, attachments }) {
  const { channel, provider, ...providerConfig } = await loadEmailAction();
  // Same lookup as the delivery engine: SMTP → providerConfig.smtp, else the whole block.
  const providerKey = String(provider || '').split('_')[0].toLowerCase();
  const adapterConfig = providerConfig[providerKey] || providerConfig;
  const result = await adapterRegistry.send(channel, provider, { to, subject, html, attachments }, adapterConfig);
  log('info', 'Gateway email sent via integration', { to, subject, messageId: result?.messageId });
  return result;
}

module.exports = { isIntegrationMailConfigured, deliverEmail };
