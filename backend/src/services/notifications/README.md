# Notifications

Two things live here:

- **Failure reports and alert emails** (`failure-report.js`, `integration-mailer.js`): the
  periodic failure digest and the per-organization alert email configured under
  Settings → Failure email reports.
- **Alert channels** (`plugins/`, `alert-dispatcher.js`): where an organization's alerts
  go — Slack, email lists, any HTTP endpoint, WhatsApp, or one of the org's inbound
  integrations (which can reshape the alert and call any API with its own auth,
  retries and delivery logs). Each organization can have
  several channels, each subscribed to the alerts it wants. They are managed in
  Settings → Alert channels or through `/api/v1/alert-channels`.

## Alerts

| Alert | Raised by | All-clear |
|-------|-----------|-----------|
| `INTEGRATION_DELIVERY_FAILING` | `delivery-failure-health.js`: an integration failed every delivery for a while | `INTEGRATION_DELIVERY_RECOVERED` |
| `EVENT_SOURCE_DOWN` | `event-source-health.js`: the org's event source keeps failing | `EVENT_SOURCE_RECOVERED` |
| `SCHEDULED_JOB_FAILED` | `scheduled-job-alerts.js`: a job that worked (or never ran) fails | `SCHEDULED_JOB_RECOVERED` |
| `DLQ_BACKLOG` | `dlq-backlog-health.js`: pending/retrying dead-letter entries reach `DLQ_ALERT_THRESHOLD` (100) | `DLQ_BACKLOG_CLEARED` (below half) |

All of them go through `raise-alert.js`, which records the alert in the Alert Center
and sends it to the channels. A channel with every alert selected is stored as
`ALL` and also receives alert types added later.

## How an alert reaches a channel

```
health watchers ──raiseAlert──> Alert Center + alert-dispatcher.dispatchAlert(orgId, alert)
                                        │  enabled channels subscribed to alert.type
                                        ├── plugins/slack     send(alert, settings)
                                        ├── plugins/webhook   send(alert, settings)
                                        └── …
```

Channels are independent: one that fails or hangs (15 s limit) does not stop the
others. The outcome of the last send is stored on the channel and shown in the
console.

## The alert object

Every plugin receives the same shape:

| Field | Example |
|-------|---------|
| `type` | any alert above, or `TEST` |
| `severity` | `critical`, `resolved`, `info` |
| `title` | `Integration deliveries failing: Orders to CRM has failed every delivery for 15 minutes` |
| `message` | the last error, if any |
| `orgId`, `orgName` | `1`, `Acme Retail` |
| `integration` | `{ id, name }`, when the alert is about one |
| `job` | `{ id, name }`, for scheduled job alerts |
| `occurredAt` | ISO timestamp |
| `link` | console link to the page for the problem, when the console URL is configured |

The webhook plugin sends exactly this as JSON, with `version: 1`.

## Writing a plugin

A plugin is one module in `plugins/`:

```js
module.exports = {
  type: 'teams',                       // unique id
  name: 'Microsoft Teams',             // shown in the console
  description: 'Post alerts to a Teams channel.',
  fields: [
    // type: 'text' | 'url' | 'secret' | 'list' | 'integration' (with direction)
    { key: 'webhookUrl', label: 'Teams webhook URL', type: 'secret', required: true },
  ],
  async send(alert, settings) {
    // deliver one alert; throw to report a failure
  },
  // optional: checks that need the database, run when the channel is saved
  async verify(settings, { orgId }) {
    return null; // or a message explaining what is wrong
  },
};
```

Then add it to the `PLUGINS` list in `plugins/index.js`. That is all:

- the console builds the settings form from `fields`;
- settings are validated from `fields` (`required`, `pattern`, `itemPattern` for lists);
- `secret` fields are encrypted at rest, never returned by the API (a mask is shown),
  and a masked value sent back on update keeps the stored secret;
- `plugins/format.js` has shared helpers (`summaryText`, `escapeHtml`, `isResolved`).

New alert types go in `alert-events.js`.

## Calling the gateway's own inbound integrations

The `inbound-integration` plugin posts the alert to
`http://127.0.0.1:<port>/api/v1/public/integrations/<type>` with a random token
generated at startup and kept in memory (`utils/internal-call.js`). The inbound
runtime treats a request carrying it as trusted and skips the integration's caller
authentication and IP policy. Everything else (transform, outgoing auth, retries,
delivery logs) runs as for any caller. This assumes one backend process per port,
as in the Docker image and the systemd service; with several processes behind one
port, a call could reach a process with a different token and be refused.
