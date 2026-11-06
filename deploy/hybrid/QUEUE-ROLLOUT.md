# Local AI queue and tool workflow rollout

The shared loopback broker runs one Qwen/ASR/TTS operation at a time. Up to four
requests can wait for 45 seconds; an account can have one active or waiting job
across staging and production. Account keys are server-derived SHA-256 hashes.
Queue entries last only for the HTTP request; disconnect, cancellation, timeout
and worker failure release them. This is not a durable background task system.

Local requests use a separate Node admission gate, so five waiting local calls
cannot occupy the normal Gemini gateway slots. Native voice work retains its
slot until it actually finishes even if its awaiting task is cancelled.

Admission forecasts total RAM using a conservative 4.5 GiB cold model load,
0.5 GiB warm inference, 2 GiB cold voice and 0.25 GiB warm voice allowance.
Target total RAM is 65%, VRAM 60%, with recovery thresholds of 60% and 55%.
Unavailable GPU readings fail closed. CPU admission also pauses at 65%.
These are service guardrails, not OS-wide hard resource quotas: other programs
and load transients can still exceed them. The monitor stops only the verified
local model process. At the measured notebook baseline near 60% RAM, Qwen cold
loads will remain blocked; do not lower the guardrail just to pass a benchmark.

LangGraph.js replaces only the existing tool-call loop. Identity, MCP scopes,
approval ledger, provider lock, four model rounds and five executed tool calls
remain bounded by existing application controls. Graph state is request-scoped
round/done flags; no new tracing or persistence is configured. Plain completion
requests do not construct a graph. This does not increase model throughput.

## Validation

- `node test/local-queue-workflow.js`
- `python -m unittest discover -s deploy/hybrid -p 'test_*.py'`
- Existing hybrid, function-calling, voice browser, syntax, full application,
  PostgreSQL and security suites in CI.

The ASGI burst test uses synthetic voice work and controlled resource readings;
it validates queue bounds/account isolation, not real Qwen tokens/sec or voice
quality. Do not report its 20 submitted requests as 20 simultaneous inferences.

## Deployment and rollback

1. Push the branch, pass PR checks, merge into main, pass main checks.
2. Let the notebook deploy controller activate the main production release.
3. With no active broker work, run the voice venv Python against
   `<active release>/deploy/hybrid/update_host_broker.py --expected-sha <main SHA>`.
   The installer verifies the active release, briefly closes local admission,
   backs up the broker sources, restarts only the identified broker, checks
   health version `queue-v1`, and restores the previous sources if startup fails.
4. Verify production SHA, broker status and protected queue behavior. Restart
   the broker using its existing Start-Hybrid scheduled startup path after boot.

For removal, use the existing `D:\PanthoriumAI\qwen.disabled` kill switch and
`PANTHORIUM_QWEN_DISABLED` application flag; preserve Gemini. Broker backups and
`queue-installed.json` record exact files. Reverting the application follows the
normal GitHub main deployment flow. No model, credential or database is changed
by the broker installer.
