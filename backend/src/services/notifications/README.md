# Notifications

Two things live here:

- **Failure reports and alert emails** (`failure-report.js`, `integration-mailer.js`): the
  periodic failure digest and the per-organization alert email configured under
  Settings → Failure email reports.
- **Alert channels** (`plugins/`, `alert-dispatcher.js`): where an organization's alerts
  go — Slack, email lists, any HTTP endpoint, WhatsApp. Each organization can have
  several channels, each subscribed to the alerts it wants. They are managed in
  Settings → Alert channels or through `/api/v1/alert-channels`.

## How an alert reaches a channel

```
delivery-failure watcher ──notify──> alert-dispatcher.dispatchAlert(orgId, alert)
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
| `type` | `INTEGRATION_DELIVERY_FAILING`, `INTEGRATION_DELIVERY_RECOVERED`, `TEST` |
| `severity` | `critical`, `resolved`, `info` |
| `title` | `Integration deliveries failing: Orders to CRM has failed every delivery for 15 minutes` |
| `message` | the last error, if any |
| `orgId`, `orgName` | `1`, `Acme Retail` |
| `integration` | `{ id, name }`, when the alert is about one |
| `occurredAt` | ISO timestamp |
| `link` | console link to the delivery logs, when the console URL is configured |

The webhook plugin sends exactly this as JSON, with `version: 1`.

## Writing a plugin

A plugin is one module in `plugins/`:

```js
module.exports = {
  type: 'teams',                       // unique id
  name: 'Microsoft Teams',             // shown in the console
  description: 'Post alerts to a Teams channel.',
  fields: [
    // type: 'text' | 'url' | 'secret' | 'list'
    { key: 'webhookUrl', label: 'Teams webhook URL', type: 'secret', required: true },
  ],
  async send(alert, settings) {
    // deliver one alert; throw to report a failure
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
