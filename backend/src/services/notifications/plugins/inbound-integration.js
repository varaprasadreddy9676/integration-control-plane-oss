'use strict';

const axios = require('axios');
const config = require('../../../config');
const mongodb = require('../../../mongodb');
const { INTERNAL_CALL_HEADER, internalCallToken } = require('../../../utils/internal-call');

/** The inbound integration in this organization, or null. */
async function findInbound(orgId, integrationId) {
  const _id = mongodb.toObjectId(integrationId);
  if (!_id) return null;
  const db = await mongodb.getDbSafe();
  return db.collection('integration_configs').findOne({ _id, orgId, direction: 'INBOUND' });
}

const NOT_FOUND = 'The chosen inbound integration was not found in this organization';

module.exports = {
  type: 'inbound-integration',
  name: 'Inbound integration',
  description:
    'Hand each alert to one of your inbound integrations, which can reshape it and call any API with its own auth, retries and logs.',
  fields: [
    {
      key: 'integrationId',
      label: 'Inbound integration',
      type: 'integration',
      direction: 'INBOUND',
      required: true,
      pattern: '^[a-f0-9]{24}$',
      patternMessage: 'Pick an inbound integration',
      help: 'It receives the alert as its request body (JSON). Use its request transform to shape it for the API it calls.',
    },
  ],

  /** Checked when the channel is saved: null if fine, otherwise the problem. */
  async verify(settings, { orgId }) {
    return (await findInbound(orgId, settings.integrationId)) ? null : NOT_FOUND;
  },

  async send(alert, settings) {
    const integration = await findInbound(alert.orgId, settings.integrationId);
    if (!integration) throw new Error(NOT_FOUND);
    if (integration.isActive === false) throw new Error(`${integration.name} is switched off`);

    const url = `http://127.0.0.1:${config.port}${config.api.basePrefix}/public/integrations/${encodeURIComponent(
      integration.type
    )}?orgId=${encodeURIComponent(alert.orgId)}`;
    try {
      await axios({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json', [INTERNAL_CALL_HEADER]: internalCallToken() },
        data: JSON.stringify({ version: 1, ...alert }),
        timeout: 15000,
        maxRedirects: 0,
      });
    } catch (error) {
      const answer = error.response?.data?.error || error.response?.data?.message;
      throw new Error(answer ? `${error.message}: ${answer}` : error.message);
    }
  },
};
