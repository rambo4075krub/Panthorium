# Phase 13 — Production Monitoring & Autonomous Governance

Phase 13 adds an autonomous governance layer above Production Intelligence and Sentinel Autonomous Learning. Its purpose is to keep Panthorium safe while the platform runs provider-based learning, benchmark repair, recovery, and release gates.

## Scope

Phase 13 monitors and governs:

- Production health and SLO burn rate
- Release Gate readiness
- Benchmark score and benchmark drift
- Active Learning 24h runner health
- Unsafe shadow samples and provider failure streaks
- Rollback pressure and recovery loop pressure
- Training review backlog

## Governance modes

`PANTHORIUM_GOVERNANCE_MODE` controls behavior.

| Mode | Behavior |
| --- | --- |
| `off` | No scheduled governance loop. Admin API can still evaluate manually. |
| `observe` | Default. Takes snapshots and recommends actions, but does not mutate runtime state. |
| `autopilot` | Executes bounded safe actions only. It never merges Production and never bypasses learning gates. |

## Safe autopilot actions

Autopilot is intentionally limited. It may:

1. Stop Active Learning if production is critical, SLO burn is critical, unsafe shadow samples are detected, or provider failure streaks exceed threshold.
2. Trigger Release Gate benchmark/repair by calling the existing release-gate automation.
3. Run auto-review for pending training examples.

Autopilot may not:

- Merge a pull request
- Deploy Render
- Promote unsafe learning versions directly
- Bypass Quarantine, Evaluation, Shadow, or Promotion gates
- Read or expose provider secrets

## API

All routes require an authenticated user with `settings` permission.

```text
GET  /api/governance/status
POST /api/governance/evaluate
GET  /api/governance/history
GET  /api/governance/summary
POST /api/governance/mode
```

Examples:

```json
POST /api/governance/evaluate
{"execute":true,"source":"manual-operator"}
```

```json
POST /api/governance/mode
{"mode":"autopilot"}
```

## Persistence

When PostgreSQL is configured, governance snapshots are stored in:

```text
panthorium_governance_snapshots
```

Columns:

- `snapshot_id`
- `mode`
- `status`
- `score`
- `signals`
- `actions`
- `executed`
- `report`
- `created_at`

## Dashboard

`governance-ui.js` adds the Admin Governance dashboard. It shows:

- Governance status and score
- Current mode
- Release Gate state
- Benchmark score
- Active Learning run status
- Governance signals
- Planned/executed actions
- Recommendations
- Governance snapshot history

On staging `/admin`, Desktop Manager V2 exposes the app as **Governance**.

## Acceptance criteria

Phase 13 is acceptable when:

- `/api/governance/status` returns a complete governance report.
- `/api/governance/evaluate` persists a snapshot when PostgreSQL is configured.
- `observe` mode does not mutate runtime state.
- `autopilot` can stop unsafe Active Learning but cannot merge or deploy.
- Release Gate benchmark repair is triggered through existing gate automation, not by bypassing gates.
- Governance dashboard opens from Admin and displays signals/actions/history.
- CI passes `phase13-autonomous-governance.js` plus the existing Phase 1–12 regression suite.

## Recommended production default

Use this default for Production:

```text
PANTHORIUM_GOVERNANCE_MODE=observe
PANTHORIUM_GOVERNANCE_INTERVAL_MS=300000
```

Switch to `autopilot` only after Production has stable provider quota, benchmark history, and rollback/recovery baselines.
