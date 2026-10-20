# Outbound Lifecycle & Condition Delivery Guide

This guide covers the two generic outbound control models now supported by the platform:

- **Lifecycle invalidation** for `DELAYED` and `RECURRING` integrations
- **Condition-based hold/release** for `WAIT_FOR_CONDITION` integrations

These features are intentionally domain-agnostic. The platform does not hardcode concepts like patient IDs or booking numbers. Instead, integrations declare:

- `resourceType`
- `subjectExtraction`
- rule lists (`lifecycleRules` or `conditionConfig`)
- `matchKeys`

---

## 1. Subject Extraction

`subjectExtraction` defines how to derive a flat correlation object from an event payload.

### PATHS mode

```json
{
  "subjectExtraction": {
    "mode": "PATHS",
    "paths": {
      "appointment_id": "appt.apptRID",
      "booking_ref": "appt.bookingNumber"
    }
  }
}
```

### SCRIPT mode

```json
{
  "subjectExtraction": {
    "mode": "SCRIPT",
    "script": "return { grn_id: payload.grn?.id, txn_id: payload.grn?.transactionId };"
  }
}
```

Notes:
- the extracted subject must be a **flat scalar object**
- script extraction runs in the same secure VM model used elsewhere in the platform
- previews are available before save

---

## 2. Lifecycle Rules For Scheduled Deliveries

Use lifecycle rules on `DELAYED` or `RECURRING` integrations when later events should cancel or replace pending scheduled rows.

### Example

```json
{
  "deliveryMode": "DELAYED",
  "resourceType": "APPOINTMENT",
  "subjectExtraction": {
    "mode": "PATHS",
    "paths": {
      "appointment_id": "appt.apptRID",
      "booking_ref": "appt.bookingNumber"
    }
  },
  "lifecycleRules": [
    {
      "eventTypes": ["APPOINTMENT_CANCELLATION"],
      "action": "CANCEL_PENDING",
      "matchKeys": ["appointment_id", "booking_ref"]
    },
    {
      "eventTypes": ["APPOINTMENT_RESCHEDULED"],
      "action": "RESCHEDULE_PENDING",
      "matchKeys": ["appointment_id", "booking_ref"]
    }
  ]
}
```

### Implemented actions

| Action | Behavior |
|--------|----------|
| `CANCEL_PENDING` | Cancels matching pending scheduled rows |
| `RESCHEDULE_PENDING` | Cancels matching pending scheduled rows, then lets the current event continue through normal scheduling |
| `IGNORE` | Declares that the event should not affect scheduled rows |

### Important runtime behavior

- invalidation is evaluated in `event-handler.js` before the normal "no matching integrations" skip
- matching is scoped to the owning `integrationConfigId`
- recurring rows keep the same lifecycle metadata when the next occurrence is created
- legacy rows can still be evaluated from stored `originalPayload` plus the saved extraction config

### Audit behavior for invalidation-only follow-up events

Some follow-up events exist only to invalidate already-scheduled rows. A common example is:

- `APPOINTMENT_CONFIRMATION` schedules delayed reminders
- later `APPOINTMENT_CANCELLATION` or `APPOINTMENT_RESCHEDULED` arrives
- the follow-up event cancels matching pending reminders
- there may still be no direct outbound integration for that follow-up event itself

In that case, event audit still ends in `SKIPPED`, but the reason should explain the lifecycle work that actually happened.

Example:

```text
Cancelled 2 scheduled reminders; no direct outbound integrations matched this event
```

This means the follow-up event successfully invalidated pending rows even though it did not itself deliver an outbound message.

---

## 3. Transformation Script Skip Contract

Transformation scripts can return a structured skip instead of a plain `null` when the integration is intentionally not eligible to send.

### Recommended pattern

```js
const reasonName = payload.visit?.reasonName || '';
const reasonNameNormalized = String(reasonName).trim().toLowerCase();

if (reasonNameNormalized !== 'new patient') {
  const reasonValue = String(reasonName || '').trim();
  return skip(
    `visit.reasonName "${reasonValue}" is not eligible; only "New Patient" is allowed`,
    {
      field: 'visit.reasonName',
      actualValue: reasonValue,
      expectedValue: 'New Patient'
    }
  );
}
```

### When to use `skip(...)` vs `return null`

- Use `skip(...)` for business-rule exclusions that operators should be able to understand from logs and audit.
- Use `return null` only when you intentionally want a silent skip with no extra explanation.

### Runtime effect

When a script returns `skip(...)`:

- execution logs keep the explicit reason
- event audit uses that reason when all matched integrations skip
- operators can understand the skip without reading the script source

The helper is available automatically inside script transformations:

```js
return skip('Patient phone is missing', { field: 'patient.phone' });
```

---

## 4. Custom Auth — Token as Query Parameter

Some external APIs require the bearer token to be passed as a URL query parameter instead of an `Authorization` header. Set `tokenLocation: "query"` in `outgoingAuthConfig` to enable this:

```json
{
  "outgoingAuthType": "CUSTOM",
  "outgoingAuthConfig": {
    "tokenEndpoint": "https://api.example.com/Token",
    "tokenRequestMethod": "POST",
    "tokenRequestBody": "{\"UserName\":\"user\",\"Password\":\"pass\",\"DeviceId\":\"MyApp\"}",
    "tokenResponsePath": "Token",
    "tokenLocation": "query",
    "tokenQueryParamName": "token"
  }
}
```

**Runtime behaviour:**

1. Gateway fetches a token from `tokenEndpoint` using `tokenRequestBody`
2. Extracts the token value via `tokenResponsePath` (dot-notation supported)
3. Appends `?<tokenQueryParamName>=<token>` to the target URL
4. Removes the `Authorization` header from the request

**Token caching:** the token is cached in MongoDB under `outgoingAuthConfig._cachedToken` and reused until it expires. On a 401 response the cache is cleared and a fresh token is fetched before the next retry.

**`tokenLocation` values:**

| Value | Behaviour |
|-------|-----------|
| `"query"` | Token appended to URL as query parameter |
| _(absent / any other value)_ | Token sent in `Authorization: Bearer <token>` header (default) |

---

## 5. HTTP Helper in Transform Scripts

Transform scripts have access to an `http` helper for making external or internal HTTP calls during transformation. This enables patterns like looking up reference data, checking external state, or suppressing duplicate events.

### Available methods

```js
await http.get(url, headers?)
await http.post(url, body, headers?)
await http.put(url, body, headers?)
await http.patch(url, body, headers?)
await http.delete(url, headers?)
```

All methods return the parsed JSON response body. The VM timeout (60 seconds) applies across all calls.

### Event coalescing — skip duplicate deliveries

When two event types are always fired together for the same action (e.g. `COUPLE_REGISTERED` + `OP_VISIT_CREATED`), only one should deliver to the target system. Use the `/internal/event-coalesce` endpoint to detect whether the companion event was already processed:

```js
const patientMrn = payload?.patient?.mrn?.documentNumber || payload?.visit?.patientMRN || '';
const orgId = payload?.enterpriseEntityRID || context?.orgId || '';
const port  = context?.port || 4000;

try {
  const resp = await http.get(
    `http://localhost:${port}/internal/event-coalesce` +
    `?orgId=${orgId}&eventType=COUPLE_REGISTERED` +
    `&patientMrn=${encodeURIComponent(patientMrn)}&withinSeconds=120`
  );
  if (resp?.exists === true) {
    return skip('COUPLE_REGISTERED already handled this patient — skipping duplicate');
  }
} catch (e) {
  // proceed on error — never block delivery due to a coalesce check failure
}
```

**How it works:**

- The gateway records every successfully processed event in `processed_events` (6-hour TTL)
- `/internal/event-coalesce` queries that collection by `eventType + orgId + patientMrn`
- `withinSeconds` controls the look-back window (default 120 s)
- If the check call fails for any reason, the script proceeds with delivery — the endpoint is advisory, not a gate

**Design rule:** the coalescing logic lives entirely in the transform script (MongoDB). No code changes are needed to add this pattern to a new integration.

---

## 6. WAIT_FOR_CONDITION

Use `WAIT_FOR_CONDITION` when the first event should not be delivered yet.

Typical examples:
- `GRN_CREATED` -> wait for `GRN_APPROVED`
- `ORDER_CREATED` -> wait for `PAYMENT_SUCCESS`
- `BOOKING_CREATED` -> wait for `BOOKING_CONFIRMED`

### Example

```json
{
  "deliveryMode": "WAIT_FOR_CONDITION",
  "resourceType": "GRN",
  "subjectExtraction": {
    "mode": "SCRIPT",
    "script": "return { grn_id: payload.grn?.id, txn_id: payload.grn?.transactionId };"
  },
  "conditionConfig": {
    "payloadStrategy": "ORIGINAL_EVENT",
    "releaseRules": [
      {
        "eventTypes": ["GRN_APPROVED"],
        "action": "RELEASE_HELD",
        "matchKeys": ["grn_id", "txn_id"]
      }
    ],
    "discardRules": [
      {
        "eventTypes": ["GRN_REJECTED", "GRN_CANCELLED"],
        "action": "DISCARD_HELD",
        "matchKeys": ["grn_id", "txn_id"]
      }
    ],
    "expiresAfterMs": 604800000
  }
}
```

### Runtime flow

1. Start event arrives
2. Transformation runs immediately
3. The transformed payload is stored in `held_outbound_deliveries`
4. Follow-up events are checked against `releaseRules` and `discardRules`
5. Matching held rows are released or discarded

### Current payload strategy support

| Strategy | Support |
|----------|---------|
| `ORIGINAL_EVENT` | Supported |
| `LATEST_EVENT` | Not implemented yet |
| `MERGED_EVENTS` | Not implemented yet |
| `CUSTOM_SCRIPT` | Not implemented yet |

`WAIT_FOR_EVENT` is accepted as a legacy alias and normalized to `WAIT_FOR_CONDITION`.

---

## 7. Validation Rules

### Lifecycle config

- `resourceType` is required when `lifecycleRules` exist
- `subjectExtraction` is required when `lifecycleRules` exist
- rule event types must be unique across the integration
- non-`IGNORE` rules must define `matchKeys`
- in `PATHS` mode, all `matchKeys` must exist in the path map

### Condition config

- `conditionConfig` is required for `WAIT_FOR_CONDITION`
- at least one `releaseRule` is required
- release and discard event types must be unique
- every rule must define `matchKeys`
- in `PATHS` mode, all `matchKeys` must exist in the path map
- only `ORIGINAL_EVENT` payload strategy is currently valid

---

## 8. Preview APIs

### Preview extracted subject

```http
POST /api/v1/outbound-integrations/preview-subject
```

Request body:

```json
{
  "eventType": "APPOINTMENT_CANCELLATION",
  "resourceType": "APPOINTMENT",
  "subjectExtraction": {
    "mode": "PATHS",
    "paths": {
      "appointment_id": "appt.apptRID"
    }
  },
  "samplePayload": {
    "appt": {
      "apptRID": 4153193
    }
  }
}
```

### Preview scheduled-row impact

```http
POST /api/v1/outbound-integrations/preview-cancellation
```

Returns:
- extracted subject
- selected lifecycle action
- matching scheduled rows
- keys matched
- warnings

### Preview held-row impact

```http
POST /api/v1/outbound-integrations/preview-condition
```

Returns:
- extracted subject
- selected condition action
- matching held rows
- keys matched
- warnings

---

## 9. Runtime Collections

### `scheduled_integrations`

Rows now store lifecycle metadata used during invalidation:

- `subject`
- `subjectExtraction`
- `lifecycleRules`

### `held_outbound_deliveries`

Rows store hold-and-release state for `WAIT_FOR_CONDITION`:

- held transformed payload
- original payload
- `subject`
- `subjectExtraction`
- `conditionConfig`
- status: `HELD`, `RELEASED`, `DISCARDED`

---

## 10. Real Scenarios This Solves

### Appointment reminders

- schedule on confirmation
- cancel on cancellation
- cancel + recreate on reschedule

### Approval gate

- hold `GRN_CREATED`
- release on `GRN_APPROVED`
- discard on `GRN_REJECTED`

### Generic B2B gating

- hold `ORDER_CREATED`
- release on `PAYMENT_SUCCESS`
- discard on `ORDER_CANCELLED`

---

## 11. Related Files

- `backend/src/services/lifecycle-config.js`
- `backend/src/services/condition-config.js`
- `backend/src/processor/event-normalizer.js`
- `backend/src/processor/event-handler.js`
- `backend/src/processor/event-processor.js`
- `backend/src/processor/delivery-engine.js` — token-in-query-param handling
- `backend/src/data/scheduled-integrations.js`
- `backend/src/data/held-outbound-deliveries.js`
- `backend/src/routes/outbound-integrations.js`
- `backend/src/routes/internal.js` — `/internal/event-coalesce` endpoint
