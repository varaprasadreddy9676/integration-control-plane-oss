'use strict';

/**
 * Alerts for stages that keep failing: a job that used up its retries (dead
 * letter) raises an alert through the org's alert channels (Alert Center, Slack,
 * email lists...), at most once per stage per interval so a broken stage on a
 * busy integration does not flood anyone.
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

function createDeadLetterAlerter({ raise, log = () => {}, now = () => Date.now(), minIntervalMs = DEFAULT_INTERVAL_MS }) {
  const lastAlerted = new Map();

  return function onDeadLetter({ job, stage, integration, record }) {
    const key = `${job.orgId}:${job.integrationId}:${job.stageId}`;
    const previous = lastAlerted.get(key);
    if (previous !== undefined && now() - previous < minIntervalMs) return;
    lastAlerted.set(key, now());

    const name = (integration && integration.name) || job.integrationId;
    Promise.resolve(
      raise(job.orgId, {
        type: 'STAGE_DEAD_LETTER',
        status: 'FAILED',
        subject: `Stage "${stage.name}" of ${name} keeps failing`,
        errorMessage: (record && record.error) || 'The stage used up its retries',
        payload: {
          integrationId: job.integrationId,
          stageId: job.stageId,
          deliveryId: job.deliveryId,
          runId: record ? record.runId : null,
        },
      })
    ).catch((error) => log('error', 'Could not raise a stage dead-letter alert', { orgId: job.orgId, error: error.message }));
  };
}

module.exports = { createDeadLetterAlerter };
