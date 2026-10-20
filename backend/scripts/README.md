# Backend scripts

Run these inside the backend container (`docker compose exec backend …`) or from `backend/` with the same environment as the server.

| Script | What it does |
| --- | --- |
| `create-user.js` | Create a user. Use `--role SUPER_ADMIN` for the first account; other roles need `--orgId`. |
| `populate-ui-config.js` | Reset the console's UI configuration to the defaults. The backend creates it automatically on first start. |
| `kafka-test-producer.js` | Publish sample events to Kafka when testing a Kafka event source. |
| `load-test/` | Baseline load tests for the inbound proxy. |

Maintenance scripts that ship with the server live in `src/scripts/`:

| Script | What it does |
| --- | --- |
| `ensure-mongodb-indexes.js` | Create or repair MongoDB indexes (`npm run db:ensure-indexes`). |
| `rotate-gateway-secret-key.js` | Generate a credential encryption key or move stored secrets to a new one. |
| `backfill-dashboard-analytics-rollups.js` | Rebuild dashboard analytics rollups for a date range. |
