# Integration Control Plane — MCP Server

Gives Claude (and any MCP client) direct access to the Integration Gateway. Talk to it in
plain language and it does the work — diagnose a failing org, reset a circuit breaker,
replay deliveries, create or edit an outbound/inbound integration, set up a scheduled job,
provision credentials, or pull an audit trail — without touching the admin web UI.

**This is the intended way to manage integration configuration going forward.** The web
UI remains available as a read-only fallback/viewer, but creating, editing, and deleting
integrations, inbound webhooks, scheduled jobs, and credentials should go through these
tools so every change is captured consistently (via `check_audit_trail`) and can be driven
conversationally.

**Status:** 40 tools total, plus two resources and two workflow prompts. Outbound
integrations, inbound integrations, and scheduled jobs (23 of the 40 tools) are
live-tested against validation as of 2026-07-14 — real
create/get/update/delete/execute round trips against the real backend, not just unit
tests. The original 12 ops/credentials tools are exercised routinely but weren't part of
that specific pass. `report_issue` and `request_feature` (added 2026-07-14) are unit-tested
only — see [Issue Reporting](#issue-reporting-github) below. See the
[Permission Reference](#permission-reference) section for exactly what's been verified and
what hasn't.

## What can I actually do with it?

Ask in plain English — the tool names below are what happens under the hood, you don't
need to know them up front.

- **"Why is org 892 failing deliveries?"** → diagnoses the org, checks circuit breaker
  state, pulls recent failed delivery logs and their full request/response traces.
- **"Reset the circuit breaker for integration X and replay the failed deliveries"** →
  resets it, tests it's healthy, replays the backlog, confirms they went through.
- **"Create an outbound integration that fires on LAB_RESULT_READY and posts to
  partner.example.com"** → builds and saves the integration, live-tests it, confirms it's
  in the audit trail. (See the [Configuration Runbook](#configuration-runbook) below for
  the full create/edit/delete lifecycle on outbound integrations, inbound webhooks, and
  scheduled jobs.)
- **"Set up a scheduled job that runs this script every night at 2am"** → creates it,
  fetches a test run, confirms the schedule.
- **"Provision credentials for this new integration"** → creates the credential
  placeholder, sets the secret values (never echoed back), confirms completeness.
- **"What changed on org X in the last hour?"** → full audit trail of every MCP action —
  who, what tool, what reason, when.

Every response is tagged with which environment it came from (`_env: "validation"` or
`"production"`), so you're never guessing which system you just changed.

The server also exposes `icp://docs/quickstart` and `icp://docs/safety` resources, plus
`incident_triage` and `integration_change_review` prompts for MCP clients that support
native resources and prompts.

---

## Tools

### Connection

| Tool | Permission | Mutates |
|------|------------|---------|
| `gateway_health` | `system:health` | — |

### Operations (diagnostics, circuit breakers, replay)

| Tool | Permission | Mutates |
|------|-----------|---------|
| `list_integrations` | `ops:read` | — |
| `diagnose_org` | `ops:read` | — |
| `get_integration_status` | `ops:read` | — |
| `search_delivery_logs` | `ops:read` | — |
| `get_execution_trace` | `ops:read` | — |
| `check_audit_trail` | `ops:read` | — |
| `run_integration_test` | `ops:test` | — (safe read) |
| `reset_circuit_breaker` | `ops:circuit_reset` | ✓ |
| `replay_delivery` | `ops:replay` | ✓ |

### Outbound integrations (event rules)

| Tool | Permission (intended) | Mutates |
|------|-----------|---------|
| `list_outbound_integrations` | `integration:view` | — |
| `list_event_types` | `integration:view` | — |
| `get_outbound_integration` | `integration:view` | — |
| `create_outbound_integration` | `integration:create` | ✓ |
| `update_outbound_integration` | `integration:edit` | ✓ |
| `delete_outbound_integration` | `integration:delete` | ✓ (irreversible) |
| `duplicate_outbound_integration` | `integration:create` | ✓ |
| `test_outbound_integration` | `integration:test` | ✓ (sends a real live delivery) |
| `validate_outbound_transformation` | `integration:test` | — (dry run, no side effects) |

### Inbound integrations (webhook receivers)

| Tool | Permission (intended) | Mutates |
|------|-----------|---------|
| `list_inbound_integrations` | `integration:view` | — |
| `get_inbound_integration` | `integration:view` | — |
| `create_inbound_integration` | `integration:create` | ✓ |
| `update_inbound_integration` | `integration:edit` | ✓ |
| `delete_inbound_integration` | `integration:delete` | ✓ (irreversible) |
| `test_inbound_integration` | `integration:test` | ✓ (real call/message send) |

### Scheduled jobs

| Tool | Permission | Mutates |
|------|-----------|---------|
| `list_scheduled_jobs` | `scheduled:view` | — |
| `get_scheduled_job` | `scheduled:view` | — |
| `create_scheduled_job` | `scheduled:create` | ✓ |
| `update_scheduled_job` | `scheduled:edit` | ✓ |
| `delete_scheduled_job` | `scheduled:delete` | ✓ (irreversible) |
| `execute_scheduled_job` | `scheduled:execute` | ✓ (out-of-schedule run) |
| `test_scheduled_job_datasource` | `scheduled:create` | — (dry run, no side effects) |
| `list_scheduled_job_logs` | `scheduled:view` | — |
| `get_scheduled_job_log` | `scheduled:view` | — |

### Credentials

| Tool | Permission | Mutates |
|------|-----------|---------|
| `list_credentials` | `ops:read` | — |
| `create_credential_placeholder` | `credentials:manage` | ✓ |
| `set_credential_value` | `credentials:manage` (SUPER_ADMIN) | ✓ |
| `test_credential` | `credentials:manage` | ✓ (checks field completeness, no live call) |

### Issue reporting (GitHub)

| Tool | Permission | Mutates |
|------|-----------|---------|
| `report_issue` | none (GitHub-scoped, not ICP) | ✓ (creates/comments on a GitHub issue) |
| `request_feature` | none (GitHub-scoped, not ICP) | ✓ (creates/comments on a GitHub issue) |

These two don't call the Integration Gateway API at all — they call the GitHub REST API
directly to file (or update) an issue in this repo. `report_issue` is for something
genuinely broken (a real bug, not a transient/self-recovering error like an isolated
503) — the calling agent is expected to use judgment before filing, not fire on every
error automatically. `request_feature` is for "the user asked for something this MCP
server / the backend API can't do yet."

Both dedupe: a hidden marker hashed from `dedupKey` (or `title` if `dedupKey` is omitted)
is embedded in the issue body, and if an open issue with that marker already exists, the
tool adds a "recurred again" comment instead of creating a duplicate issue. This means a
recurring problem accumulates comments on one issue rather than spamming the repo.

Requires `GITHUB_TOKEN` (a token with `repo` scope, or fine-grained Issues: Read & Write on
this repo) and `GITHUB_REPO` (`"owner/repo"`, e.g.
`"varaprasadreddy9676/integration-control-plane-oss"`) in the MCP server's environment. Without
them, both tools return `{ filed: false, reason: "..." }` instead of throwing — safe to
leave unset if you don't want this capability.

⚠️ **Important gap:** `outbound-integrations` and `inbound-integrations` backend routes
currently enforce only authentication, **not** the `integration:*` permission checks shown
above — any authenticated API key can create/edit/delete integrations today regardless of
its assigned permissions. The "Permission (intended)" column reflects the RBAC scope
defined in `backend/src/rbac/permissions.js`, not an enforced guarantee. Flag this to the
backend team if per-role write restrictions matter for your deployment — until it's fixed,
treat the API key issued to this MCP server as equivalent to a full write credential.

Every response includes `_env` (validation / production) so you always know which
environment produced it. Mutations on `ops:*` and `scheduled:*`/`credentials:*` routes
require a `reason` string ≥ 5 chars, written to the audit log. Outbound/inbound integration
CRUD does not currently accept/require a `reason` field (the backend routes don't consume
one) — the MCP-level `X-MCP-Client` header still tags these calls for `check_audit_trail`.

⚠️ **`orgId` is always required and always goes in the query string, even for
POST/PUT/DELETE calls.** The backend's API-key auth middleware resolves org scope
*exclusively* from `req.query.orgId` — never from the JSON body. `ops.js` and
`credentials.js` routes have their own fallback (`req.query.orgId || req.body?.orgId ||
req.orgId`) so they tolerate `orgId` living in the body, but `outbound-integrations.js`,
`integrations.js` (inbound), and `scheduled-jobs.js` do not — they read `req.orgId`
directly. This MCP server's client (`api-client.js`) already handles the split
correctly (every outbound/inbound/scheduled-job tool schema requires `orgId` and the
client puts it on the query string regardless of HTTP method), so as an MCP tool caller
you don't need to think about this — just always pass `orgId`. It's documented here so
a future maintainer doesn't "simplify" that query/body split back into a single object
and silently reintroduce orgId=undefined on every write.

---

## Quick Setup

### 1. Install

You need **Node.js 18 or newer** (`node -v`). Download the package from the console
(**Settings → API Keys → Download MCP Server**), unzip it, and install its dependencies:

```bash
cd icp-mcp-server
npm install
```

Skipping `npm install` is the most common setup failure: the server exits on start with
`Cannot find package '@modelcontextprotocol/sdk'`, and your AI client only says it
couldn't connect.

### 2. Create an API key

In the console, go to **Settings → API Keys → Create API key**. The key authenticates as
you: same role, same organization. A key for an org-bound user only works for that org;
asking about another org returns `403`. The dialog that shows the key also shows a
ready-to-paste config with the right base URL; copy it before closing, the key is shown
once.

### 3. Add it to your MCP client

Use the absolute path to `src/index.js` inside the folder you unzipped. Put the real key
in the config: `${VAR}` placeholders are passed through literally by most clients and
fail with `401`.

**Claude Code**

```bash
claude mcp add integration-gateway \
  -e ICP_ENV=production \
  -e ICP_API_BASE_URL=https://gateway.example.com/integration-gateway-server/api/v1 \
  -e ICP_API_KEY=mdcs_pat_... \
  -- node /absolute/path/to/icp-mcp-server/src/index.js
```

**Claude Desktop, Cursor, or a project `.mcp.json`** (Claude Desktop:
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows; on Windows write the path
with forward slashes or doubled backslashes)

```json
{
  "mcpServers": {
    "integration-gateway": {
      "command": "node",
      "args": ["/absolute/path/to/icp-mcp-server/src/index.js"],
      "env": {
        "ICP_ENV": "production",
        "ICP_API_BASE_URL": "https://gateway.example.com/integration-gateway-server/api/v1",
        "ICP_API_KEY": "mdcs_pat_..."
      }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.integration-gateway]
command = "node"
args = ["/absolute/path/to/icp-mcp-server/src/index.js"]
env = { ICP_ENV = "production", ICP_API_BASE_URL = "https://gateway.example.com/integration-gateway-server/api/v1", ICP_API_KEY = "mdcs_pat_..." }
```

The base URL must end in `/integration-gateway-server/api/v1`. The console's own address
(`/integration-gateway/...`) serves the web app's HTML, and every call fails with
"Backend returned non-JSON response". Restart the client after changing its config.

Optional: `GITHUB_TOKEN` and `GITHUB_REPO` let `report_issue` and `request_feature` file
GitHub issues; without them those two tools return `filed: false`.

### 4. Check the connection

From the unzipped folder, with the same values:

```bash
ICP_ENV=production \
ICP_API_BASE_URL=https://gateway.example.com/integration-gateway-server/api/v1 \
ICP_API_KEY=mdcs_pat_... \
npm run doctor
```

It prints `"ok": true` when the gateway is reachable **and** accepted the key, and exits
non-zero otherwise, with the reason in `auth.message`. In a chat, ask the agent to run
`gateway_health`: its `auth.ok` field says the same thing.

Instead of environment variables you can keep the settings in a JSON file (see
`config.example.json`) and pass `--config /path/file.json` or set `ICP_CONFIG_FILE`. Keep
that file private; it contains a credential.

### Other ways to authenticate

- **The deployment's shared API key** (`API_KEY` in the backend's `.env`) works the same way
  in `ICP_API_KEY`. It maps to the limited `API_KEY` role, so scheduled-job and credential
  tools return `403` with it.
- **A login token** (`ICP_AUTH_TOKEN`, sent as `Authorization: Bearer`): from
  `POST /api/v1/auth/login`. It expires, so prefer a personal API key.

---

## Operations Runbook

### "Why is org X failing deliveries?"

```
1. diagnose_org(orgId=X, hours=24)
   → Check failures.total, dlq.count, eventAudit.gapCount

2. If failures > 0:
   list_integrations(orgId=X, isActive=true)
   → Note integration IDs with failures

3. get_integration_status(orgId=X, integrationId=<id>)
   → Check circuit.state — OPEN means the breaker tripped

4. search_delivery_logs(orgId=X, status=FAILED, limit=5)
   → Read error messages in the last few failures

5. get_execution_trace(orgId=X, logId=<failedLogId>)
   → See full request/response/retry chain
```

### "Reset a tripped circuit breaker"

```
Prerequisite: confirm the upstream issue is resolved (check logs / ops team).

1. get_integration_status(orgId=X, integrationId=<id>)
   → Confirm circuit.state = OPEN

2. reset_circuit_breaker(
     orgId=X,
     integrationId=<id>,
     reason="Upstream resolved at 14:05 per ops ticket #123"
   )
   → circuit moves to CLOSED

3. run_integration_test(
     orgId=X,
     integrationId=<id>,
     type=INTEGRATION_HEALTH,
     reason="Verify health post circuit reset"
   )
   → All steps should be PASSED

4. check_audit_trail(orgId=X, toolName=reset_circuit_breaker, days=1)
   → Confirm reset is recorded
```

### "Replay failed deliveries after a fix"

```
1. search_delivery_logs(orgId=X, status=FAILED, integrationConfigId=<id>, limit=20)
   → Collect log IDs to replay

2. For each logId:
   replay_delivery(
     orgId=X,
     logId=<id>,
     reason="Replaying after circuit reset — upstream confirmed healthy"
   )

3. search_delivery_logs(orgId=X, status=DELIVERED, integrationConfigId=<id>)
   → Confirm deliveries now succeeded
```

### "Test integration after credential update"

```
1. list_credentials(orgId=X, status=PROVIDED)
   → Confirm credentials are in PROVIDED state

2. run_integration_test(
     orgId=X,
     integrationId=<id>,
     type=INTEGRATION_HEALTH,
     reason="Verify integration works with new credentials"
   )

3. If steps include transformer:
   run_integration_test(
     orgId=X,
     integrationId=<id>,
     type=TRANSFORM,
     payload={"patientRid": 100, "orgId": X},
     reason="Test transformer with sample payload"
   )
```

### "Check what happened to org X in the last hour"

```
1. diagnose_org(orgId=X, hours=1)

2. check_audit_trail(orgId=X, days=1)
   → See all ops actions taken — who, what tool, what reason, when
```

### "Set up credentials for a new integration"

```
1. list_credentials(orgId=X, status=PENDING)
   → Find placeholder IDs that need values

2. set_credential_value(
     orgId=X,
     placeholderId=<id>,
     values={"apiKey": "...", "secret": "..."},
     reason="Initial credential provisioning for org X integration"
   )
   ⚠️  Do not log or display the values field

3. test_credential(
     orgId=X,
     placeholderId=<id>,
     reason="Verify credentials are complete"
   )
   → status should be PROVIDED or TESTED
```

---

## Configuration Runbook

These are the flows that used to require the admin web UI. All of them are now doable
end to end via MCP tools.

### "Create a new outbound integration (event rule)"

```
1. list_event_types()
   → Confirm the eventType you want exists

2. (optional) If using a custom transformation script:
   validate_outbound_transformation(script="...", samplePayload={...})
   → Iterate until result.output looks right — this never saves or sends anything

3. create_outbound_integration(
     orgId=X,
     name="Lab Result Webhook",
     eventType="LAB_RESULT_READY",
     targetUrl="https://partner.example.com/webhook",
     httpMethod="POST",
     scope="ENTITY_ONLY",
     outgoingAuthType="API_KEY",
     outgoingAuthConfig={"headerName": "X-API-Key", "value": "..."},
     timeoutMs=10000,
     retryCount=3
   )
   → Note the returned id

4. test_outbound_integration(orgId=X, integrationId=<id>)
   ⚠️  This sends a REAL live delivery, unlike step 2's dry run
   → Confirm status: 'success'

5. check_audit_trail(orgId=X, toolName="create_outbound_integration")
   → Confirm the change is recorded
```

### "Set up a new inbound webhook receiver"

```
1. create_inbound_integration(
     orgId=X,
     name="Partner Order Webhook",
     type="partner-orders",           # becomes part of the webhook URL — must be unique per org
     targetUrl="https://internal.example.com/process",
     inboundAuthType="HMAC",
     inboundAuthConfig={"secret": "..."}
   )
   → Response only returns { id, message } — call get_inbound_integration next to see the full doc

2. get_inbound_integration(orgId=X, integrationId=<id>)
   → Confirm configuration saved correctly

3. test_inbound_integration(orgId=X, integrationId=<id>, payload={"orderId": "test-123"})
   ⚠️  Sends a real test payload through the configured transformation/routing
```

### "Create a scheduled job"

```
For a script job (runs custom code on a schedule):
  create_scheduled_job(
    orgId=X,
    name="Daily Cleanup",
    direction="SCRIPT_JOB",
    schedule={"type": "CRON", "expression": "0 2 * * *"},
    script="/* job code */",
    environmentVariables=[{"key": "API_TOKEN", "value": "..."}]
  )

For a data-source job (polls a source, pushes to a target on a schedule):
  1. test_scheduled_job_datasource(orgId=X, dataSource={"type": "MYSQL", ...})
     → Dry-run first — confirms records are fetched before committing to a schedule
  2. create_scheduled_job(
       orgId=X,
       name="Hourly Sync",
       schedule={"type": "INTERVAL", "intervalMs": 3600000},
       dataSource={"type": "MYSQL", ...},
       targetUrl="https://internal.example.com/ingest"
     )

Either way, then:
  execute_scheduled_job(orgId=X, jobId=<id>, reason="Verify first run works before waiting for the schedule")
```

### "Edit an existing integration's retry policy"

```
1. get_outbound_integration(orgId=X, integrationId=<id>)
   → Read current retryCount/timeoutMs

2. update_outbound_integration(orgId=X, integrationId=<id>, retryCount=5, timeoutMs=15000)
   → Partial update — only send the fields you're changing

3. check_audit_trail(orgId=X, toolName="update_outbound_integration", days=1)
```

---

## Permission Reference

| Role | Permissions |
|------|------------|
| `VIEWER` | `ops:read` (read-only tools only) |
| `ORG_ADMIN` | `ops:read`, `ops:test`, `ops:replay`, `ops:circuit_reset` |
| `SUPER_ADMIN` | All above + `ops:credentials` |
| `API_KEY` (system) | `integration:view`, `system:health` |

Use a `SUPER_ADMIN`-role API key when running the MCP server against production.

**Confirmed live (2026-07-14):** the generic system `API_KEY` role does not have `scheduled:*`
permissions, so `list_scheduled_jobs`/`create_scheduled_job`/etc. return a clean `403
Forbidden` with that key — this is correct RBAC enforcement (`scheduled-jobs.js` is one of the
two routers that actually checks permissions, see the gap note above), not a bug. Outbound and
inbound integration CRUD worked end-to-end with the same key precisely because those two
routers don't enforce RBAC at all yet. If you need the scheduled-job tools, use a JWT or API
key with an `ORG_ADMIN`/`SUPER_ADMIN`-equivalent role that's actually been granted
`scheduled:view`/`scheduled:create`/`scheduled:edit`/`scheduled:delete`/`scheduled:execute`.

---

## Environment Safety

Every tool result includes:
```json
{
  "_env": "production",
  "_baseUrl": "https://gateway.example.com/integration-gateway-server/api/v1",
  ...actualData
}
```

Before confirming any mutation, verify `_env` matches the intended environment.
The MCP client names also reflect the environment: **icp-validation** vs **icp-production**.

---

## Reliability & robustness

- **Request timeout.** Every call aborts after `ICP_REQUEST_TIMEOUT_MS` (default `30000`) rather
  than hanging the tool call — and the agent — indefinitely if the backend never responds. On
  timeout the error is tagged `status: 'TIMEOUT'` with a clear message.
- **Bounded retry on transient failures.** Read-only (`GET`) tools automatically retry up to
  `ICP_MAX_RETRIES` times (default `2`, exponential backoff starting at 250ms) on a timeout, a
  network error, `408`, `429`, or a `5xx` response. `Retry-After` is honored up to 30 seconds.
  **Mutations (`POST`) are never retried automatically** — a
  retried mutation could double-apply a side effect (e.g. replaying a delivery twice), so a failed
  mutation always surfaces immediately for the caller to decide.
- **Malformed responses don't crash the tool.** If the backend (or a proxy in front of it) ever
  returns non-JSON — an HTML error page from a 502, for example — the error message says so
  explicitly instead of leaking a raw `SyntaxError`.
- **Secrets are never echoed back, even in errors.** If the backend's error response for a failed
  `set_credential_value` call ever includes the submitted request body (some APIs do this for
  debugging), any `values`/`secret`/`password`/`token`/`apiKey`/`authorization` field is redacted before the response
  reaches the MCP client — so a credential value can never leak into an agent's context via an
  error path.
- **Startup fails loudly, not silently.** Invalid environment, URL, authentication, timeout, or
  retry configuration stops startup with a clear `stderr` error rather than silently starting
  unauthenticated or pointed at the wrong host.
- **MCP-native failures.** Failed tool calls set `isError: true`, preserve a structured result,
  and include a request ID when available, so clients do not mistake an error payload for success.
- **Request correlation.** Every HTTP call sends an `X-Request-Id` that can be matched against
  gateway logs and support investigations.
- **Every call is logged to stderr** (tool name, duration, outcome) — `[icp-mcp] diagnose_org ok
  (142ms)` — for local operational visibility. This never touches stdout, which is the actual MCP
  protocol channel.

Configuration:

| Env var | Default | Purpose |
|---|---|---|
| `ICP_REQUEST_TIMEOUT_MS` | `30000` | Abort a request after this many ms |
| `ICP_MAX_RETRIES` | `2` | Max retry attempts for idempotent (`GET`) requests on transient failures |
| `ICP_CONFIG_FILE` | unset | Optional JSON config file; `--config /path/file.json` also works |
| `ICP_ALLOW_ANONYMOUS` | `false` | Explicit local-development escape hatch; never enable for production |

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| Client says it couldn't connect, or the server shows as failed | Dependencies not installed (`Cannot find package '@modelcontextprotocol/sdk'`), Node older than 18, or a wrong path in `args` | Run `npm install` in the unzipped folder, check `node -v`, and use the absolute path to `src/index.js` (Quick Setup steps 1 and 3) |
| `401 Invalid API key` on every single call | The key was revoked or mistyped, or the config used `${VAR}` interpolation, which most MCP clients don't expand | Put the real key value in the config; `npm run doctor` shows whether the gateway accepts it (Quick Setup step 4) |
| `401 Unauthorized` (no key at all) | `ICP_API_KEY`/`ICP_AUTH_TOKEN` genuinely not set | Check the `env` block in `.mcp.json` has a value, not a placeholder |
| `403 Forbidden` on scheduled-job or credential tools | The shared system API key doesn't have `scheduled:*` or `credentials:*` permissions (correct RBAC, not a bug) | Use a personal API key (Quick Setup step 2) |
| `403 You do not have access to this organization` | Your key belongs to a user bound to a different org | Ask about your own org, or use a key from a user with access to that org |
| `"reason is required"` | Mutation called without reason | Add `reason: "..."` (min 5 chars) |
| `"A valid orgId is required"` | orgId missing or not a number | Pass `orgId` as integer — required on every single tool that touches org-scoped data, see the ⚠️ note above the tool tables |
| `"Integration does not belong to this organization"` | Wrong orgId for integration | Use list_integrations to find correct orgId |
| Getting back HTML instead of JSON / `"Backend returned non-JSON response"` immediately | `ICP_API_BASE_URL` points at `/integration-gateway/...` or `/event-gateway/...` instead of `/integration-gateway-server/api/v1` | Fix the base URL (Quick Setup step 3) |
| Server not listed in Claude | `.mcp.json` not found, or malformed JSON (often unescaped backslashes in a Windows path) | Validate the JSON, use forward slashes in paths, and restart the client |
| `status: 'TIMEOUT'` | Backend didn't respond within `ICP_REQUEST_TIMEOUT_MS` | Check backend health directly; raise the timeout only if the operation is genuinely slow, not to mask a hang |
