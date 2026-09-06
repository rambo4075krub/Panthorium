# Phase 14.1 — Frontier Dual AI Learning Architecture

Phase 14.1 extends the Dual AI Control Plane with a frontier-pattern knowledge layer. The goal is not to claim that Panthorium is already better than frontier AI systems, but to make Sentinel Core continuously compare Panthorium against proven frontier-agent architecture patterns and improve only through evidence and gates.

## Two-AI architecture

```text
Sentinel Core
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

The new `FrontierArchitectureService` stores a curated architecture map and exposes it through the Dual AI status payload.

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
- Map each pattern to Sentinel Core and Sentinel responsibilities
- Define internal/external learning channels
- Score architecture maturity across pillars
- Recommend improvement actions without bypassing safety gates
- Feed training topics into the 24h Active Learning Runner

## Dual AI cycle updates

`services/dualAiOrchestratorService.js` now includes:

- `frontier` object in `/api/dual-ai/status`
- `learningChannels` for Sentinel Core and Sentinel
- maturity scoring for role separation, tool boundaries, observability, release gates, benchmark evidence, durable learning, active-only runtime, provider diversity and governance
- `learningPlan` attached to every cycle report
- benchmark-repair prompts that include frontier patterns
- Active Learning topics derived from the frontier pattern catalog

## API update

`GET /api/dual-ai/frontier`

Returns:

- frontier pattern catalog
- learning channels
- maturity score
- recommendations
- safety boundaries

## UI update

`dual-ai-ui.js` now displays:

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
2. Verify `/api/dual-ai/status` and `/api/dual-ai/frontier`.
3. Run an observe cycle.
4. Run safe execute only after Governance is stable.
5. Keep manual activation for learning outputs.
6. Use benchmark evidence before claiming quality leadership.

## Acceptance criteria

- CI green
- Dual AI dashboard opens
- Frontier maturity appears
- Learning channels show internal/external split
- `/api/dual-ai/frontier` returns catalog and boundaries
- Safe execute can only trigger existing gated actions
- Sentinel Core supervises Sentinel, but Sentinel stays user-facing and active-only
