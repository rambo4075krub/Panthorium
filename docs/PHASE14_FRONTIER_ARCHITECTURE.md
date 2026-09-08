# Phase 14.1 — Frontier Sentinel Control Learning Architecture

Phase 14.1 extends the Sentinel Control Plane with a frontier-pattern knowledge layer. The goal is not to claim that Panthorium is already better than frontier AI systems, but to make Sentinel continuously compare Panthorium against proven frontier-agent architecture patterns and improve only through evidence and gates.

## Two-AI architecture

```text
Sentinel
  = administrator/back-office AI control plane
  = observes production, governance, release gates, benchmark drift and learning loops
  = creates proposals, starts safe loops and drafts Sentinel training candidates
  = never merges PRs, deploys Render, bypasses RBAC, reveals secrets or skips gates

Sentinel
  = public/user-facing AI
  = answers normal users with active-only knowledge
  = learns from conversations, benchmark feedback and provider teachers as candidates only
  = never directly accesses back-office tools
```

## Frontier architecture patterns mapped into Panthorium

The new `FrontierArchitectureService` stores a curated architecture map and exposes it through the Sentinel Control status payload.

Patterns:

1. Agents + Tools + Handoffs + Guardrails
2. Trace → Observe → Evaluate → Optimize
3. Tool / Resource / Prompt Boundary
4. Grounded Tool Use + Context Circulation
5. Durable Execution + Human Gate
6. Eval → Repair → Shadow → Release Gate
7. Least-Privilege Multi-Agent Control
8. Continuous 24h Learning without Gate Bypass

## New service

`services/frontierArchitectureService.js`

Responsibilities:

- Maintain frontier-pattern catalog
- Map each pattern to Sentinel and Sentinel responsibilities
- Define internal/external learning channels
- Score architecture maturity across pillars
- Recommend improvement actions without bypassing safety gates
- Feed training topics into the 24h Active Learning Runner

## Sentinel Control cycle updates

`services/sentinelOrchestratorService.js` now includes:

- `frontier` object in `/api/sentinel-control/status`
- `learningChannels` for Sentinel and Sentinel
- maturity scoring for role separation, tool boundaries, observability, release gates, benchmark evidence, durable learning, active-only runtime, provider diversity and governance
- `learningPlan` attached to every cycle report
- benchmark-repair prompts that include frontier patterns
- Active Learning topics derived from the frontier pattern catalog

## API update

`GET /api/sentinel-control/frontier`

Returns:

- frontier pattern catalog
- learning channels
- maturity score
- recommendations
- safety boundaries

## UI update

`sentinel-control-ui.js` now displays:

- Frontier maturity score
- Frontier maturity pillar breakdown
- Frontier architecture patterns
- Internal/external learning channels
- Roadmap and recommendations
- Runtime rule: Sentinel uses active-only knowledge

## Safety boundaries

The system remains intentionally bounded:

- No automatic PR merge
- No automatic Render deploy
- No RBAC bypass
- No direct external data into production answers
- No shadow/rolled-back learning in user runtime
- No superiority claim without benchmark evidence

## Environment flags

```text
PANTHORIUM_DUAL_AI_MODE=observe|autopilot|off
PANTHORIUM_DUAL_AI_INTERVAL_MS=300000
SENTINEL_RELEASE_GATE_MIN_BENCHMARK_SCORE=80
```

Recommended rollout:

1. Keep Phase 14 in `observe` mode on staging first.
2. Verify `/api/sentinel-control/status` and `/api/sentinel-control/frontier`.
3. Run an observe cycle.
4. Run safe execute only after Governance is stable.
5. Keep manual activation for learning outputs.
6. Use benchmark evidence before claiming quality leadership.

## Acceptance criteria

- CI green
- Sentinel Control dashboard opens
- Frontier maturity appears
- Learning channels show internal/external split
- `/api/sentinel-control/frontier` returns catalog and boundaries
- Safe execute can only trigger existing gated actions
- Sentinel supervises Sentinel, but Sentinel stays user-facing and active-only
