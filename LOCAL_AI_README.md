# Panthorium local AI pilot

This isolated worktree starts from commit 944ad39 on branch local/ai-server-20261031. Original worktrees and Google Cloud deployments are unchanged.

## Open and start

- Start: powershell -NoProfile -File D:\PanthoriumAI\panthorium-server\Start-Local.ps1
- Stop: powershell -NoProfile -File D:\PanthoriumAI\panthorium-server\Stop-Local.ps1
- Local chat: http://127.0.0.1:8787/local-ai
- Panthorium homepage: http://127.0.0.1:8787/
- Health: http://127.0.0.1:8787/api/health
- Separate experimental voice UI: http://127.0.0.1:8765/

The LLM service must already be running on 127.0.0.1:8088 with model alias panthorium-local. The start script waits for Panthorium HTTP readiness; it does not start the LLM or voice service.

Local username/password are in D:\PanthoriumAI\panthorium-state\LOCAL_LOGIN.txt. This contains only the local pilot credentials. Its ACL and the private profile ACL are restricted to the current Windows user and SYSTEM. These credentials are separate from production.

## Scope and boundaries

The profile binds only to 127.0.0.1, skips dotenv, discards inherited cloud settings, uses isolated development data, and leaves DATABASE_URL empty. No production database is contacted or copied. Runtime state and logs are in D:\PanthoriumAI\panthorium-state.

Existing authentication, chat permission checks and rate limiting remain. Guest accounts do not receive chat permission. The local API allows authentication, health, provider listing and authenticated POST /api/local/chat. Other product/cloud/action API routes are disabled. The scheduler and training worker are not started; governance and Sentinel control are off. Health localPilot fields report these restrictions; other Sentinel status fields describe general product capabilities.

The local provider supports a bounded text request, a maximum 160-token answer, and one in-flight request. Its response is buffered. It rejects cloud providers and redirects; there is no cloud fallback. The browser text demo is single-turn and does not execute tools. The separate voice demo provides local speech recognition, LLM and speech synthesis; it is not a replacement for all Gemini Live protocol features or production Panthorium actions.

## Validation

- node test/local-provider.js: loopback restriction; no cloud fallback even with cloud settings present; no API credential forwarded; concurrency rejection; local action guard.
- node test/local-smoke.js: HTTP health and homepage; unauthenticated chat rejected; actions rejected; authenticated provider catalog.
- node test/local-smoke.js --inference: authenticated Panthorium API to the real local LLM. Run only when it will not interrupt voice/benchmark use.
- git diff --check

On 2026-10-31, the real inference smoke test returned 5 for 2+3 in 501 ms. This is a short warm request, not a representative voice latency benchmark.

## Still required for a production migration

Persistent local PostgreSQL, production data backup/restore and reconciliation, local file/object storage, identity/email/payment/integration replacements, TLS/public ingress, recovery backups, resource/concurrency limits, and real microphone/Thai conversation quality testing. Google Cloud service cancellation and domain/DNS cutover have not been performed.
