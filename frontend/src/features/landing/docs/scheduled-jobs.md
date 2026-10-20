# Scheduled Jobs & Script Jobs

Recurring jobs that run on a CRON expression or a fixed interval. Two kinds share the same scheduler, UI, and execution history:

- **Data-source jobs** — query MySQL, MongoDB, or an HTTP API on a schedule, transform the rows, and deliver them to a target URL.
- **Script Jobs** — run your own JavaScript on a schedule, with no data source required. Full automation scripts: sync jobs, cleanup tasks, report generators, monitors.

This is different from [Delayed Deliveries](/docs/scheduled-automation), where a normal outbound *event* is transformed now and delivered later.

---

## Scheduling

| Mode | Config |
|------|--------|
| CRON | Standard 5-field expression, with a visual builder in the UI |
| Interval | Fixed `intervalMs`, minimum **60,000 ms (1 minute)** |

Jobs can be paused and resumed without losing configuration, and executed **on demand** ("Run now") outside their schedule — each manual run requires a reason that lands in the audit log.

---

## Data-Source Jobs

1. Configure a source: MySQL query, MongoDB query, or HTTP API call.
2. Optionally transform the fetched records (same mapping/script engine as integrations).
3. Deliver the result to a target URL.

**Dry-run before saving:** the *Test Data Source* action runs the source config live (30s timeout) without creating anything, returning up to 10 sample records so you can verify the query shape first.

---

## Script Jobs

A Script Job is just code on a schedule. Two runtimes:

| Runtime | Behavior |
|---------|----------|
| Sandboxed VM | Script runs in a secure in-process VM, async allowed, 120s timeout |
| **Node.js Process** (default for new jobs) | Script runs as a real child process — full Node API, and **npm dependencies** declared per job are installed and cached automatically |

**Environment variables:** up to 100 per job, stored server-side and injected at run time — keep credentials out of the script body. Saved values are write-only in the UI for most roles; only a Super Admin can reveal them.

**Automatic retry (opt-in):** off by default. Enable `retryOnFailure` with `maxAttempts` and a delay between attempts for jobs that hit flaky upstreams. Every attempt is recorded in the execution history.

---

## Execution & Observability

- Every run — scheduled or manual — produces a full execution record: logs, duration, outcome, and attempt count.
- `console.log` / `console.error` output from scripts is captured into the run's log stream.
- Failed runs surface in the job list with their last execution status, so a silently-failing nightly job is visible the next morning.

---

## Permissions

| Permission | Grants |
|-----------|--------|
| `scheduled:view` | See jobs and execution history |
| `scheduled:create` | Create jobs, dry-run data sources |
| `scheduled:edit` | Modify existing jobs |
| `scheduled:delete` | Delete jobs |
| `scheduled:execute` | Trigger out-of-schedule runs |
