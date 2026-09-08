# Phase 14 — Sentinel Control Plane

Phase 14 establishes the two-AI architecture requested for Panthorium OS:

1. **Sentinel** — back-office AI/control plane for administrators.
2. **Sentinel** — user-facing AI for general users.

The design applies current frontier-agent architecture patterns while preserving Panthorium safety controls from Phase 12 and Phase 13. It does **not** claim Panthorium is already superior to frontier AI systems; superiority must be proven by repeatable benchmark evidence.

## Architecture

```text
Sentinel
  ├─ observes Production Intelligence
  ├─ observes Autonomous Governance
  ├─ supervises Release Gate
  ├─ supervises Benchmark Arena
  ├─ manages Active Learning Runner
  ├─ aligns Panthorium with frontier architecture patterns
  ├─ creates gated training candidates for Sentinel
  └─ never deploys, merges, bypasses RBAC, or bypasses learning gates

Sentinel
  ├─ answers general users
  ├─ uses active-only learning context
  ├─ captures conversation examples for review
  ├─ learns from benchmark feedback after review/shadow/promotion
  └─ never accesses back-office tools directly
```

## Frontier patterns applied

- Agent + tools + handoffs + guardrails
- Tracing/evaluation/release gates
- Tool/resource/prompt boundary
- Grounded tool use and context circulation
- Durable execution and human gates
- Self-improvement loop with quarantine/shadow/promotion
- Least-privilege multi-agent control
- Continuous 24h learning without gate bypass

References used for architecture direction:

- OpenAI Agents SDK: agents, tools, handoffs, guardrails and tracing.
- Model Context Protocol: resources, prompts, tools and confirmation boundaries.
- Gemini API tools: function calling, grounding and context circulation.
- LangGraph: durable execution, persistence, and human-in-the-loop checkpoints.

## New backend services

`services/sentinelOrchestratorService.js`

Responsibilities:

- Phase 14 originally separated two profiles; Phase 15 supersedes this with one `sentinel` profile and RBAC capability contexts.
- Maintain hard capability boundaries
- Run periodic Sentinel Control cycles
- Collect telemetry from production, governance, release gate, benchmark, active learning, learning versions and training stats
- Plan safe proposals
- Execute only bounded safe actions in `autopilot` mode
- Store cycle history in PostgreSQL table `panthorium_sentinel_control_cycles`

`services/frontierArchitectureService.js`

Responsibilities:

- Maintain a curated frontier architecture pattern catalog
- Map each pattern to Sentinel and Sentinel
- Score architecture maturity across multiple pillars
- Expose internal/external learning channels
- Feed frontier topics into 24h Active Learning without bypassing gates

## New routes

`routes/sentinelControl.js`

```text
GET  /api/sentinel-control/status
GET  /api/sentinel-control/frontier
GET  /api/sentinel-control/history
POST /api/sentinel-control/cycle
POST /api/sentinel-control/mode
```

All routes require authenticated admin/settings permission.

## New UI

`sentinel-control-ui.js`

Dashboard: **♊ Sentinel Control Plane**

Shows:

- Sentinel state
- Sentinel state
- providers
- mode: off / observe / autopilot
- architecture patterns
- frontier architecture maturity
- internal/external learning channels
- proposals
- executed actions
- cycle history

## Safe autopilot actions

Sentinel can automatically:

- trigger governance safe guardrails
- trigger Release Gate benchmark/repair
- draft training candidates for Sentinel using enabled providers
- start a bounded 24h Active Learning run with manual activation gate
- run training auto-review backlog

Sentinel cannot automatically:

- merge pull requests
- deploy Render
- bypass RBAC
- bypass quarantine/evaluation/shadow/promote gates
- expose or read provider secrets
- activate unsafe learning output directly
- claim that Sentinel is better than frontier AI without benchmark evidence

## 24-hour self-improvement loop

`PANTHORIUM_DUAL_AI_MODE=observe` by default.

When enabled, the loop runs every `PANTHORIUM_DUAL_AI_INTERVAL_MS` milliseconds, default 5 minutes.

Recommended production rollout:

1. Start in `observe` mode for at least 24 hours.
2. Confirm governance incidents are stable.
3. Enable `autopilot` only after provider quota and release-gate behavior are verified.
4. Keep Phase 12 manual activation gate enabled.
5. Keep benchmark evidence current before claiming quality leadership.

## Acceptance criteria

- `/api/sentinel-control/status` returns both profiles and boundaries.
- `/api/sentinel-control/frontier` returns patterns, maturity, learning channels and safety boundary.
- Sentinel Control dashboard opens from staging admin desktop.
- Observe cycle plans actions without mutation.
- Safe execute cycle only uses existing guardrails.
- Sentinel can start or supervise 24h learning without bypassing manual activation.
- Sentinel uses only Active learning versions as context.
- CI green.
