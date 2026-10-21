'use strict';

/**
 * Alerts when a scheduled job changes state: a job that worked (or never ran)
 * fails, or a failing job succeeds again. Repeated failures raise nothing more.
 * The previous outcome comes from the job's run history, so this survives restarts.
 */

const FINAL = new Set(['SUCCESS', 'FAILED']);

async function alertOnScheduledJobOutcome({ job, result, dryRun = false, previousStatus, raise }) {
  if (dryRun || !FINAL.has(result?.status)) return;
  const previous = await previousStatus();
  const payload = { jobId: String(job._id), jobName: job.name };

  if (result.status === 'FAILED' && previous !== 'FAILED') {
    await raise(job.orgId, {
      type: 'SCHEDULED_JOB_FAILED',
      status: 'FAILED',
      subject: `Scheduled job failed: ${job.name}`,
      errorMessage: result.error || 'The run failed',
      payload,
      windowEnd: new Date(),
    });
  } else if (result.status === 'SUCCESS' && previous === 'FAILED') {
    await raise(job.orgId, {
      type: 'SCHEDULED_JOB_RECOVERED',
      status: 'RESOLVED',
      subject: `Scheduled job succeeded again: ${job.name}`,
      payload,
      windowEnd: new Date(),
    });
  }
}

module.exports = { alertOnScheduledJobOutcome };
