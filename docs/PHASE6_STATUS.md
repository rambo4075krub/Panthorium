# Phase 6 status

Started from production `main` after Phase 5 acceptance.

Current foundation:
- durable pending workflow confirmations
- restart-safe confirm/cancel recovery
- PostgreSQL + memory repository modes
- expiry cleanup and audit/run-history updates
- Phase 6 regression test registered in `npm test`

Next implementation target: durable scheduled Agent jobs and worker claiming.
