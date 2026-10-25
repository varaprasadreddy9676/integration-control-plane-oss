# Pipeline stages

Status: design for a **single release**. Everything in scope ships together and the
legacy paths it replaces are removed; nothing is left for a later phase. Delivery
follow-up exists today as a one-off; here it is **not** special: it becomes an
ordinary stage that a user (or a template) creates and names like any other.

## The problem

Around a delivery the gateway does several things that are all the same shape:
run a small piece of logic, possibly call an HTTP API, and decide something.
Pre-delivery URL checks, the transform, the response transform, the scheduling
script and delivery follow-up are each a separate feature. Each has its own
config field, backend code, UI tab, and way of showing what happened (or none).
Every new one means new backend code **and** new UI. Follow-up checks already
record their HTTP calls and display them through `FollowUpChecks`; other paths
have different levels of tracing. The gap is a shared recording and viewing
contract, not a complete absence of request visibility.

The goal: adding "one more step that calls an API" is a configuration change
(or, at most, one backend module), never a UI change, and what it did is always
visible, with the cURL and the response, without anyone writing display code.

## Decisions (locked)

| Question | Decision | Why |
|----------|----------|-----|
| Inline hooks (`before_send`, `after_response`) | **In** | Leaving the hardest part for later is the "come back to it" case. Their runtime requirements are release blockers. |
| Pre-delivery URL checks | **Migrate** for single-delivery outbound integrations (both send paths: immediate in the delivery engine, delayed/recurring in `scheduler-worker`) to the `url-check` runner at `before_send` | One mechanism for those integrations. Multi-action actions keep `preDeliveryChecks` and the shared `checkBeforeDelivery` function. |
| Response transform | **Migrate** for single-delivery outbound integrations only, to an `after_response` stage under a compatibility contract (below) | Inbound runtime, DLQ inbound replay and multi-action delivery keep `applyResponseTransform`; for inbound it reshapes the reply to the caller, which is not a stage. |
| What gets removed | Only call sites whose integrations are migrated **and** verified (shadow runs, below), plus the follow-up-specific code and `delivery_follow_ups` | Excluded flows still use the shared functions; deletion follows proven coverage, not finished code. |
| Request transform, scheduling script | **Out, permanently** | They produce the payload and the schedule; they are not steps that observe or gate a delivery. |
| `on_failure` | **In** | Cheap once deferred stages exist. |
| Where stages live | **On each delivery**: an integration that sends once keeps them on itself; an integration with actions keeps them on each action (`actions[i].stages`, `actions[i].send`). Every kind of delivery is the same to stages: HTTP, email, SMS, WhatsApp, push and HL7 actions, of outbound integrations and of inbound email/SMS integrations. `stages/targets.js` is the one place that knows this. | Email or SMS is just another integration; nothing in stages is specific to a protocol. |
| What a stage sees of the send | **One shape for every delivery** (`stages/delivery-shape.js`): `delivery.request` is `{ protocol, target, method, body }`, `delivery.response` is `{ protocol, ok, status, code, message, providerMessageId, headers, body }` (`status` is the HTTP status, null otherwise; `code` the answer's own code: `200`, `SENT`, `AA`) | Each send path fills it from its own result; stages never branch on the kind of send. |
| Inbound proxy requests, scheduled jobs | **Out (product boundary)**; the API rejects stages there | A proxy request is answered while its caller waits and is never delivered later; a scheduled job is not a delivery. |
| Script runtime | **Separate OS processes** running as an unprivileged user, memory capped by the OS, network denied by the OS; code runs in a `vm` context inside them; `http` and `lookup` are calls to the parent, which enforces policy, credentials, recording, caps and cancellation | A worker thread is not a boundary on Node 14: `resourceLimits` cover only heap, stack and code space (not `ArrayBuffer`/external memory), and a `vm` escape reaches the worker's `process`. Only OS-enforced limits are a real boundary. |
| Legacy behavior | Migrated configurations run under **legacy contracts** that reproduce the old globals exactly, and switch ownership only after **shadow runs** match | Copying old scripts into the new `ctx` would change their behavior. |
| Passing data to the send | **Typed stage outputs + `{{ }}` bindings** in the Send step: message fields for every delivery (`send.bindings.fields`, dotted paths set on a copy of the message), headers and query only where the request has them (HTTP) | So a token fetched before sending reaches the target request. `before_send` runs after the request transform (gates must see the final request), so the body is the transform's; a transform that needs fetched data uses its own `http` helper. |
| Transactions | **Not assumed**: standalone MongoDB deployments (no replica set) have none | So every atomic step is a single-document write plus an idempotent repair worker. |
| Recorded bodies | **Full, capped, masked by declared sensitive paths**; stored only in `stage_runs` (30-day TTL), never on the delivery log; `errors-only` available per stage | Requests and responses stay visible without keeping personal data indefinitely. |

## Where it lives in the console

The integration page keeps its tabs (Basic Info, Authentication, Timing & Follow-up,
Reliability, Transformation, Response Transform...). After **Reliability** comes a
**Delivery** tab, and the stages live inside it:

```
Delivery
  Before send        [ + add a stage ]
    ├ <name the user chose>      script   on   [edit] [test]
    └ <another name>             http     on
  Send               the delivery itself (target, auth, retries: summarized,
                     links to the existing tabs; not a stage, always there)
  After the response [ + add a stage ]
    └ <name>                     script   on
  Later (scheduled)  [ + add a stage ]
    └ <name>                     script   on   checks: 30s, 5m, 1h, 24h
  On failure         [ + add a stage ]   (once the delivery has finally failed)
```

An integration with actions shows the same tab with an action picker: each action
is its own delivery with its own stages and Send step. Inbound email/SMS
integrations show the same tab for their one action. Inbound proxy integrations and
scheduled jobs do not have it.

- A stage is created by the user and **named whatever they want** ("Verify patient
  consent", "Ask Qikchat if delivered", "Notify partner"). The name titles its
  tab, result filter and analytics label. A stable stage ID identifies it in
  storage, queries and jobs; renaming never creates a new metric series. Duplicate
  names are disambiguated in the console by integration and stage ID.
- Nothing is built in or first. A new integration starts with no stages. A template
  (Qikchat) can pre-create one with a default name, and the user can rename, edit,
  disable or delete it like any other.
- The position (before send, after the response, later) is the hook; stages in a
  group run in the order shown, and can be reordered.

## The model: three separate ideas

A *stage* is the combination of a **hook** (when it runs), a **runner** (what
runs), and a **run record** (what happened). Keeping these separate is what makes
it scale: each can grow without touching the others.

### 1. Hooks: where in the lifecycle (fixed, small, owned by the engine)

| Hook | Runs | Can it change the delivery? |
|------|------|------------------------------|
| `before_send` | inline, in the delivery attempt | yes: `skip()`, `fail()`, `retry` |
| `after_response` | inline, right after the target answers | classify the response; delivery retry requires an explicit delivery policy |
| `after_delivery` | **deferred**, on a schedule, out of band | no: it observes (follow-up, notifications, reconciliation) |
| `on_failure` | deferred, once a delivery is finally failed or abandoned | no |

Each stage declares an `effect`: `gate` (may stop or fail the delivery) or
`observe` (may not). The engine enforces it, so a deferred stage can never
silently alter a delivery that already succeeded. Hooks are not user-defined:
a small closed set keeps the engine understandable. No DAG, no branching, no
loops: an ordered list per hook.

### Retry and failure rules

- A **stage retry** repeats only the failed stage. A **delivery retry** repeats
  the target request and its `before_send` gates. These are separate decisions,
  with separate retry budgets and records; neither is implied by `done: false`.
- A failed `after_response` call does not by itself authorize resending a request
  that the target may already have accepted. Retry the stage against the saved
  response. A response classifier can request a delivery retry only under an
  explicit policy defining which provider responses mean rejection and whether
  resending is safe. A timeout or lost response means acceptance is unknown,
  not that nothing happened.
- Gates stop subsequent stages and prevent sending on `skip` or terminal failure.
  Gate errors fail closed by default. An observer error is recorded separately
  and cannot turn delivery success into delivery failure. Deferred observers
  retry independently. Inline observers record the error and continue; any
  retry must be durably deferred, without blocking or replaying the send.
- Inline retries must fit the total attempt budget; no unbounded waiting or
  polling in inline hooks. On a delivery retry, gates run again, so side effects
  inside them need a stable idempotency key or must be avoided. Deferred stages
  start after the accepted-send decision, once per logical delivery/stage.

### 2. Runners: what runs (pluggable, like alert channels)

A runner is one backend module, registered in one list, the same pattern as
`services/notifications/plugins`:

```
id            'script' | 'http' | 'url-check' | ...
configSchema  JSON schema + field widgets for the console form
validate(config)
run(ctx) -> { status?, done?, data?, error? }   // calls go through the recorder
```

Four ship:

- **`script`**: JavaScript, run in the stage runtime described below (not the
  current `SecureVM`, which has no per-run memory boundary).
- **`http`**: declarative, no code: method, URL, headers, body, then
  *extract* (JSONPath into variables) and *map* (response value -> status word,
  `done` rule). Covers most follow-ups and pre-checks without a script.
- **`url-check`**: today's pre-delivery URL checks, unchanged in behavior, as a runner.
- **`mapping`** (built-in, not offered for new stages): runs migrated `SIMPLE`
  response transforms through the existing mapping code with lookups.

Today's `deliveryFollowUp` setting migrates into an ordinary stage in the "Later"
group, named by default "Delivery status check", which the user can rename. Each
integration's `preDeliveryChecks` become a `url-check` stage at "Before send", and its
`responseTransformation` a `script` stage at "After the response". A new capability is a runner module; the console form for it is
generated from `configSchema` using a small fixed set of widgets (text, select,
code, key-value, rows, tags, duration list, checkbox).

**Templates** are ready-made stage definitions (the Qikchat follow-up is the first),
matched to an integration by provider/URL, offered with "Add from template" and
applied by default where we decide so. A template is data, not code.

### 3. The run record: what happened (one shape for every stage)

```
StageRun {
  orgId, deliveryId, integrationId,
  stage: { id, definitionHash, name, hook, runner },
  integrationRevision,
  runId, jobId?, deliveryAttempt,
  seq,                       // logical scheduled check, not a worker retry
  executionAttempt,          // retry of that check; retained for debugging
  replayOfRunId?,            // deliberate manual re-run
  at, durationMs,
  outcome: ok | error | skipped | timeout,
  status,                    // free-form word chosen by the stage (DELIVERED, SIGNED_OFF...)
  done,
  result,                    // small JSON, capped
  error,
  calls: [{ id, method, url, requestHeaders, requestBody,
            statusCode, responseBody, durationMs, error }],   // masked, capped
  logs: [...]
}
```

**One recorder** wraps the sandbox `http` helper and the declarative runner.
Every supported stage HTTP call goes through it. It masks secrets before any
persistence or display, including tokens in response bodies, returned results,
errors and script logs; header-name masking alone is insufficient. Runners declare
sensitive response paths, and resolved credential values are redacted too.
The audit covers all sinks, including application logs, exports and test results.
Recording caps limit stored detail; transport limits separately bound bytes read
from the network. A truncated or omitted body is explicitly labelled in the viewer.

## Stage runtime

Stage code never runs in the delivery process. Threat model: stage scripts are
written by authenticated org users, in a multi-tenant system, so a script must be
assumed able to escape a JavaScript sandbox. The boundary is therefore the OS.

- **Runner processes.** A bounded pool of long-lived child processes, each running
  one stage at a time. A stage runs in a fresh `vm` context inside the process
  (defence in depth, not the boundary). A process is recycled after N runs, after
  any limit breach, and on any unexpected exit; an exhausted pool fails the stage
  (per its `onError`), it never blocks a delivery.
- **Enforced limits** (all by the OS, so an escape cannot lift them):
  - memory: a limit on the process's private writable memory (`prlimit --data`),
    which covers heap, `ArrayBuffer`s and native allocations alike;
    `--max-old-space-size` below it gives a clean JavaScript error first. (An
    address-space limit, `--as`, does not work: V8 reserves far more address
    space than it uses, so Node fails to start under any useful value.);
  - processes: `prlimit --nproc`, so an escaped script cannot fork without bound;
  - CPU and wall time: the parent kills the process at the run's deadline;
  - user: each runner runs as **its own uid** from a configured range
    (`STAGE_RUNNER_UIDS`; no passwd entries, owning no files), so it cannot read
    application files, secrets, `.env` or MongoDB credentials (it receives only
    its input over stdin), and it cannot trace, read the memory of or signal
    another org's runner. Before a uid is reused, everything still running under
    it is killed, so nothing left behind by one script waits for the next;
  - network: none at all. On a host the runner starts in its own empty network
    namespace (`unshare --net`, no firewall rule to maintain, and loopback
    services such as a local MongoDB are unreachable too). In Docker the backend
    cannot create namespaces, so runners start in a **stage-runner sidecar**
    container with `network_mode: none`, a read-only file system and no secrets;
    the backend reaches it over a Unix socket only its uid can open.
- **No direct capabilities.** The runner gets its input and talks to the parent over
  a line-delimited JSON protocol on stdin/stdout. `http`, `lookup` and `log` are
  requests on that channel. There is no other way out.
- **The parent does every HTTP call:** destination policy on the URL, the
  **resolved IP** (DNS lookup pinned for the connection, so rebinding cannot switch
  it) and every redirect hop; credential injection for approved origins; byte caps
  while reading; recording and masking; and cancellation of in-flight calls when the
  run ends or times out (abort-controller polyfill on Node 14).
- `before_send` runs after the request transform and the existing pre-delivery
  checks, and sees the final request (never the target's auth headers);
  `after_response` sees every answer, and its gates can only turn an accepted send
  into a failure.
- Inline hooks share one latency budget per delivery attempt; a stage that would
  exceed it is cut off and handled by its `onError`.
- Server prerequisites (the backend running as root, util-linux's `unshare` and
  `prlimit`, a free uid range) are a one-time, approved change on each host; in
  Docker the sidecar is part of `docker-compose.yml`. Startup verifies them from
  inside a runner: a probe escapes the `vm` context and tries the network, a
  protected file and the user, and allocates past the memory limit outside the
  JavaScript heap. Only a genuine allocation failure counts as capped. Stages do
  not run unless every check holds (`stage-isolation-check.js` runs the same
  probe on a server).
- Release tests prove the boundary from inside an escaped context: no network, no
  file access, memory cap holds, runners cannot reach each other, leftover
  processes are killed, kill on deadline.

## Storage and scale

- **`stage_definitions`**: content-addressed (hash of the normalized stage
  definition: runner, config, hook, effect, schedule, contract). Jobs and runs
  reference the hash, so pinning a definition costs one shared document, not a copy
  per job. The hash is also the stage's revision: there is one revision concept.
- **`stage_state`**: the latest committed outcome per
  `(orgId, deliveryId, stageId)`: status, done, runs, lastRunId, definitionHash.
  It is the source of truth for results and filters, retained like delivery logs.
- Runs go in their own collection `stage_runs` (indexes: `(orgId, deliveryId)`,
  `(orgId, stage.id, at)`, 30-day TTL). Request and response bodies live only here. **Not** embedded in `execution_logs`: that
  collection already receives hot-document step updates, and
  per-check request/response bodies would multiply it. A separate collection
  paginates, retains independently, and aggregates cheaply.
- The delivery log keeps a tiny summary per stage (stable stage ID, status, done)
  so list rows can show a tag with no join. It is a repairable projection of
  `stage_state` and never holds bodies. Everything else is fetched when the popup opens.
- **Recording level per stage**: `full` | `errors-only` | `summary`. A high-volume
  integration can keep full detail for failures only.
- Deferred work generalizes today's `delivery_follow_ups` into `stage_jobs`.
  Execution is **at least once**, not exactly once. A unique logical key
  `(orgId, deliveryId, stageId, seq)` prevents duplicate job creation (the
  definition hash is an attribute of the job, not part of its identity), but
  cannot prevent a remote side effect being repeated after a crash. The external
  idempotency key is derived from the logical key, so it never changes.
  Pass a stable idempotency key to APIs that support it. For other APIs, document
  duplicate risk and do not automatically retry an uncertain side effect unless
  the stage explicitly allows it.
- **Inline runs ride on the attempt's log write.** The send paths write each
  attempt through one helper that adds, to the same single-document update as the
  status, the attempt's inline run records (`stageProjection`, capped small) and
  the outbox intents its status implies; both are drained right after and removed
  from the log, so bodies never stay there. Where a path logs one status but means
  another (the scheduler logs FAILED for a failure it will retry), the outbox
  follows the real outcome, so `on_failure` fires only for terminal failures.
- Today the scheduler path (delayed and recurring deliveries) runs neither the
  response transform nor the follow-up: configurations that never ran there are
  migrated as disabled stages and listed, so migration does not start them.
- **The commit point is one document.** For a deferred stage it is the
  `stage_jobs` document; for an inline stage it is the delivery log's update for
  that attempt. A claim sets `state: RUNNING`, a lease token and the
  `claimedDefinitionHash` (with renewal while running). After the run, a single
  conditional update, matching `_id`, `state: RUNNING` and the lease token, sets the
  next state (`COMPLETED`, `RETRY_SCHEDULED`, `DEAD`) and stores the masked run
  record in `projection`. That update is the commit: an expired or stale worker's
  update matches nothing and is discarded.
- **Everything else is a projection of the commit.** A projector, idempotent and
  keyed by `runId`, upserts `stage_runs`, advances `stage_state` only if the run's
  `seq` is newer than the one stored, updates the delivery log summary, then
  clears `projection`. A repair worker re-projects any committed job whose
  `projection` is still present. A crash at any point after the commit repeats only
  projection writes, never the external call. A crash between the external call and
  the commit is the documented at-least-once case.
- Persist each terminal or accepted decision and the deferred work it implies in the
  **same single-document update** of the delivery log (the outbox: a list of
  pending stage intents). An accepted send writes its `after_delivery` intents; a
  terminal failure (`FAILED` or `ABANDONED`, including failures before any send,
  such as a gate, a transform error or URL validation) writes its `on_failure`
  intents. MongoDB here has no transactions, and a single-document
  update is atomic. An idempotent repair worker turns intents into jobs and clears them. Recovery
  must create missing jobs after a crash between sending, logging and enqueueing.
  A crash before acceptance was persisted remains an uncertain delivery and uses
  the delivery retry/reconciliation policy; the queue cannot resolve it alone.
- **`on_failure` and later retries.** Each terminal failure has a `failureSeq`
  (1, 2...). `on_failure` runs once per `failureSeq`; its logical key includes it.
  A manual replay or a DLQ retry starts a new attempt chain: if it ends in a terminal
  failure again, `on_failure` fires again with the next `failureSeq`; if it succeeds,
  nothing already fired is undone, and stages can read `ctx.delivery.failureSeq` and
  `ctx.delivery.replayOf` to tell the cases apart.
- **Two kinds of stored data.** *Diagnostic records* (`stage_runs`) are masked by
  `sensitivePaths`, capped, viewable by authorized users, 30-day TTL. *Execution
  inputs* (the accepted response and context snapshot a pending job needs) are raw:
  they live only on the `stage_jobs` document, are never returned by any API except
  an audited super-admin debug view, and are deleted when the job reaches a final
  state (with a 30-day hard TTL).
- Schedules are offsets from the accepted-send time or repeat-with-backoff until
  `done` or a required maximum age/check count. Scheduling progress and transient
  error retries have separate counters. Retry exhaustion enters a stage dead
  letter state without changing the delivery result. Retention must not expire
  active jobs; run detail TTL is independent of pending-work lifetime.
- **Rate limiting by target host**, not one global cap: a provider's limit is
  respected across every integration that calls it, with jitter. This is what
  keeps polling a provider like Qikchat safe as volume grows.

## Configuration

```
integration.stages: [
  { id, name, hook, effect, enabled,
    runner: { type, config },
    schedule?: { checkAfterSeconds: [...] } | { everySeconds, maxAgeSeconds },
    contract: 1,                     // script/ctx contract version
    auth?: { credentialRef, headers: { <name>: '... {{ credential.<field> }}' }, allowedOrigins: [...] }
         | { source: 'integration', allowedOrigins: [...] },   // the integration's own auth, explicitly
    onError: { action: 'ignore' | 'fail_stage' | 'retry_stage',
               maxAttempts?, backoffSeconds?, allowUncertainSideEffects? },
    timeoutMs,
    recording: { level: 'full' | 'errors-only' | 'summary', sensitivePaths: [...] },
    outputs?: [{ name, type: 'string' | 'number' | 'boolean' | 'object', sensitive? }],
    inputs?: { <name>: '{{ expression }}' } }
]

integration.send.bindings?: {           // the Send step, after before_send stages
  headers?: { <name>: '{{ stages.<stageId>.output.<name> }}' },
  query?:   { <name>: '{{ ... }}' }
}
```

The runner validates its config on save; the engine also validates unique IDs,
hook/effect combinations, schedules, credential ownership, retry policies and
aggregate limits. Failures of a gate affect the delivery as defined above;
`onError` never implicitly authorizes a delivery retry.

Configuration plumbing is explicit implementation work. Integration creation,
update, read mappings, frontend serialization, duplication, history/diff/restore,
audit, secret references and export/import must all preserve `stages`. Existing
creation and export paths use field lists, so adding a document property alone
does not support these operations. Require round-trip coverage before release;
an imported credential reference must be rebound within the destination org.

Jobs pin the stage's definition hash and the integration revision at scheduling
time, including required input context and the accepted response. Persist secret
references rather than resolved credentials; secret rotation uses the current
value, and a missing/revoked reference blocks execution visibly. Edits and
reordering affect future deliveries. Disabling a stage or integration pauses
pending work; it does not silently mark it complete. Resuming skips missed slots
and schedules the next eligible check without a catch-up burst; expired work is
shown explicitly. Deleting a stage cancels its pending jobs and retains history.
These controls are checked even for jobs with pinned definitions. Restore creates
a new revision. Manual replay uses the original revision by default, records who
requested it and why, and requires an explicit choice to use the current revision.
An audited **re-pin** operation moves pending jobs of a stage to its current
definition, so a fixed script reaches work already scheduled. It applies only to
unclaimed jobs (`state: PENDING`, no lease) through a conditional update on that
state, so a re-pin racing a claim loses; the logical key and the external
idempotency key are unchanged; and completion is fenced on the
`claimedDefinitionHash` as well as the lease token, so an old execution and its
replacement can never both commit.

### Reading the pipeline: facts the console draws

Read-only endpoints under `/api/v1/stages` that the workflow canvas (and any other
view) is built on. They return recorded facts; the console names a branch from them.

| Endpoint | Answers |
|----------|---------|
| `GET /flow-stats?integrationId&hours=24` | Per delivery target (the integration, or each action): deliveries by status, attempts and retries (an attempt after the first); per stage: runs, `ok`, `skipped` (called `skip()`), `rejected` (called `fail()`), `errored`, `timedOut`, the status words returned, and for checks after delivery the latest status per delivery. Also `removedStages` and `unattributed` deliveries. At most 30 days (the run retention). |
| `POST /save-impact` `{ integrationId, integration: { stages / actions } }` | What saving a draft would do to scheduled checks already waiting: per stage `keepOldVersion` (waiting on an older definition), `paused`, `resumed`, `cancelled`, with the change (`edited`, `disabled`, `enabled`, `removed`, `added`). Saves nothing. |
| `POST /outcomes` `{ stage }` | The statuses (with whether they end a check), `skip()` and `fail()` calls (and whether a failure asks for a retry) a stage can end with, read from its configuration. A runner describes itself with `outcomes(config)`; a script is read by a small scanner that ignores comments and strings and reports anything computed as `dynamicStatus` instead of guessing. |
| `GET /logs/:id/similar-failures?minutes=60` | How many other deliveries of the same integration and action failed with the same error code (or error category) within that many minutes either side. |

### Check status, then replay

Sending a failed delivery again is only safe if the provider does not already have the
message: a send that timed out may have arrived. A check after delivery can be marked
`verification: { resendWhen: ["NOT_FOUND", ...] }`, the status words that mean the
provider does not have the message. `POST /deliveries/:deliveryId/check-and-replay
{ reason, acceptUnverified? }` (needs `stages:replay`, audited) then:

1. runs that check once against the delivery log and records the run like any other;
2. a status in `resendWhen` sends the delivery again (the ordinary manual replay);
3. any other status means the provider has it: refused with 409 `PROVIDER_HAS_MESSAGE`,
   whatever the caller says;
4. a failed check, no status, or no marked check: refused with 409 `UNVERIFIED`,
   unless `acceptUnverified` is true, which is recorded in the audit entry.

Only `FAILED` and `ABANDONED` deliveries are replayable (409 `NOT_REPLAYABLE`).

`contract` versions the script's input and helpers. A contract change ships as a new
version; saved stages keep running on the version they declare.

### Migration and compatibility contract

Scope: single-delivery outbound integrations, in both send paths. Multi-action
actions, inbound integrations and the DLQ inbound replay keep `preDeliveryChecks`
and `applyResponseTransform` unchanged.

Migrated configurations run under **legacy contracts**, which reproduce the old
execution environment exactly instead of rewriting scripts to the new `ctx`:

| Source | Becomes | Legacy contract reproduces |
|--------|---------|----------------------------|
| `deliveryFollowUp` | `script` stage, "Later" | `delivery` (and `payload`), `context` with `orgId`, `integrationId`, `eventType`, `headers`; `http`, `skip`, `lookup`, `log`, the utility helpers. `context.headers` holds opaque references that the parent resolves only in calls to the integration's approved origins (derived from the template, or from the origins in the stage's recorded calls); scripts that use header values for anything else are reported as unsupported. |
| `preDeliveryChecks` | `url-check` stage, "Before send" | The existing `checkBeforeDelivery` code, moved unchanged into the runner (the shared function stays for multi-action). |
| `responseTransformation` `SIMPLE` | built-in `mapping` stage, "After the response" | `applySimpleTransform` with lookups, run in the parent (declarative, no script). |
| `responseTransformation` `SCRIPT` | `script` stage, "After the response" | `payload` (the response), `context`, the utility helpers, `lookup`, `hl7`, `skip(reason, { shouldRetry })` with its delivery-retry meaning as an explicit delivery policy; the transformed value is recorded as the old path recorded it. |

Each source's observable effects (delivery status, retry decision, recorded
response, logs) are listed and covered by golden tests.

**Order of the switch, per integration:**
1. Validate: configurations a legacy contract cannot reproduce are rejected and
   listed for manual action; they stay on the old path.
2. Shadow: the new stage runs alongside the old path without effects (no delivery
   decision, provider calls only through a recorded stub where possible) and the
   outcomes are compared for a set window.
3. Switch ownership only when shadow outcomes match; exactly one owner executes
   from then on. Pending follow-up jobs are mapped with their schedule and input.
4. Rollback restores the old owner without replaying work the new engine completed.

**Cleanup:** an idempotent step strips request/response bodies and headers from
existing `execution_logs.followUp.history`, moving entries younger than 30 days into
`stage_runs` (masked by the template's `sensitivePaths`) and dropping older ones.

Request transformation and the scheduling script are not stages and stay where
they are.

## Script contract (one for all stages)

Input `ctx`: `event`, `delivery { request, response, attempt, status }`,
`stages { <id>: { status, result } }` (completed earlier stages from the same
delivery and pinned pipeline revision), `run { seq, executionAttempt, of? }` (`of` is absent for repeat-until-done schedules),
`vars`. Inputs are read-only snapshots. Deferred work persists only the bounded
context it needs; it cannot depend on transient in-memory variables from a send.
Helpers: `http`, `lookup`, `log`, `skip(reason)`,
`fail(message, { retryStage })`. Output `{ status, done, data }`.
`status` is a bounded status word; `done: false` asks for the next scheduled check
and is only valid for scheduled hooks. `fail` is subject to the engine's effect
and retry policy; scripts cannot override budgets or request an implicit resend.

HTTP is unauthenticated by default. A stage explicitly references a credential
owned by its org and approved for configured origins (scheme, host and port).
Resolve and inject it inside the helper, without exposing the secret to scripts.
Never automatically forward the delivery target's auth or custom headers to
another endpoint. Validate every redirect and strip credentials when the origin
changes; a destination must independently qualify for any credentials it receives.
Templates may preselect an appropriate credential reference, but cannot embed
credentials. Scripts use the helper to obtain tokens and call subsequent APIs;
token responses are treated as sensitive by the recorder.

## Data binding

How a stage gets its inputs and passes results on, for both the no-code editor and
scripts.

- **Expressions** use `{{ path }}`, the syntax custom headers already use, with an
  optional default: `{{ path ?? "fallback" }}`. No other operators.
- **Scopes:** `event.*` (fields from the event type's schema), `delivery.*`
  (request, response, status, attempt, failureSeq), `stages.<stageId>.output.*`
  (only stages that run earlier), `vars.*` (integration variables).
- **Typed outputs:** a runner declares its outputs (the `http` runner from its
  extract rules; a `script` stage in its `outputs` list). The engine validates a
  script's returned `data` against them: unknown keys are dropped, a type mismatch
  is a stage error.
- **Missing values:** a reference to a missing value without a default fails the
  stage before it runs (a gate fails closed; an observer records the error).
- **Picker:** the console builds the variable picker from these scopes, offering
  only what exists at that position, with types.
- **Handoff to the send:** after the `before_send` stages, the Send step resolves
  `send.bindings` into the target request's headers and query (for example
  `Authorization: Bearer {{ stages.getToken.output.accessToken }}`). A missing value
  without a fallback fails the delivery before anything is sent.
- **Sensitive outputs** (declared `sensitive`) are masked in every record and may
  be bound only into headers or query of the integration's own target origin.

## The UI never changes per stage

Three generic surfaces, all driven by data:

1. **Delivery tab** (integration page, after Reliability): the pipeline shown above,
   stages grouped by position, each freely named; add from a template or a runner;
   the editor is generated from the runner's schema; one shared *Test* panel runs a
   stage against a sample or a real delivery and renders the result with the same
   viewer as production runs. Testing a real stage may call external APIs: default
   to stubbed HTTP, with a clearly labelled live mode, normal authorization,
   credential restrictions and audit. A live test must not advance production jobs
   or change the delivery result.
2. **Delivery popup**: tabs are built from the delivery's stage runs: Source event,
   cURL, Response, then one tab per stage that ran, titled with the stage's own
   name. Each tab is one component, `StageRunView`: status chip, time, each call as
   cURL + response, logs, result, error. The Timeline merges the same records.
3. **Results**: separate delivery outcomes from execution metrics. Outcome counts
   and delivery filters use `stage_state`, the latest committed state per
   `(orgId, deliveryId, stageId)`, identified by stable IDs; definition hashes
   remain available as a breakdown. Three PENDING checks followed by DELIVERED
   count as one delivered outcome and four executions. Run counts, check errors,
   retries and latency come from execution history. Delivery outcome date filters
   use accepted-send time; execution date filters use run time and are labelled
   accordingly. Retain the latest-state projection independently of run-detail TTL,
   and use indexed queries or rollups for large ranges. Status words are bounded
   validated values, not arbitrary error text; names are display labels.

## Safety (what makes it scalable to trust)

- Required runtime limits: wall time, memory, call count, concurrency, request and
  response bytes, and total inline latency. The existing `SecureVM` does not
  enforce a per-run memory ceiling, and rejecting its async result does not abort
  outstanding Axios requests. Generic execution requires a terminable runtime
  boundary and a cancellation signal propagated to all HTTP calls. A timeout
  stops local work; it cannot undo a request already accepted by a remote API.
  Do not enable generic inline scripts until these limits are enforced and tested.
- Stage HTTP must enforce destination policy on initial requests, resolved IPs
  and every redirect, including DNS rebinding protection. Reusing only the current
  target-URL validator is insufficient: it checks literal hosts/IPs without DNS
  resolution or redirect-hop enforcement. Current script `http` has no such check.
- Masking and recording caps in the recorder; kill-switch per stage, per integration,
  and global; repeated failures of a stage raise an alert through the existing
  alert channels.
- Contract tests for every runner; the leak audit covers stage runs. Org-scoped
  authorization applies to config, run reads, test, replay, exports and metrics.
  Separate permissions: edit stages, live test, replay. Per-org quotas on stage
  HTTP calls per day, visible in the console, because every check costs a
  provider call.
- Personal data: templates and runners declare `sensitivePaths` (Qikchat's
  delivery report carries the recipient's phone number); those values are masked
  before storage. Bodies expire with `stage_runs`.
  Apply shared per-host concurrency/rate limits across workers, with org fairness;
  respect provider Retry-After without one org starving another.

Required failure tests before generic stages ship: worker death after a remote
success but before persistence; lease expiry with a stale worker; send success
with failed enqueue; run persistence with failed summary update; edits, disable,
deletion and migration while jobs are pending; timeout with in-flight HTTP;
cross-origin redirects and token-body redaction; and post-response errors that
must not resend an accepted delivery. Test legacy/new-engine ownership and rollback
without duplicate calls, plus configuration round trips and latest-outcome counts.

## Scope of the release

In: the four hooks, in both outbound send paths (delivery engine and
`scheduler-worker`); `script`, `http`, `url-check` and built-in `mapping` runners;
legacy contracts and shadow runs; data binding and the Send step's bindings; the
stage runtime with its host prerequisites;
recorder, masking and destination policy; `stage_definitions`, `stage_runs`,
`stage_state`, `stage_jobs`, the outbox and repair worker; templates (Qikchat
follow-up); the Delivery tab, the generic popup tabs, Timeline integration and
results; permissions, quotas, kill-switches, alerts, re-pin and audited replay;
migration of follow-up, pre-delivery checks and response transform for
single-delivery outbound integrations; cleanup of recorded follow-up bodies; removal
of migrated call sites and the follow-up-specific code.

Out: request transformation and the scheduling script (not stages); inbound proxy
requests and scheduled jobs (product boundary). Migration of the old configuration
covers single-delivery outbound integrations; an integration with actions keeps its
per-action pre-delivery checks and response script on the old path (they keep
working) and can give its actions stages of their own.

Delayed and recurring deliveries of integrations with actions send each action
through the delivery engine's own action send (`deliverScheduledAction` is a thin
adapter), so stages and every kind of action work there too. The scheduler keeps
owning retries of the whole scheduled item, so the engine creates no DLQ entry for
them (`noDlq`) and only reports whether a failure was retryable.

## Build order

Internal sequencing only; nothing ships until all of it is done.

1. Stage runtime (runner processes, per-runner uids, memory cap, no network, startup
   probe, kill on deadline) and the HTTP layer (destination policy with DNS pinning
   and redirect checks, credentials, caps, cancellation).
2. Recorder and masking; `stage_definitions`, `stage_runs`, `stage_state`.
3. Engine: hooks and effects, inline budget, the outbox and repair worker,
   `stage_jobs` with fencing, schedules, retries, dead letter, per-host and per-org
   limits, pause/cancel/re-pin, replay.
4. Runners (`script`, `http`, `url-check`), registry, templates, config validation
   and full config plumbing (create, update, read, duplicate, history, export/import).
5. Legacy contracts, golden tests, shadow runs, migration with rollback, and the
   follow-up body cleanup.
6. Console: Delivery tab, schema-generated editors, shared Test panel, popup tabs,
   Timeline, results and filters, quotas and kill-switches.
7. Removal of migrated call sites and follow-up-specific code, once coverage is
   verified.

## Definition of done

- Every failure test listed under Safety passes, in CI.
- Configuration round trips (create, update, read, duplicate, history/restore,
  export/import) preserve stages exactly.
- The leak audit covers stage configuration, runs, exports and test results.
- Migration and rollback rehearsed on a copy of production data: no lost, duplicated
  or replayed provider calls; behavior of migrated stages matches the old paths.
- Load test at the largest expected org volume (millions of deliveries): inline latency
  within budget, deferred throughput within per-host limits, storage within
  projections.
- Shadow runs matched for every migrated integration; unsupported configurations
  are listed and left on the old path, not silently converted.
- Runtime boundary tests pass from inside an escaped context (no network, no file
  access, memory cap, kill on deadline), and the startup probe refuses to run
  stages on a host without the prerequisites.
- Commit and projection tests: a crash at each point after the commit never repeats
  the external call; stale workers and re-pins cannot double-commit.
- `on_failure` fires once per `failureSeq`, including for failures before any send.
- Existing follow-up bodies are cleaned up.
- Removal is limited to call sites with verified coverage; shared functions used by
  excluded flows remain, and `delivery_follow_ups` is dropped only after its jobs
  are migrated and drained.

## Trade-offs and what we deliberately do not do

- It is a framework, so it can bloat. Guard rails: three runners plus the built-in mapping, four fixed
  hooks, no graph/branching, no user-defined hooks.
- Inline stages add latency to every delivery: hence budgets, and the rule that
  anything slow or recurring is `after_delivery`.
- Storage grows with calls recorded: hence the separate collection, caps, TTL and
  recording levels.
- Migration is the real cost: hence one idempotent, reversible migration rehearsed
  on production data, with single ownership of each stage during the switch.

## What changes when we add something new

| New need | Backend | UI |
|----------|---------|----|
| Another script step at a supported hook | config only, within the enforced contract | none |
| Another provider's follow-up | a template (data) | none |
| A different kind of step (e.g. SFTP upload) | runner, transport policy, recording and contract tests | none if supported widgets and result shape suffice |
| Show what a step did | nothing | none (generic viewer) |
| Count outcomes of a step | nothing | none (generic stats) |
