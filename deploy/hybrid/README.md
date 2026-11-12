# Sentinel AI + Qwen3.5-4B on the notebook

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
- The selected Qwen3.5-4B Q4_K_M profile uses 24 GPU layers, 8192 context
  tokens, four CPU threads and a separate F16 projector on CPU. Images are bounded
  to 512 tokens each; reasoning to 512 tokens. Local text thinking defaults on,
  can be disabled per `/api/local/chat` request, and remains off for voice/idle insights.
- `/qwen` accepts up to four JPG/PNG/WebP images or one video up to ten minutes.
  The browser resizes to 768 pixels; video is four timestamped samples without audio.
  The broker validates and re-encodes inline images, rejects remote URLs/paths,
  animated images and pixel bombs. Media survives tool rounds but is not stored
  in conversation history or captured as training examples.
- The independent 50 ms RAM watchdog and queue remain in effect. Limits remain
  82% RAM, 80% VRAM, 2.5 GiB free RAM and 82 C GPU temperature, with recovery at
  77% RAM, 75% VRAM and 77 C. Proposed cold budgets are 2.4 GiB RAM and 2.8 GiB
  VRAM including the CPU projector; they require actual notebook verification.
  `productionApproved:false` explicitly records that these new settings have not
  been benchmarked on the target device. The installer must pass live inference
  and resource checks before committing or removing the previous model.
  Resource forecasts are admission/stop thresholds, not OS hard caps. Missing
  metrics fail closed; only the identity-checked model may be stopped.
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

## Qwen3.5-4B activation and Qwen3.5-9B removal

The repository profile pins the Q4_K_M model and F16 projector by revision,
exact bytes and SHA-256. Existing text, tools/MCP, local voice, mailbox and idle
insight routes use the `panthorium-local` alias. ASR/TTS and media generation stay
separate services; Qwen's vision understanding does not generate images or audio.

After main CI and the normal notebook deployment succeed, use the **active release**:

```powershell
& D:\PanthoriumAI\voice\.venv\Scripts\python.exe <active-release>\deploy\hybrid\prepare_qwen4.py
& D:\PanthoriumAI\voice\.venv\Scripts\python.exe <active-release>\deploy\hybrid\update_host_broker.py --expected-sha <active-sha> --remove-9b
```

Ensure Pillow is available in the broker/voice environment before installing.
`prepare_qwen4.py` downloads public weights into `models/candidates`; it does not
activate anything or delete 9B. Existing files must match pinned checksums. A
partial download cannot overwrite a previous candidate.

The installer closes admission, backs up scripts, stops only owned processes and
installs both assets. It tests text, a typed tool call and an actual image through
the broker. Failure restores the previous scripts/profile and retains 9B weights.
Only after passing all probes and the live resource guard does `--remove-9b` delete
the exact former 9B Q3_K_S/Q4_K_M files and their receipts in models/candidates,
plus verified 9B launchers. It preserves the 4B projector, speech assets, other
models and user data. Restoring 9B after deletion requires downloading it again.

Run authenticated application smoke checks after activation, including Thai answers,
calculator/tool execution, sampled video and ASR/TTS. CI tests exercise protocols,
authorization and resource logic using fixtures; they are not GPU benchmarks.
Do not run a burst of denied logins on production as a model test.

## Actual LoRA training

Training Lab → Training → ฝึกโมเดล Qwen 4B prepares a downloadable training bundle.
It uses the current approved global-safe export with the existing consent and
anonymization gate, removes synthetic acceptance fixtures, deduplicates prompts,
and separates held-out validation examples. At least 20 qualifying examples are
required. It does not automatically train on private conversations.

`training/train_qwen4.py` implements real BF16 LoRA on a dedicated Linux CUDA
runner, with preflight, pinned base revision, dataset checksums, baseline/held-out
loss, adapter saving and optional GGUF export. The notebook's 4 GiB GPU is below
the 10 GiB **free** VRAM floor; training does not run alongside production inference.
No cloud GPU is provisioned and no data is uploaded automatically. The UI prepares
and downloads the bundle; it does not mislabel preparation as a running training job.
Text tuning freezes vision layers and does not add new vision/speech abilities.
Candidates require Thai/reasoning/tools/vision/resource review and a separately
reviewed hash-pinned profile before promotion. See `training/README.md`.
