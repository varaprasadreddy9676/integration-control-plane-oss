# Backend Service (Integration Gateway)

Express API and worker service for the Integration Gateway control plane.

## What It Runs

- REST API under `/api/v1`
- Outbound and inbound integration runtime (HTTP and Communication actions)
- Delivery worker, scheduler worker, DLQ worker, communication job worker
- Per-org event-source adapters (`mysql`, `kafka`, `http_push`)
- Pluggable communication adapters (Email SMTP, WhatsApp Meta, Firebase FCM, etc.)
- MCP and API integrations are kept outside the runtime provider layer; the backend exposes the authenticated APIs they use.

## Prerequisites

- Node.js 26 (24 LTS also works)
- MongoDB 9.0 (7.0 or later works)
- Optional: MySQL and Kafka (only if used by org event-source configs)

## Quick Start

```bash
cd backend
npm install
cp config.example.json config.json
npm run dev
```

Env loading order is:

1. repository root `.env`
2. optional `backend/.env` override

So startup behavior is consistent whether the backend is launched from repo root or from `backend/`.

Health check:

```bash
curl http://localhost:3545/health
```

## Configuration

Main config file: `backend/config.json`.

Required:

- `port`
- `mongodb.uri`
- `security.apiKey`
- `security.jwtSecret`

Optional:

- `db.*` shared MySQL pool (only needed when using shared MySQL source)
- `eventSource.type` global default source type (leave empty for fully dynamic per-org source setup)

## MySQL Behavior (Important)

MySQL is optional and organization-driven.

- Per-org dedicated MySQL credentials are configured via `POST/PUT /api/v1/event-sources`.
- Shared MySQL pool can be configured via `config.json` (`db.*`) if you want one common source.
- If MySQL is not configured, backend still starts and runs MongoDB-backed features.

Server-side safety guardrails now clamp MySQL settings:

- Shared pool: `connectionLimit` 1..20, `queueLimit` 0..200
- Dedicated pool: `connectionLimit` 1..5, `queueLimit` 0..50
- MySQL source tuning: `pollIntervalMs` 1000..300000, `batchSize` 1..100, `dbTimeoutMs` 1000..120000

These limits are enforced on save/test/runtime paths to prevent DB overload.

## Useful Commands

```bash
npm run dev
npm start
# start:production is available for tuned memory settings
npm run start:production
npm run seed:schemas
npm run seed:ui-config
npm run check
npm run lint
```

## Integration Authoring Notes

- For delayed and recurring integrations that must be invalidated by later events such as `APPOINTMENT_CANCELLATION` or `APPOINTMENT_RESCHEDULED`, use `subjectExtraction` plus `lifecycleRules`.
- For script transformations, prefer `return skip('reason', { ...details })` when an event is intentionally ineligible. That reason is surfaced in execution logs and event audit.
- Use plain `return null` only when you want a silent skip with no operator-facing explanation.
- For COMMUNICATION action transformations, return an object with channel-specific fields (e.g., `to`, `subject`, `html` for EMAIL; `to`, `text`, `templateName` for WhatsApp).

See [Outbound Lifecycle & Condition Delivery Guide](/Users/sai/Documents/GitHub/integration-control-plane/docs/guides/OUTBOUND-LIFECYCLE.md) for full examples.
See [Communication Adapters Guide](backend/docs/COMMUNICATION_ADAPTERS.md) for communication-specific patterns.

## Authentication: Token-in-Query-Parameter

Some external APIs require the bearer token to be sent as a URL query parameter rather than in the `Authorization` header. Configure this in `outgoingAuthConfig`:

```json
{
  "outgoingAuthType": "CUSTOM",
  "outgoingAuthConfig": {
    "tokenEndpoint": "https://api.example.com/Token",
    "tokenRequestMethod": "POST",
    "tokenRequestBody": "{\"UserName\":\"user\",\"Password\":\"pass\"}",
    "tokenResponsePath": "Token",
    "tokenLocation": "query",
    "tokenQueryParamName": "token"
  }
}
```

When `tokenLocation` is `"query"`, the runtime appends `?<tokenQueryParamName>=<token>` to the target URL and removes the `Authorization` header before sending.

## Internal Endpoints (Transform Script Helpers)

The gateway exposes lightweight internal endpoints at `/internal/*` (no authentication required, intended for use by transform scripts via the `http` helper). These are **not** part of the public API and must never be exposed externally.

### `/internal/event-coalesce`

Checks whether a companion event of a given type was recently processed for the same patient. Useful for suppressing duplicate deliveries when two event types are always fired together (e.g. `COUPLE_REGISTERED` + `OP_VISIT_CREATED`).

```
GET /internal/event-coalesce?orgId=847&eventType=COUPLE_REGISTERED&patientMrn=BNH00045&withinSeconds=120
```

Response: `{ "exists": true|false }`

**Usage in a transform script:**

```js
const patientMrn = payload?.patient?.mrn?.documentNumber || payload?.visit?.patientMRN || '';
const orgId = payload?.enterpriseEntityRID || context?.orgId || '';
const port  = context?.port || 4000;

try {
  const resp = await http.get(
    `http://localhost:${port}/internal/event-coalesce?orgId=${orgId}&eventType=COUPLE_REGISTERED&patientMrn=${encodeURIComponent(patientMrn)}&withinSeconds=120`
  );
  if (resp?.exists === true) {
    return skip('COUPLE_REGISTERED already handled this patient — skipping duplicate');
  }
} catch (e) {
  // proceed on error — don't block delivery
}
```

Note: `context.port` is injected automatically by the runtime. Scripts do not need to hardcode the port.

## Docker

Use repository-level compose files:

- `docker-compose.yml`
- `docker-compose.dev.yml`

See `/docs/guides/DOCKER.md` for full instructions.
