# Gemini Live + Qwen 4B on the notebook

Gemini Live is the primary voice provider and the only AI provider that debits
Panthorium credits. Qwen has no quota preflight or credit debit. Explicit local
requests never fall back to a paid provider. Automatic short text rewrites use
Qwen first; complex/default tasks and voice use Gemini first. An exhausted or
unavailable credit ledger removes Gemini from the candidate list. Once a tool
has executed, a turn remains on its selected provider to avoid tool replay.

Both providers use the permission-filtered function registry and existing exact
approval flow. `modelMcpBridge.js` uses the MCP SDK over an in-memory transport
for the current account's read-only Panthorium MCP tools. It is not a generic
outbound MCP connector and does not grant credentials/scopes to external clients.

## Notebook broker

- `Start-Hybrid.ps1` starts `hybrid_server.py` on loopback port 8765.
- App config: `PANTHORIUM_HYBRID_AI=1`, `PANTHORIUM_LOCAL_QWEN=1`,
  `LOCAL_LLM_URL=http://127.0.0.1:8765/v1/chat/completions`,
  `LOCAL_VOICE_URL=http://127.0.0.1:8765`,
  `LOCAL_QWEN_DISABLE_FILE=D:\PanthoriumAI\qwen.disabled`.
- Application requests go through the broker to port 8088. One operation at a time across
  production and staging; excess requests receive a retryable busy response.
- Qwen uses 20 GPU layers, 8192 context tokens, four CPU threads, below-normal
  priority. ASR/TTS use two CPU threads. Text reasoning remains enabled;
  voice answers skip long internal reasoning to reduce latency. Arithmetic
  uses the registered bounded calculator instead of relying on mental math.
- Monitor interval two seconds, local AI working set ceiling 60% of physical
  RAM, global VRAM high-water threshold 60%, at least 1.5 GiB RAM reserved.
  Under pressure it rejects work and unloads only its identity-checked model.
  Other applications/Windows can exceed these thresholds independently; this
  is admission/watchdog protection, not an OS-enforced global 60% allocation cap.
- Idle voice memory is unloaded after three minutes. Model idle unloading is
  enabled only after production has migrated to the broker; until then its
  legacy port-8088 route keeps the model resident. Cold starts take
  longer. The voice engine is unloaded before text inference to preserve RAM.
- No credential or user-content logs in the broker. Existing application
  conversation/audit retention remains in effect. Speaker verification precedes
  authenticated local ASR; restricted Cloud App contexts cannot fall back into
  general-purpose tool access.

## Audio

Short replies are synthesized in full. Long replies use Thai word/sentence
boundaries, preserve decimal tokens, prefetch two complete clips, and schedule
Web Audio sources against one continuous clock. Later synthesis overlaps playback.
Playback buffers are bounded; cancellation clears sources, pending audio and mic.
This removes fetch-after-play gaps, but cannot promise zero stutter on all hardware,
networks, Bluetooth devices or model outputs. Local speech uses push-to-talk:
tap again to submit, with a maximum recording length of 20 seconds.

## Reversible disable/removal

Run `Disable-Qwen.ps1`: writes the disable marker and stops only the verified
Qwen process. The app immediately excludes Qwen and the broker unloads voice
models. Gemini still requires available credit; no model files or account data
are deleted. Run `Enable-Qwen.ps1` to restore on-demand Qwen service.

If permanently removing weights, disable first, stop the identity-checked broker,
remove its startup invocation, and archive/delete only `D:\PanthoriumAI\models`
and `D:\PanthoriumAI\voice\models` after review. Keep Gemini and application data.

## Local rollout

Required release order: edit and test, publish the changes to GitHub, merge the
reviewed change into `main`, then deploy Production only after main CI succeeds.
Use the existing CI-published notebook release ref and verify the active commit
and public health afterward. Do not use direct Production source overrides as
the normal update path.

`install-local.py` validates original/current hashes, backs up source and DPAPI
runtime config, acquires the stage lock, installs, checks DB/HTTP/public health,
and rolls back on failure. Receipts explicitly state `githubSynced:false`.
This installer is a recovery tool for its matching local manifest, not the normal
release path. Normal releases use reviewed GitHub changes, CI and the notebook
release publisher. Do not reapply an old override after a repository deployment.

## Rollout status

Staging and production now have the local override, following explicit production
approval. The notebook startup hook starts the broker on demand. Production
verification receipts and test results are stored alongside the installer on the
notebook. These source changes preserve that behavior in repository deployments.
The deployment agent keeps the encrypted runtime settings, including hybrid
enablement and the broker URLs, when switching application releases.

`host/Start-LLM.ps1` and `host/voice/voice_engine.py` version the matching host
sources. Their installed locations are `D:\PanthoriumAI\Start-LLM.ps1` and
`D:\PanthoriumAI\voice\voice_engine.py`; app deployments do not copy them
automatically. Model weights, Python/runtime dependencies, encrypted settings,
receipts, logs and user data remain on the notebook and are not published.
