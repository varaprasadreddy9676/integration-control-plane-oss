# Credentials, encryption and recovery

How integration credentials are protected, where the encryption key lives, and how to get back
from each kind of loss. Short on purpose — read it once before you need it.

## How credentials are protected

- **Masked in the API and UI.** Passwords, API keys, OAuth secrets, token-request bodies, HMAC
  secrets, SMTP passwords and cached tokens come back as `********`. Saving a form that still shows
  `********` keeps the stored value. Webhook *signing* secrets stay visible — they exist to be copied
  to the receiving partner.
- **Super admins can see them.** "Reveal credentials" on an integration's detail page fills in the
  stored values. Every reveal is recorded in the audit log (`integration_credentials_revealed`).
- **Encrypted in the database.** Those fields are stored AES-256-GCM encrypted (`enc:v1:…`) in
  `integration_configs`, with the same key that encrypts gateway secrets. The app decrypts them for
  deliveries automatically (`backend/src/utils/secrets-at-rest.js`).

## The key

Each server has its **own** key, `GATEWAY_SECRET_KEY` (64 hex characters). It is kept in three places:

| Where | Validation | Production |
|---|---|---|
| The env file the app reads | `<app-root>/.env` | `<app-root>/backend/.env` |
| Root-only copy on the server | `/root/gateway-secret-key.validation` | `/root/gateway-secret-key.production` |
| **Your password manager** | "Integration Gateway: validation GATEWAY_SECRET_KEY" | "Integration Gateway: production GATEWAY_SECRET_KEY" |

The password-manager copy is the one that survives losing the server. Store the full env file
there too (it also holds `MONGODB_URI`, `API_KEY`, `JWT_SECRET`).

`GATEWAY_SECRET_KEY_REQUIRED=true` is set, so if the key goes missing the app **refuses to start**
with a clear error rather than running and failing every delivery.

Never keep the key next to database backups — whoever has both has every credential.

## Getting back

| What happened | What still works | How to get back |
|---|---|---|
| **Env file lost or overwritten on the server** | Everything, once the key is back | Put `GATEWAY_SECRET_KEY` (and the rest of the env) back from the password manager or `/root/gateway-secret-key.<env>`, then restart. |
| **Key lost everywhere** | All configuration: integrations, mappings, scripts, lookups, users, jobs | Credentials cannot be decrypted without the key — that is the point of encryption. Set a new key, then re-enter the credentials: open each integration that shows an authentication type other than `NONE` (or an SMTP action) and type them again. Gateway secrets used by scheduled jobs need re-entering too. |
| **Server lost** | Nothing on that server | Restore the gateway database from backup onto the new server, restore the env file (including the key) from the password manager, then `scripts/deploy.sh <env> all`. **See the backup note below.** |
| **An integration deleted or broken by mistake** | Everything else | Use the integration's version history, or the before/after in the audit log, to recreate it. |
| **You want an extra copy of configurations** | — | Bulk Operations → **Export all**. It contains every setting but not the credentials (they are masked); after importing it, re-enter credentials. Do not trust credentials that came from an import. |

### Back up the gateway database

Make sure your MongoDB backups include the `integration_gateway` database: without it,
losing the server loses all integration setup. One `mongodump` of that database is enough.
The configuration is a few MB; the large collections are logs and can be excluded:

```
--excludeCollection=execution_logs --excludeCollection=event_audit --excludeCollection=delivery_attempts
--excludeCollection=processed_events --excludeCollection=error_logs
```

Backups hold credentials only in encrypted form; they are usable together with the key from the
password manager, which is why the two are stored apart.

## Changing things safely

- **Changing the Mongo password or host** is safe: the key no longer depends on `MONGODB_URI`.
- **Rotating the key:** stop the service, run
  `node -r ./src/config.js src/scripts/rotate-gateway-secret-key.js --to=<new key> --commit` from
  `backend/` (dry-run first without `--commit`; it verifies every value and backs up before
  writing), put the new key in the env file and the password manager, start the service.
- **Copying integrations between validation and production:** use export/import or the API, not a
  raw database copy — each server has a different key, so copied credentials would not decrypt.

## Running in Docker

`docker-compose.prod.yml` passes `GATEWAY_SECRET_KEY` to the backend and **refuses to start without
it**; `GATEWAY_SECRET_KEY_REQUIRED=true` makes the app refuse too. Put the key in `.env.prod` (not in
the image — `.dockerignore` excludes `.env` files).

When moving an existing server into Docker, use **that server's current key and database** — a new
key cannot read credentials encrypted with the old one. Everything else in this guide applies
unchanged: the key still lives in `.env.prod` plus the password manager, and the database still needs
backing up wherever MongoDB runs.

## Related safeguards

- **Event source down alerts.** If an org's event source keeps failing for 30 minutes, an
  "Event Source Down" entry appears in that org's Alert Center (and the server log), with a
  "Recovered" entry when it comes back.
- **Dropped collections don't break screens.** Queries that ask for an index which no longer
  exists retry without it and the indexes are recreated automatically.
