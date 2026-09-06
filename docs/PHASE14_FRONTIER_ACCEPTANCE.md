# Phase 14.1 Frontier Acceptance Checklist

Use this checklist on staging before merging Phase 14.

## Required staging checks

```text
Target: https://panthorium-staging.onrender.com/admin
Branch: phase14-dual-ai-orchestration
Mode: observe first
```

1. Login as administrator.
2. Confirm desktop shows **Dual AI**.
3. Open **♊ Dual AI Control Plane**.
4. Confirm these cards render:
   - Dual AI mode
   - Sentinel Core
   - Sentinel
   - Release Gate
   - Frontier maturity
   - Providers
5. Confirm **Frontier Architecture Maturity** shows pillar scores.
6. Confirm **Frontier Architecture Patterns** lists the mapped patterns.
7. Confirm **Internal / External Learning Channels** shows separate Sentinel Core and Sentinel channels.
8. Call or open `/api/dual-ai/frontier` and verify `frontier.safetyBoundary.noGateBypass=true`.
9. Run **Cycle แบบ Observe** and verify no state-changing action runs.
10. Run **Cycle + Safe Execute** only if Governance is healthy; verify executed actions are limited to:
    - governance guardrails
    - release-gate benchmark/repair
    - Sentinel training candidate drafting
    - 24h active learning with manual activation
    - training auto-review backlog
11. Confirm Sentinel runtime remains `active_only`.
12. Confirm no PR merge, deploy, RBAC bypass or secret exposure can be triggered from Dual AI.

## Pass condition

Phase 14.1 passes staging when the dashboard and endpoints prove the two-AI separation:

```text
Sentinel Core = back-office supervisor and learning governor
Sentinel      = public user AI using active-only knowledge
```

The system may say it is aligned with frontier architecture patterns, but it must not claim to be better than frontier AI until repeatable benchmark evidence proves it.
