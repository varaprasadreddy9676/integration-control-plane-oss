'use strict';

/** Alerts a channel can subscribe to, each problem followed by its all-clear. */
const ALERT_EVENTS = [
  { type: 'INTEGRATION_DELIVERY_FAILING', label: 'An integration starts failing every delivery' },
  { type: 'INTEGRATION_DELIVERY_RECOVERED', label: 'A failing integration recovers' },
  { type: 'EVENT_SOURCE_DOWN', label: 'The event source stops working' },
  { type: 'EVENT_SOURCE_RECOVERED', label: 'The event source works again' },
  { type: 'SCHEDULED_JOB_FAILED', label: 'A scheduled job fails' },
  { type: 'SCHEDULED_JOB_RECOVERED', label: 'A failing scheduled job succeeds again' },
  { type: 'DLQ_BACKLOG', label: 'Failed deliveries pile up in the dead-letter queue' },
  { type: 'DLQ_BACKLOG_CLEARED', label: 'The dead-letter queue backlog clears' },
];

const ALERT_EVENT_TYPES = ALERT_EVENTS.map((event) => event.type);

/** The all-clear types: shown as resolved, not as problems. */
const RESOLVED_ALERT_TYPES = new Set([
  'INTEGRATION_DELIVERY_RECOVERED',
  'EVENT_SOURCE_RECOVERED',
  'SCHEDULED_JOB_RECOVERED',
  'DLQ_BACKLOG_CLEARED',
]);

module.exports = { ALERT_EVENTS, ALERT_EVENT_TYPES, RESOLVED_ALERT_TYPES };
