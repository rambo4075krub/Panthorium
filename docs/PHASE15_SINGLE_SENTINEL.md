# Phase 15 — Single Sentinel Consolidation

Phase 15 removes the separate Sentinel control identity and keeps one AI identity: **Sentinel**.

## Runtime design

- `services/sentinel.js` is the only conversation, prompt, provider, training-context, and persistence entry point.
- User chat uses the default Sentinel context.
- Administrator commands use the same Sentinel runtime with the `admin` prompt context and require `sentinel:command`.
- Sentinel Control remains an operational module, not a second AI. It observes governance, release gates, benchmarks, training, and production signals.
- Provider secrets stay on the server and are never stored in browser state.

## Migration

- Existing user permissions are normalized to `sentinel:command` during repository initialization and while verifying existing JWTs.
- Existing control-cycle records are copied into `panthorium_sentinel_control_cycles`; both former control and user-runtime state are retained inside the single `sentinel_state` document.
- Conversation history, training examples, learning versions, benchmarks, provider configuration, governance incidents, and integration records keep their existing stores and user-isolation boundaries.

## API

- `GET /api/sentinel/status`
- `POST /api/sentinel/command`
- `POST /api/chat`
- `POST /api/chat/stream`
- `/api/sentinel-control/*` for authorized operational control

## Speech reliability

The browser primes speech synthesis during the user action, waits briefly after cancellation to avoid Chromium's cancel/speak race, retries once when speech does not start, and keeps Orb/transcript events synchronized with the utterance lifecycle.

## Deployment gate

Deploy the feature branch to staging, verify chat, streaming speech, RBAC, data migration, Orb behavior, and the three-line transcript, then merge to production only after acceptance.
