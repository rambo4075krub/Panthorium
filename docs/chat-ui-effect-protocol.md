# Chat UI effect acknowledgment (local implementation)

This extension exposes seven window operations and `screen.command` only to an authenticated, non-guest SSE chat request that advertises `uiActionProtocol: 1`. The ordinary function service and non-streaming chat routes retain their previous catalogue. No production deployment is implied by this document.

## Boundary

- A per-request wrapper, not a global tool registration change, grants the capability.
- The server generates the action and creates a bounded, short-lived pending record. Owner, authentication-session ID, action and arguments are fixed server-side. A random ID and 256-bit nonce bind the browser response to this stream's action. Conversation IDs are not authorization.
- The browser claims the action once over an authenticated endpoint. The server revalidates the account/session and window permission; a claim cannot replace action or arguments.
- The originating browser checks account/token continuity and invokes the existing window/screen executor. Account changes, page departure and cancellation abort pending work where still possible.
- The browser posts a strict bounded receipt. The model receives no nonce or claim endpoint. No result is treated as browser completion before acknowledgment.
- Timeout/disconnect after claim has an unknown outcome, not an effective cancellation. The browser does not automatically fall back/replay the original prompt after receiving an action, even when the receipt was lost.
- UI results end the current tool round. Read screen text is returned as text, not reintroduced as model instructions. Click/fill proposals retain the existing exact user review and are explicitly incomplete. An acknowledged click is not proof of its underlying business operation.
- Native close/reload can destroy the transport before its receipt; this deliberately remains unknown rather than inventing success.

## Deliberate remaining limits

- `/api/local/chat` now supports explicit SSE capability for the full product runtime. Hybrid voice uses it for model-routed requests; media, thinking, voice, session and zero billing remain preserved. Operator eligibility is rechecked at claim and acknowledgment. Legacy JSON clients, standalone `/qwen` (which has no product window runtime), and the inference-only `LOCAL_PROFILE` do not gain window/screen capabilities. Cross-tab control is not inferred from a shared login.
- A single UI action ends the turn. Multi-step open/read/operate workflows require another request, and screen reading is not an AI summarization workflow.
- The final business effect of an existing screen review is not tracked by this bridge. Its card and feature-specific approval remain authoritative.
- In-memory pending receipts are not replayed after process restart. Restart or transport loss requires inspecting the actual UI before retrying.
- Automated tests use synthetic principals, browser fixtures and a local HTTP server, not a real user's account, mobile microphone or production account. Staging and real-browser acceptance remain required before release.

Run `npm run check` and `npm test`, including `chat-ui-action-broker`, `chat-ui-function-calling`, `chat-ui-action-client`, `chat-ui-action-http`, and the window guard regression.
