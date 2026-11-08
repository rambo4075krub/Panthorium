# Sentinel AI + Qwen3.5-9B on the notebook

Gemini Live is the primary voice provider and the only AI provider that debits
Panthorium credits. Qwen is restricted to server-authorized administrators and the verified owner account. It has no quota preflight or credit debit. Explicit local
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
- Qwen3.5-9B Q3_K_S uses 20 GPU layers, 8192 context tokens, four CPU threads,
  below-normal priority and `--load-mode none`. F16 caches and fixed batches match
  the notebook trial. Reasoning is bounded to 512 tokens; voice skips thinking.
  Arithmetic uses the registered bounded calculator. This compressed model can
  still make mistakes or fail to choose tools; successful loading is not a quality guarantee.
- The separate RAM watchdog samples every 50 ms, independently of GPU queries.
  Global thresholds are 82% RAM and 80% VRAM, with at least 2.5 GiB available RAM;
  recovery thresholds are 77% and 75%. GPU temperatures stop work at 82 C and
  recover below 77 C. Cold admission forecasts 2.3 GiB additional RAM and 3.1 GiB
  VRAM. These are sampled stop thresholds with forecasts, not OS hard caps.
  Startup rejects a missing watchdog, and unknown GPU metrics fail closed.
  Only the identity-checked model is stopped; databases and other apps are untouched.
- Idle voice memory is unloaded after three minutes. Model idle unloading is
  enabled only after production has migrated to the broker; until then its
  legacy port-8088 route keeps the model resident. Cold starts take
  longer. The voice engine is unloaded before text admission; the text model is unloaded before voice admission so the two engines do not compete for cold-load memory.
- No credential or user-content logs in the broker. Existing application
  conversation/audit retention remains in effect. Speaker verification precedes
  authenticated local ASR; restricted Cloud App contexts cannot fall back into
  general-purpose tool access.

## Audio

All Gemini Live sessions and local model prompts request speech without Thai
polite endings (ครับ/ค่ะ/คะ/นะครับ/นะคะ/ครับผม). Local TTS also removes these
particles before synthesis using Thai word boundaries, preserving quoted text
and ordinary words. Gemini generates audio directly, so this style is controlled
at generation time; its transcript is not presented as an audio-editing guarantee.

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
remove only the selected model file and its own launcher. Keep other models, voice assets, Gemini and application data.

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

## Qwen3.5-9B activation and Qwen3-8B removal

`model-profile.json` pins the Unsloth Q3_K_S conversion, revision, size, checksum,
launch options and resource policy. The selected model can process text, reasoning
and tools. This installation does not enable images; ASR/TTS remain separate.
Administrator/verified-owner authorization, tool permissions, confirmation gates,
zero local billing and explicit-local requests never using paid fallback remain unchanged.

After main CI and normal notebook deployment succeed, run the active release's
`deploy/hybrid/update_host_broker.py --expected-sha <active-sha>` using the voice venv.
It verifies weights before moving them from the candidate directory, backs up host
scripts, stops only verified owned processes, installs matching launchers, and
requires the new broker's RAM guard to be alive. Startup hooks remain in place;
the model loads on demand and unloads when idle or under pressure.

Verify real authenticated application inference before removing the old weights.
`remove_previous_weights(ROOT, get('health'))` refuses removal unless the running
9B broker has successfully served inference and its guard remains alive. It removes
only Qwen3-8B weights and source receipts in the model/candidate directories.
Other models and user data are preserved. The optional `--remove-8b` installer flag
performs a small inference probe before this same gate. Failed inference retains 8B.
Code rollback copies are kept, but after removal restoring 8B requires downloading
and checksum-verifying its weights again.

`verify-qwen8b.cjs` retains its historical filename and now reads the selected
profile. Set `TEST_BASE`, `TEST_RELEASE`, `TEST_EXPECTED_SHA` and optionally
`TEST_INFERENCE=1` for real administrator chat/calculator and ordinary-user denial
checks. It uses temporary synthetic accounts, checks zero billing and removes its
fixtures. No messages are sent to third parties. Keep actual results separate from
mocked protocol tests. The 2026-11-08 trial notes document the known quality limits.
