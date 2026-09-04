# Phase 6 status

Started from production `main` after Phase 5 acceptance.

Completed:
- durable pending workflow confirmations
- restart-safe confirm/cancel recovery
- PostgreSQL + memory repository modes
- expiry cleanup and audit/run-history updates
- durable one-time scheduled Agent jobs
- PostgreSQL worker claiming with `FOR UPDATE SKIP LOCKED`
- stale running-job recovery after restart
- user-scoped list/get/cancel APIs
- current identity/permission revalidation before scheduled execution
- guest scheduling blocked because guest identities are ephemeral
- confirmation-gated scheduled workflows transition to `waiting_confirmation` and synchronize from Agent run history
- Phase 6 persistent-workflow and scheduled-job regression tests registered in `npm test`

Current API:
- `POST /api/agent/jobs`
- `GET /api/agent/jobs`
- `GET /api/agent/jobs/:jobId`
- `DELETE /api/agent/jobs/:jobId`

Next implementation target: recurring schedules and event-driven triggers, followed by automation policy/dashboard controls.
