# Phase 9 — Integrations & External Actions

Status: final hardening complete; awaiting CI and staging acceptance.

Final hardening adds DNS-to-request pinning for production HTTPS calls, rejects mixed public/private DNS answers, expands reserved/private IPv4/IPv6 blocking, keeps TLS SNI/hostname verification on the original allowlisted host, bounds stored/returned response previews, handles circular JSON payloads safely, preserves explicit confirmation for `integration.invoke`, and retains user-scoped integration/execution history.

Current version: `9.3.0-phase9-final-hardening`.

Release gate: do not merge PR #11 until the final commit CI passes and Phase 9 staging is explicitly accepted.
