# Outbound Event Delivery

Outbound delivery is the core of the gateway. When an event is received, the system finds all matching active integrations and either delivers, schedules, or holds the payload based on the configured delivery mode.

---

## How It Works

1. **Event arrives** in the queue with an `orgId`, `eventType`, and `payload`.
2. **Matching integrations** are fetched — all `OUTBOUND` configs that match the event type and are active.
3. **Payload transformation** is applied (field mapping or custom JS script).
4. Depending on `deliveryMode`, the system either:
   - sends immediately,
   - creates scheduled rows,
   - or stores a held payload for later release.
5. **Authentication headers** are attached based on the configured auth type.
6. **HTTP request** is sent to the `targetUrl` with the configured `httpMethod`.
7. **Response is logged** with full request/response body, status, and timing.
8. On failure, **retry logic** kicks in with exponential backoff.
9. If retries are exhausted, the event is written to the **Dead Letter Queue (DLQ)**.

---

## HTTP Methods Supported

`POST` (default), `PUT`, `PATCH`, `GET`

---

## Delivery Modes

| Mode | Behavior |
|------|----------|
| `IMMEDIATE` | Transform and deliver now |
| `DELAYED` | Transform now, schedule one future delivery |
| `RECURRING` | Transform now, schedule a recurring series |
| `WAIT_FOR_CONDITION` | Transform now, hold the payload until a release/discard event arrives |

`WAIT_FOR_EVENT` is accepted as a legacy alias and is normalized internally to `WAIT_FOR_CONDITION`.

Lifecycle and hold/release details are documented in [Outbound Lifecycle & Gated Delivery](/docs/outbound-lifecycle).

---

## Authentication Types

| Type | How It Works |
|------|-------------|
| `NONE` | No auth header added |
| `API_KEY` | Custom header with key/value you configure |
| `BEARER` | `Authorization: Bearer <token>` |
| `BASIC` | `Authorization: Basic <base64(user:pass)>` |
| `OAUTH2` | Client credentials flow — token fetched and cached automatically |
| `CUSTOM` | Custom JS script in a secure VM to build auth headers |

**Token caching:** For `OAUTH2` and `CUSTOM`, tokens are cached in memory. The cache is cleared automatically on 401/403 responses or when a token-expiration pattern is detected in the response body.

---

## Retry Logic

| Scenario | Retried? |
|----------|----------|
| `5xx` server error | Yes |
| `429` rate limited | Yes |
| `401` / `403` auth failure | Yes (also clears token cache) |
| `408` request timeout | Yes |
| `4xx` client error (other) | No |
| Network error (`ECONNREFUSED`, `ETIMEDOUT`, etc.) | Yes |
| Test events | No |

**Backoff formula:** `min(1000ms × 2^(attempt−1), 5000ms) + jitter(0–250ms)`

Default max retries: **3 attempts**. On final failure the status is set to `ABANDONED` and a DLQ entry is created.

---

## Dead Letter Queue (DLQ)

A DLQ entry is created when delivery permanently fails after all retries. It stores the original payload, error details, and correlation IDs so you can replay or inspect the failure.

**DLQ error codes:**

| Code | Meaning |
|------|---------|
| `INVALID_URL` | Target URL failed validation |
| `TRANSFORMATION_ERROR` | Payload transform script failed |
| `RATE_LIMIT` | Downstream returned 429 |
| `SERVER_ERROR` | Downstream returned 5xx |
| `CLIENT_ERROR` | Downstream returned 4xx (non-auth) |
| `TIMEOUT` | Connection timed out |
| `NETWORK_ERROR` | Host unreachable / DNS failure |
| `COMMUNICATION_ERROR` | Email/SMS delivery failed |

---

## Request Signing

If `enableSigning` is turned on, each request gets three additional headers:

```
X-Integration-Signature: v1,<base64_hmac>
X-Integration-ID: <uuid>
X-Integration-Timestamp: <unix_seconds>
```

The signature is HMAC-SHA256 over `${messageId}.${timestamp}.${rawPayload}`. Multiple signing secrets are supported for key rotation, and if signing is enabled but headers cannot be generated, the request is failed instead of being sent unsigned.

---

## Multi-Action Integrations

A single integration can run a sequence of actions in order. Each action can have its own `targetUrl`, `httpMethod`, and transformation. Actions can also have conditions — a skipped action does not count as a failure.

**Overall status logic:**

| Actions Result | Final Status |
|----------------|-------------|
| All succeeded | `SUCCESS` |
| Mix of success + failure | `PARTIAL_SUCCESS` |
| All failed | `FAILED` |
| All skipped | `SKIPPED` |

---

## Execution Tracing

Every delivery attempt produces a full execution trace record with:
- `traceId` — unique per event delivery
- `correlationId` — same as traceId, included as `X-Correlation-ID` / `X-Trace-ID` headers on every outgoing request
- Request payload, response body, status code, response time
- Step-by-step log (transformation → auth → HTTP call)
- `attemptCount` — how many tries were made

---

## Rate Limiting

Each integration can have a rate limit configured:
- `maxRequests` — requests allowed per window (default: 100)
- `windowSeconds` — time window size (default: 60 seconds)

If the limit is hit, the delivery is paused and retried. The downstream is not hammered.

---

## Target URL Validation

Outbound targets are validated both at save time and at delivery time.

Current rules:

| Rule | Behavior |
|------|----------|
| Scheme | Only `http://` and `https://` are allowed |
| HTTPS-only mode | Optional, controlled by system config `security.enforceHttps` |
| Private network blocking | Optional, controlled by `security.blockPrivateNetworks` |

This means local HTTP services are supported when your deployment allows them, while SSRF-related private-network restrictions remain a separate control.

---

## Configuration Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `targetUrl` | string | — | HTTP endpoint to deliver to |
| `httpMethod` | string | `POST` | HTTP verb |
| `timeoutMs` | number | `10000` | Request timeout in ms |
| `retryCount` | number | `3` | Max delivery attempts |
| `outgoingAuthType` | string | `NONE` | Auth mechanism |
| `enableSigning` | boolean | `false` | HMAC request signing |
| `rateLimits.enabled` | boolean | `false` | Enable rate limiting |
| `rateLimits.maxRequests` | number | `100` | Requests per window |
| `rateLimits.windowSeconds` | number | `60` | Window size in seconds |
| `preDeliveryChecks` | array | — | Up to 5 URLs to fetch before each delivery (see below) |

---

## Pre-delivery URL checks

Some targets accept a request at once and download a URL inside it later, such as a document link in a
messaging template. If that later download is slow or fails, the target reports it outside the delivery
and the gateway has already logged `SUCCESS`, so nothing is retried.

`preDeliveryChecks` makes the gateway fetch those URLs first. Checks run in order after the transformation
and before the request is sent; the first one that does not pass ends the attempt without sending.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `urlPath` | Label shown in logs |
| `urlPath` | string | — | Dot path to the URL, e.g. `template.header.document.link` or `components.0.url` |
| `source` | string | `request` | `request` (transformed body) or `event` (original event payload) |
| `method` | string | `GET` | `GET` downloads the whole response (and warms any cache on that server); `HEAD` checks the status only |
| `timeoutMs` | number | `30000` | 1000–120000 |
| `expectedContentTypes` | string[] | — | The response `Content-Type` must start with one of these |
| `minBytes` | number | `0` | Smallest acceptable body (GET only) |
| `onMissingUrl` | string | `PASS` | `PASS` sends anyway when the field is empty; `FAIL` fails the delivery |

Outcomes:

- **Pass** — 2xx and every expectation met: the delivery is sent.
- **Retry** — timeout, network error, or HTTP 408, 425, 429, 5xx: logged as `RETRYING` and retried with the
  normal backoff up to `retryCount`, then `ABANDONED`.
- **Fail** — any other status, a wrong content type or a too-small body: logged as `FAILED` with no retry and
  no DLQ entry, because it would fail the same way again.

A failed check never trips the target's circuit breaker. The check URL must pass the same URL policy as
target URLs (private networks blocked by default). Checks run on every delivery path: single-target and
multi-action, immediate and scheduled. In a multi-action integration, an action's own `preDeliveryChecks`
replace the integration's for that action, and are checked against that action's transformed request.
