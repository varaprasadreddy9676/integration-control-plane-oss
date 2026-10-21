'use strict';

/**
 * One way to raise an alert: record it in the organization's Alert Center and
 * send it to the organization's alert channels. Health watchers call this, so a
 * new kind of alert reaches Slack, email, webhooks… without extra wiring.
 */

const { log } = require('../../logger');
const { toChannelAlert } = require('./alert-dispatcher');

/** Never throws: a failed Alert Center write or channel send is only logged. */
function createAlertRaiser({ recordAlert, dispatch, getOrgName, frontendUrl }) {
  return async function raiseAlert(orgId, alert) {
    try {
      await recordAlert(orgId, { channel: 'SYSTEM', recipients: [], ...alert });
    } catch (error) {
      log('error', 'Could not record alert in the Alert Center', { orgId, type: alert.type, error: error.message });
    }
    try {
      const orgName = await getOrgName(orgId).catch(() => undefined);
      await dispatch(orgId, toChannelAlert(orgId, alert, { orgName, frontendUrl }));
    } catch (error) {
      log('error', 'Could not send alert to channels', { orgId, type: alert.type, error: error.message });
    }
  };
}

let defaultRaiser = null;

/** The app-wide raiser, wired to the real Alert Center and channels on first use. */
function raiseAlert(orgId, alert) {
  if (!defaultRaiser) {
    const data = require('../../data');
    const config = require('../../config');
    const { dispatchAlert } = require('./alert-dispatcher');
    defaultRaiser = createAlertRaiser({
      recordAlert: (id, entry) => data.recordAlertCenterLog(id, entry),
      dispatch: dispatchAlert,
      getOrgName: async (id) => {
        const tenant = await data.getTenant(id);
        return tenant?.name || tenant?.tenantName;
      },
      frontendUrl: config.frontendUrl,
    });
  }
  return defaultRaiser(orgId, alert);
}

module.exports = { createAlertRaiser, raiseAlert };
