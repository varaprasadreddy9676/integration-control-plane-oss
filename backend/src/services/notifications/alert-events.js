'use strict';

/** Alerts a channel can subscribe to. */
const ALERT_EVENTS = [
  { type: 'INTEGRATION_DELIVERY_FAILING', label: 'An integration starts failing every delivery' },
  { type: 'INTEGRATION_DELIVERY_RECOVERED', label: 'A failing integration recovers' },
];

const ALERT_EVENT_TYPES = ALERT_EVENTS.map((event) => event.type);

module.exports = { ALERT_EVENTS, ALERT_EVENT_TYPES };
