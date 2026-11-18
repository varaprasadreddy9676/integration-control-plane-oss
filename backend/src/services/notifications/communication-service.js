'use strict';

/**
 * The notification service the gateway sends its own emails through (daily
 * reports, failure reports): one URL, one way to post to it.
 */

const config = require('../../config');
const { httpPost } = require('../../utils/http-post');

const COMMUNICATION_SERVICE_URL =
  config.communicationServiceUrl || 'https://notification.example.com/notification-service/api/sendNotification';

/** Resolves to { status, body } for any status; rejects on a network error or timeout. */
async function sendToCommunicationService(payload, timeoutMs = 10000) {
  const { status, body } = await httpPost({
    url: COMMUNICATION_SERVICE_URL,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs,
  });
  return { status, body };
}

module.exports = { COMMUNICATION_SERVICE_URL, sendToCommunicationService };
