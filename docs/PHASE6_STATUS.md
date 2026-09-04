# Phase 6 status

Started from production `main` after Phase 5 acceptance.

Completed:
- durable pending workflow confirmations and restart-safe confirm/cancel recovery
- PostgreSQL + memory repository modes
- expiry cleanup and audit/run-history updates
- durable one-time scheduled Agent jobs
- PostgreSQL worker claiming with `FOR UPDATE SKIP LOCKED`
- stale running-job recovery after restart
- current identity/permission revalidation before scheduled execution
- recurring schedules with run limits
- event-driven triggers
- automation policy tiers and limits
- Agent Automation dashboard UI
- service-layer account/permission guards for automation mutations
- strict UUID validation for schedule/trigger route identifiers
- separate event emission rate limit
- safe event payload serialization and size rejection
- Phase 6 final hardening regression coverage in `npm test`

Current API:
- `POST /api/agent/jobs`
- `GET /api/agent/jobs`
- `GET /api/agent/jobs/:jobId`
- `DELETE /api/agent/jobs/:jobId`
- `GET /api/agent/automation/policy`
- `POST /api/agent/automation/schedules`
- `GET /api/agent/automation/schedules`
- `DELETE /api/agent/automation/schedules/:scheduleId`
- `POST /api/agent/automation/triggers`
- `GET /api/agent/automation/triggers`
- `DELETE /api/agent/automation/triggers/:triggerId`
- `POST /api/agent/automation/events/:eventKey`

Release candidate: `6.4.0-phase6-final-hardening`.

Next gate: CI must be green, then deploy branch `phase6-agent-automation` to staging and complete final staging acceptance. Do not merge PR #8 into `main` until staging acceptance is confirmed.
