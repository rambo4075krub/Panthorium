# Phase 8 — Multi-Agent & Orchestration

Baseline: Phase 7 production (`6e88933d8b287c5a6c05be2172e364c8f46438bb`).

## Goals

1. Specialist Agent roles and delegation.
2. Bounded orchestration with deterministic limits.
3. Shared Memory + Knowledge retrieval through existing Agent workflows.
4. Existing RBAC, tool policy, risk levels and explicit confirmation gates remain authoritative.
5. Persistent orchestration runs, resumable confirmation state and observability.
6. Multi-Agent dashboard for run inspection and control.
7. Regression, isolation and final hardening before staging acceptance.

## Foundation

Initial roles: Researcher, Analyst, Operator, Reviewer and Synthesizer.

`MultiAgentOrchestrator` delegates each specialist task through `AgentWorkflowService`; it does not execute tools directly. This keeps Phase 5 safety policies and Phase 6 confirmation behavior in the execution path. Prior specialist outputs are marked as untrusted context.

## Delivery gates

Implementation → CI → Final Hardening → Staging Acceptance → PR merge → Production Acceptance.
