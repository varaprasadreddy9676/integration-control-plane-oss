# Credential leak audit

Checks that no API response gives back a stored credential.

`audit.mjs` plants a uniquely tagged secret in every credential slot the
gateway stores, makes the gateway use them, then calls every GET route and
reports each response field that still contains one:

1. **Plant.** Creates outbound integrations (bearer, API key, basic, OAuth2,
   custom headers, a key in the URL, credential custom headers, a Slack webhook
   URL), inbound integrations (API key, HMAC, each with outgoing auth),
   scheduled jobs (API and SQL data sources with header, URL and connection
   string credentials; a script job with an environment variable), alert
   channels and a template.
2. **Use.** Pushes events, calls the inbound endpoints (with a right and a
   wrong key) and runs the jobs, so delivery logs, execution traces, the DLQ,
   the Alert Center and the system log all hold data.
3. **Crawl.** Reads every GET route from `backend/src/index.js` and the route
   files, calls the fixed routes first, then fills `:id`-style parameters with
   ids seen in earlier responses.

Two kinds of route are skipped. `/credentials` and `/reveal` routes exist to
show a super admin the stored values, and every use is audited. Streaming
routes and file downloads are skipped too. Password hashes in any response are
reported as well.

## Run

Use a disposable install only: the audit adds records and never removes them.
Unless `ORG_ID` is set it creates a new organization for each run (this needs
a super admin) and turns on its HTTP push event source.

CI runs it on every push and pull request (the `leak-audit` job in
`.github/workflows/ci.yml`), against a fresh `docker compose` install.

```bash
docker compose up -d --build                      # a fresh install
API_RATE_LIMIT_ENABLED=false docker compose up -d backend   # optional: no 429 waits
node tools/leak-audit/audit.mjs
```

| Variable | Default |
|----------|---------|
| `API_URL` | `http://localhost:3545/api/v1` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@example.com` / `ChangeMe123!` |
| `ORG_ID` | none: a new organization is created |
| `TARGET_BASE` | `https://httpbin.org` (deliveries go to `/status/200` and `/json`) |
| `SETTLE_MS` | `20000` (wait for deliveries and jobs before crawling) |

The exit code is 0 when nothing leaked and 1 otherwise. Each finding names the
route and the JSON path, for example:

```
/scheduled-jobs/:id/logs  $[].httpRequest.url
    …https://api.example.com/x?api_key=LEAKEDAUDIT…_SJ_URLKEY…
```

Delivery targets must not echo the request back. If they do, every echoed
header shows up in a stored response body and looks like a leak; that is why
the defaults use `httpbin.org/status/200` rather than `/anything`.

To see what an organization admin sees, run it again with that user's
`ADMIN_EMAIL` and `ADMIN_PASSWORD`.
