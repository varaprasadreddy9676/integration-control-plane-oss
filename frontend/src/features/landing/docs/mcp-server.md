# MCP Server — AI-Operated Gateway

The gateway ships with an MCP (Model Context Protocol) server that lets AI agents — Claude Code, Codex, Cursor, or any MCP client — operate the platform conversationally. Ask *"why is org 892 failing deliveries?"* and the agent diagnoses the org, checks circuit breakers, and pulls failing traces. Ask it to create an integration and it builds, tests, and audits one.

---

## What It Can Do

**40 tools** across six areas, plus two MCP resources and two workflow prompts:

| Area | Capabilities |
|------|--------------|
| Diagnostics | Org health summaries, integration status, delivery log search, full execution traces |
| Recovery | Reset circuit breakers, replay failed deliveries, run live integration tests |
| Outbound integrations | Full create / read / update / delete / duplicate / test, plus dry-run transformation validation |
| Inbound integrations | Full CRUD and live endpoint testing |
| Scheduled jobs | Full CRUD, out-of-schedule execution, dry-run data-source tests |
| Credentials & audit | Credential placeholder provisioning (values write-only), complete audit trail queries |
| Connection & safety | Gateway health check, bounded retries, request IDs, structured errors, and environment labels |

It can also file GitHub issues on its own judgment: `report_issue` for confirmed bugs and `request_feature` when a user asks for something the toolset can't do yet — both deduplicate against already-open issues.

---

## Getting It

Click **Download MCP Server** on the **API Keys** page. You get a small zip (`icp-mcp-server.zip`) containing the server source — no secrets inside, ever. Unzip it anywhere, run `npm install` inside it once (Node 18+).

When you create an API key, the creation dialog shows a ready-to-paste config with that key pre-filled:

```json
{
  "mcpServers": {
    "integration-gateway": {
      "command": "node",
      "args": ["/path/to/icp-mcp-server/src/index.js"],
      "env": {
        "ICP_ENV": "production",
        "ICP_API_BASE_URL": "https://<gateway-host>/integration-gateway-server/api/v1",
        "ICP_API_KEY": "mdcs_pat_..."
      }
    }
  }
}
```

Drop that into `.mcp.json` (Claude Code), `config.toml` (Codex), or your client's MCP settings, restart the client, and ask it to *"list event types"* as a first smoke test.

Before connecting a desktop client, run the downloaded package's connection doctor:

```bash
ICP_CONFIG_FILE=/private/path/icp-config.json npm run doctor
```

The package includes `config.example.json` as a safe template. It also accepts
`--config /private/path/icp-config.json` in the MCP command arguments for clients that
cannot conveniently populate environment variables. Keep the config file private because
it contains an API credential.

Clients that support MCP-native context can read `icp://docs/quickstart` and
`icp://docs/safety`, or start with the `incident_triage` and `integration_change_review`
prompts.

---

## Safety Rails

| Rail | Behavior |
|------|----------|
| Environment tagging | Every response carries `_env: "validation"` or `"production"` — you always know which system you just touched |
| Audit reasons | Mutating ops tools require a `reason` string, written to the audit log |
| Client tagging | All calls carry an `X-MCP-Client` header so MCP activity is filterable in the audit trail |
| Secret redaction | Credential values are write-only; the client redacts secrets even from echoed error payloads |
| No mutation retries | Only idempotent reads retry on transient failures — a mutation never silently double-fires |
| Timeouts | Every request is bounded; a hung backend can't hang your agent |
| MCP error semantics | Failed calls set `isError: true`, include structured details, and preserve a request ID when available |
| Request correlation | Every HTTP call carries `X-Request-Id` for matching gateway logs |

---

## Typical Workflows

**Incident triage:**
```
diagnose_org → get_integration_status → search_delivery_logs → get_execution_trace
```

**Recovery after an upstream fix:**
```
reset_circuit_breaker (with reason) → run_integration_test → replay_delivery
```

**Config work, end to end:**
```
list_event_types → validate_outbound_transformation (dry run)
→ create_outbound_integration → test_outbound_integration → check_audit_trail
```

The full tool reference, permission matrix, and runbooks live in the `README.md` inside the downloaded package.
