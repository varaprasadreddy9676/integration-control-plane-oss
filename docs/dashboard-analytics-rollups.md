# Dashboard analytics rollups

The dashboard reads the same execution-log data as before, but wide unfiltered
date ranges can use a MongoDB-backed hourly materialization. This avoids making
the request path group hundreds of thousands of raw execution logs.

## Correctness model

- Rollups are grouped by UTC hour and include summary, event type, integration,
  error, and response-time bucket metrics.
- A request uses rollups only for unfiltered ranges of seven days or more.
- The first and last partial hours are still aggregated from `execution_logs`,
  so date ranges such as `18:30` to `18:29` do not over-count adjacent hours.
- Direction, trigger type, and integration filters continue to use the raw
  aggregation path until filter-specific rollups are added.
- If an org has no complete rollup coverage, or a refresh is in progress, the
  existing raw path is used automatically.

## Rollout

The worker is disabled unless explicitly enabled:

```bash
DASHBOARD_ANALYTICS_ROLLUPS_ENABLED=true
```

Defaults:

- `DASHBOARD_ANALYTICS_ROLLUP_LOOKBACK_DAYS=100`
- `DASHBOARD_ANALYTICS_ROLLUP_REFRESH_HOURS=48`
- `DASHBOARD_ANALYTICS_ROLLUP_INTERVAL_MS=300000`
- `DASHBOARD_ANALYTICS_ROLLUP_ORGS=100,200` (optional staged rollout; unset means every org)

For a controlled initial build, run from the backend directory:

```bash
node src/scripts/backfill-dashboard-analytics-rollups.js --orgId=100 --days=100 --bucket=both
```

Omit `--orgId` to process every org. Run the backfill before enabling the
worker when a fast first dashboard request is required. The worker then
refreshes the recent window and preserves the older completed buckets.

## Operational safety

Rollup metadata records coverage, refresh state, last build time, document
count, and the last error. Refreshes use a MongoDB lock so two application
instances do not rebuild the same org simultaneously. A failed refresh leaves
the previous completed data available, while `refreshInProgress` makes the API
fall back to raw aggregation for that org until the next successful build.
