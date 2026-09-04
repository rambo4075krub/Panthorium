# Phase 6 — Agent Automation & Persistent Workflows

Phase 6 evolves the Phase 5 Agent Platform from request/response execution into durable automation.

## Foundation delivered

- Persistent workflow confirmation state in PostgreSQL (`panthorium_agent_pending`)
- Restart-safe confirmation and cancellation recovery
- Ownership checks when restoring pending workflows
- Expiry cleanup with run-history and audit integration
- Regression coverage for restart recovery and expiry

## Next milestones

1. Scheduled agent jobs with durable job definitions and execution history
2. Background worker lifecycle with safe single-run claiming
3. Event-driven triggers for security and system events
4. Automation policy controls, rate limits, pause/resume, and failure backoff
5. Automation dashboard in Sentinel with run status and controls
6. Staging hardening, CI acceptance, and production rollout

Phase 6 remains isolated on `phase6-agent-automation` until CI and staging acceptance are complete.
