# Sentinel AI + Qwen 8B on the notebook

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
- Qwen3-8B Q4_K_M uses 10 GPU layers, 8192 context tokens, four CPU threads, below-normal
  priority. ASR/TTS use two CPU threads. Text reasoning remains enabled;
  voice answers skip long internal reasoning to reduce latency. Arithmetic
  uses the registered bounded calculator instead of relying on mental math.
- Monitor interval two seconds, local AI working set ceiling 60% of physical
  RAM, global RAM high-water threshold 65%, global VRAM high-water threshold 60%, at least 1.5 GiB RAM reserved. Cold model admission additionally reserves an estimated 6.5 GiB.
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

## Qwen 8B replacement

`model-profile.json` pins the 8B weights and launch settings. The model supports
text, code, translation, reasoning and tool calling. It is text-only: ASR/TTS are
separate services, and image/video understanding is not enabled by this upgrade.
The existing permission-filtered API/MCP registry, confirmation gates, zero local
credit charge and buffered speech remain unchanged. Thinking is enabled for text;
voice skips long thinking to limit latency. Context is 8192 tokens with one slot,
2048 thinking tokens and a 3072-token completion ceiling to protect the notebook.

After the main release is active, run the voice venv Python against that release's
`deploy/hybrid/update_host_broker.py --expected-sha <active-sha> --remove-4b`.
The installer verifies the pinned 8B checksum, pauses admission, backs up scripts,
stops only identity-checked broker/model processes, installs the profile and both
launchers, and checks broker identity before removing exactly the old 4B weights
and its vision projector. The 2B/Llama models and user data are untouched.
A failed code installation restores scripts; once 4B weights are explicitly
removed, returning to 4B requires downloading and verifying them again.

Successful installation is not an inference benchmark. At high baseline RAM the
configured 8B service remains resource-paused, while Sentinel's cloud route keeps
its existing policy. It starts on demand only when global use plus the conservative
cold-load budget fits below 65%; being barely below 65% is insufficient. Do not
relax guards, close user applications or label mocked protocol tests as live model
results. Record actual answer, tool and speech checks separately when resources
permit them. Both direct startup and broker requests enforce admission.

Resource denials now return immediately with an allowlisted reason instead of
waiting 45 seconds in an idle queue. Busy admitted work still uses the bounded
FIFO queue; CPU pressure may recover during that wait. RAM/VRAM limits, the
6.5 GiB conservative cold-load estimate and account permissions are unchanged.
The private local status page shows current RAM, the limit and the estimated
additional headroom needed. These are admission estimates, not measured 8B peaks.
Only authorized local users receive those host metrics. A resource refusal is
non-billable and never grants permission to switch an explicit local request to
the paid provider.
