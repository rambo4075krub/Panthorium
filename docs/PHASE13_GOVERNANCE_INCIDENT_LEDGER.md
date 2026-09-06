# Phase 13 Governance Incident Ledger

Phase 13.1 extends Autonomous Governance with a persistent Incident Ledger and operator runbooks.

## Goals

- Convert repeated governance signals into deduplicated incidents.
- Keep first seen, last seen, occurrence count, severity, last signal payload and runbook steps.
- Automatically resolve open incidents when their signal disappears in a later governance cycle.
- Give Admins a clear runbook without allowing unsafe automatic production changes.

## Tables

### `panthorium_governance_incidents`

- `incident_id` primary key
- `code`
- `severity`
- `status`: `open` or `resolved`
- `first_seen_at`
- `last_seen_at`
- `resolved_at`
- `occurrences`
- `last_signal` JSONB
- `runbook` JSONB

## API

- `GET /api/governance/incidents?status=open|resolved|all&limit=50`
- `POST /api/governance/incidents/:incidentId/resolve`

## Runbook policy

Runbooks are attached by signal code. They may recommend or execute only safe governance actions:

- stop unsafe Active Learning
- trigger Release Gate benchmark / repair
- process training auto-review backlog

Runbooks must not:

- merge Pull Requests
- deploy Render
- bypass Quarantine / Shadow / Promote gates
- lower Release Gate thresholds to force success

## Acceptance

1. A low benchmark signal opens `BENCHMARK_CRITICAL` incident.
2. Repeated cycles increment `occurrences` instead of creating duplicates.
3. Manual resolve marks the incident as resolved.
4. When signals disappear, open incidents are automatically resolved.
5. Dashboard shows open incidents and runbook steps.
