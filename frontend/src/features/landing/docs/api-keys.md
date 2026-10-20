# API Keys & Programmatic Access

Personal access tokens for scripts, CI pipelines, and MCP clients — created self-service from the UI, shown once, revocable at any time. A key authenticates as **you**: same role, same org access, same audit identity.

---

## How It Works

1. Go to **Administration → API Keys** (or **Team → API Keys** as an org admin).
2. Click **Create API Key**, give it a name that identifies where it will live ("CI pipeline", "MCP server", "laptop script").
3. The raw key — `mdcs_pat_` followed by 48 hex characters — is shown **exactly once**. Copy it immediately.
4. Use it in the `X-API-Key` header on any API call.

```bash
curl -H "x-api-key: mdcs_pat_..." \
  "https://<gateway-host>/integration-gateway-server/api/v1/outbound-integrations/event-types?orgId=<orgId>"
```

The same creation dialog also shows a ready-to-paste `.mcp.json` snippet with the key pre-filled — see the [MCP Server](/docs/mcp-server) doc.

---

## Security Model

| Property | Behavior |
|----------|----------|
| Storage | Only a SHA-256 hash is stored — the raw key is never retrievable after creation |
| Identity | The key authenticates as the user who created it (same role and org) |
| List view | Shows only a display prefix (`mdcs_pat_ab12cd34…`) for identification |
| Last used | Tracked automatically on every authenticated request |
| Audit | Creation, revocation, and deletion are all written to the audit log |

If you lose a key, there is no recovery — revoke it and create a new one.

---

## Revoke vs. Permanently Delete

**Revoke** is a soft delete: the key stops authenticating immediately, but the row stays in the list (marked *Revoked*) for audit visibility.

**Permanently delete** removes the record entirely. It is only available for keys that have **already been revoked** — so there is always an audit trail of the revocation before the record disappears. Both actions sit in the Actions column and require confirmation.

Anything using a revoked key gets `401 Invalid API key` on its next request — revocation takes effect immediately, with no caching window.

---

## Permissions

| Permission | Grants |
|-----------|--------|
| `api_keys:view` | See the org's key list (prefixes only) |
| `api_keys:create` | Create new keys |
| `api_keys:revoke` | Revoke and permanently delete keys |

Org admins hold all three within their own org. A key inherits the **full role of its creator** — a key created by a `SUPER_ADMIN` carries super-admin rights, so prefer creating keys from the least-privileged account that can do the job.

---

## Legacy System Key

Deployments also have a single static system key (configured server-side as `API_KEY`). It still works unchanged for service-to-service calls and maps to a generic `API_KEY` role. Personal access tokens are the recommended path for anything user-attributable: they are individually revocable, tracked per user, and show up in the audit log with a real identity.
