# Shared workload admission

Panthorium coordinates concurrent work through its existing PostgreSQL database.
Every backend replica using the same database and `PANTHORIUM_CAPACITY_SCOPE`
shares one bounded set of active and waiting tickets per workload. Production
requires the store; a database failure never falls back to process-only limits.
Development without a database uses an abortable in-memory gate.

| Lane | Default active | Waiting | Active per account | Integration |
| --- | ---: | ---: | ---: | --- |
| text | 8 | 32 | 2 | Interactive gateway calls and streaming |
| background | 2 | 8 | 1 | Cloud App/organization drafts, office/work generation, media planning |
| image | 2 | 4 | 1 | Creative Studio image generation |
| media | 1 | 2 | 1 | Video render/timeline/transcription and Studio file edits |
| voice | 50 | 0 | 1 | Authenticated Gemini Live connections |
| local | 5 | 0 | 1 | Requests admitted to the existing local broker |

These are admission limits, not measured model throughput or a supported-user
count. The local broker still executes one operation at a time and retains all
RAM/VRAM/temperature guards, private-account restrictions and zero-local-billing
rules. No new model provider, paid capacity, region or GPU is provisioned.

Each gateway provider attempt acquires the destination lane. A provider fallback
cannot bypass its gate. Explicit local selection, entitlement checks, locked
tool-provider turns and no-replay-after-stream-output behavior remain in place.
Do not add a second outer gate around calls already using the same lane.

## Queue and lease semantics

- A short transaction locks the scope/lane row, expires dead tickets and admits
  the oldest eligible waiter. Per-account caps prevent one account monopolizing
  the lane; a blocked account does not prevent other eligible accounts starting.
- Tickets contain an account identifier and scheduling metadata, never prompts,
  transcripts, files, credentials or results. They are removed after completion,
  refusal, cancellation or timeout; expired records are purged on lane access.
- Active tickets expire after 45 seconds without renewal. A heartbeat runs every
  15 seconds; loss of renewal aborts ongoing work. A local deadline aborts before
  the last known lease expires even when the database response hangs.
- Provider HTTP requests, Live sockets and media child processes receive the
  cancellation signal. A lease cannot undo a provider-side paid request or a
  completed external effect. An uncertain submission stays reviewable in the
  existing durable Studio ledger and is never automatically resubmitted.
- Waiting tickets hold no payload. A crashed HTTP request is not replayed. Durable
  jobs continue to use their existing repository, ownership and idempotency rules.
- Bounded polling uses short transactions and releases database connections
  between polls and throughout model execution. Monitor pool wait and DB CPU
  before increasing limits. This is a conservative foundation, not a claim that
  polling alone sustains hyperscale throughput.

## Configuration and monitoring

Default scope is `panthorium`. Separate production/staging databases already
isolate their application quotas; keep the same scope on all replicas of one
deployment. Override selected fields with `PANTHORIUM_CAPACITY_LIMITS`, for example:

```json
{"text":{"limit":12,"maxQueue":32,"perUserLimit":2,"maxQueuedPerUser":1,"queueTimeoutMs":15000}}
```

Unknown fields, negative/fractional values, excessive queue sizes and inconsistent
account caps fail startup. All active workers must use the same policy. Drain the
lane before changing limits; disagreement while tickets exist fails closed.

`GET /api/production/capacity` requires authentication and `system:read`. It exposes
global active/queued counts and oldest queue age, without account IDs. Cumulative
wait/completion/rejection metrics are explicitly process-scoped. Existing
`/health` includes store readiness without revealing internal metrics publicly.

For replica expansion, share PostgreSQL, signing/encryption configuration and
an object store accessible by every replica. The notebook's local disk and edge
remain single-host dependencies. Do not route traffic to another machine until
those dependencies, authentication and ownership checks have been verified there.
Use health-based load balancing and drain existing HTTP/Live connections before
replacing workers. Capacity queues do not automatically move live conversations.

## Validation and rollout

`node test/workload-capacity.js` exercises cancellation, account fairness, workload
isolation, provider fallback admission, lease loss and child-process termination.
With `TEST_DATABASE_URL` set, `node test/workload-capacity-postgres.js` uses a unique
temporary schema and four real Node processes for 80 synthetic jobs. It verifies
the global active ceiling, shared queue bounds, policy conflicts and expired
worker recovery; no real model requests or user messages are sent.

The PostgreSQL test is mandatory in CI. Merge only after checks pass, then let the
existing main-CI notebook release publisher deploy. Verify the actual activated
SHA, public health and protected capacity endpoint. New tables are additive;
rollback restores the previous code through the normal release procedure.

Replica routing and inference-engine batching are separate layers. Managed Gemini
serving remains managed by its provider; the notebook broker does not gain GPU
batching from this change. Dedicated inference hosts, vLLM/TPU/GPU replicas,
cross-region storage and autoscaling require provisioned capacity and workload
benchmarks before activation.

References: [PostgreSQL row locking](https://www.postgresql.org/docs/current/explicit-locking.html),
[Node cancellation](https://nodejs.org/docs/latest-v24.x/api/globals.html#static-method-abortsignalanysignals).

## Recorded verification: 2026-11-11

`npm run check` and the complete `npm test` suite passed. The PostgreSQL test
ran against an isolated temporary database on the connected notebook: four real
Node processes completed 80 synthetic jobs with peak active work 4 / configured
limit 4. Shared queue, per-account admission, cancellation, timeout, expired
worker recovery and policy-conflict assertions passed. The temporary database
was removed. This is scheduling correctness evidence, not a real-model throughput
benchmark. Code publication, main CI and production activation are pending.
