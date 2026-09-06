# Phase 14 — Dual AI Control Plane

Phase 14 establishes the two-AI architecture requested for Panthorium OS:

1. **Sentinel Core** — back-office AI/control plane for administrators.
2. **Sentinel** — user-facing AI for general users.

The design applies modern frontier-agent architecture patterns while preserving Panthorium safety controls from Phase 12 and Phase 13.

## Architecture

```text
Sentinel Core
  ├─ observes Production Intelligence
  ├─ observes Autonomous Governance
  ├─ supervises Release Gate
  ├─ supervises Benchmark Arena
  ├─ manages Active Learning Runner
  ├─ creates gated training candidates for Sentinel
  └─ never deploys, merges, bypasses RBAC, or bypasses learning gates

Sentinel
  ├─ answers general users
  ├─ uses active-only learning context
  ├─ captures conversation examples for review
  └─ never accesses back-office tools directly
```

## Frontier patterns applied

- Agent + tools + handoffs + guardrails
- Tracing/evaluation/release gates
- Tool/resource boundary
- Grounded tool use and code/deploy separation
- Self-improvement loop with quarantine/shadow/promotion

## New backend service

`services/dualAiOrchestratorService.js`

Responsibilities:

- Define AI profiles for `sentinel_core` and `sentinel`
- Maintain hard capability boundaries
- Run periodic Dual AI cycles
- Collect telemetry from production, governance, release gate, benchmark, active learning, learning versions and training stats
- Plan safe proposals
- Execute only bounded safe actions in `autopilot` mode
- Store cycle history in PostgreSQL table `panthorium_dual_ai_cycles`

## New routes

`routes/dualAi.js`

```text
GET  /api/dual-ai/status
GET  /api/dual-ai/history
POST /api/dual-ai/cycle
POST /api/dual-ai/mode
```

All routes require authenticated admin/settings permission.

## New UI

`dual-ai-ui.js`

Dashboard: **♊ Dual AI Control Plane**

Shows:

- Sentinel Core state
- Sentinel state
- providers
- mode: off / observe / autopilot
- architecture patterns
- proposals
- executed actions
- cycle history

## Safe autopilot actions

Sentinel Core can automatically:

- trigger governance safe guardrails
- trigger Release Gate benchmark/repair
- draft training candidates for Sentinel using enabled providers
- start a bounded 24h Active Learning run with manual activation gate
- run training auto-review backlog

Sentinel Core cannot automatically:

- merge pull requests
- deploy Render
- bypass RBAC
- bypass quarantine/evaluation/shadow/promote gates
- expose or read provider secrets
- activate unsafe learning output directly

## 24-hour self-improvement loop

`PANTHORIUM_DUAL_AI_MODE=observe` by default.

When enabled, the loop runs every `PANTHORIUM_DUAL_AI_INTERVAL_MS` milliseconds, default 5 minutes.

Recommended production rollout:

1. Start in `observe` mode for at least 24 hours.
2. Confirm governance incidents are stable.
3. Enable `autopilot` only after provider quota and release-gate behavior are verified.
4. Keep Phase 12 manual activation gate enabled.

## Acceptance criteria

- `/api/dual-ai/status` returns both profiles and boundaries.
- Dual AI dashboard opens from staging admin desktop.
- Observe cycle plans actions without mutation.
- Safe execute cycle only uses existing guardrails.
- Sentinel Core can start or supervise 24h learning without bypassing manual activation.
- Sentinel uses only Active learning versions as context.
- CI green.
