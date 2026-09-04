# Phase 9 — Integrations & External Actions

Phase 9 starts from the accepted Phase 8 production baseline `5775670d7b470c26bf989356eba3c26c401585e6`.

## Goals

1. Add a safe integration registry for external systems.
2. Keep credentials out of PostgreSQL and browser storage; integrations reference environment secret names only.
3. Restrict outbound actions to HTTPS endpoints on an explicit host allowlist.
4. Route external mutations through existing Agent RBAC, risk policy, and explicit confirmation gates.
5. Persist integration metadata and execution audit history without persisting secret values.
6. Add Integrations dashboard and observability.
7. Add provider-specific adapters after the generic secure foundation passes CI and staging.

## Foundation design

- `IntegrationRepository`: PostgreSQL + memory fallback metadata store.
- `IntegrationService`: validation, ownership, allowlist enforcement, secret resolution, bounded HTTP invocation.
- `/api/integrations`: authenticated management surface for users with `settings` permission.
- Agent tool `integration.invoke`: `core:command`, critical risk, mutating, explicit confirmation required.
- Secret references must match `PANTHORIUM_INTEGRATION_SECRET_*`; the secret value is read from server environment only at invocation time and never returned.
- Allowed destination hosts come from `INTEGRATION_ALLOWED_HOSTS`.

## Delivery gates

Implementation → CI → Final Hardening → Staging Acceptance → PR merge → Production Acceptance.
