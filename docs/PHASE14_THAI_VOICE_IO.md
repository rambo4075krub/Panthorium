# Phase 14.2 — Thai Voice I/O Layer

Phase 14.2 adds Thai browser voice output and voice input controls for the two-AI architecture.

## Goal

```text
Sentinel Core = back-office/admin AI voice
Sentinel      = public user-facing AI voice
Language      = Thai first, locale th-TH
```

## What is implemented

- `voice-ui.js` loads as a shell script on `/`, `/admin`, `/admin/`, `/admin.html`, and `/sentinel.html`.
- Browser Text-to-Speech uses `SpeechSynthesisUtterance` with `lang = "th-TH"`.
- Browser Speech-to-Text uses `SpeechRecognition` / `webkitSpeechRecognition` when available.
- `PanthoriumVoice` global API is exposed:
  - `PanthoriumVoice.speak(text, options)`
  - `PanthoriumVoice.speakCore(text, options)`
  - `PanthoriumVoice.speakSentinel(text, options)`
  - `PanthoriumVoice.stop()`
  - `PanthoriumVoice.pause()`
  - `PanthoriumVoice.resume()`
  - `PanthoriumVoice.unlock()`
  - `PanthoriumVoice.listen(options)`
  - `PanthoriumVoice.open()`
- AI answers are spoken from `panthorium:ai-done` and from the existing `speak()` call bridge.
- Duplicate speech is de-bounced so streaming `done` plus legacy `speak()` does not read the same answer twice.
- A taskbar Thai Voice button opens the voice control panel.
- The Sentinel chat window gets Thai voice controls: enable/disable, stop, and settings.
- Voice events are emitted for UI/orb synchronization:
  - `panthorium:voice-start`
  - `panthorium:voice-boundary`
  - `panthorium:voice-end`
  - `panthorium:voice-error`
  - `panthorium:voice-user-start`
  - `panthorium:voice-user-end`
  - `panthorium:voice-user-result`

## Voice profiles

```text
sentinel-core
- Used by admin/back-office paths and Core/governance/release-gate contexts.
- Thai locale: th-TH
- Lower pitch, supervisory tone.

sentinel
- Used by public user-facing Sentinel.
- Thai locale: th-TH
- More neutral assistant voice.
```

## Browser limitation

This phase uses the browser and operating system voice engines. Thai speech quality depends on the user's browser/OS having a Thai voice installed. If no Thai voice is available, the system still sets `th-TH` and falls back to the best available browser voice.

For server-side premium neural Thai voice, add a future provider-backed TTS endpoint such as `/api/voice/tts` with quota controls, caching, and signed audio URLs.

## Safety boundaries

- No provider API key is exposed to the browser.
- No voice command can bypass RBAC.
- No voice command can merge PRs or deploy Render.
- Voice input only fills/sends user text through existing authenticated chat flows.
- Admin voice profile does not grant permissions; permissions still come from server-side auth/RBAC.

## Staging acceptance

1. Deploy branch `phase14-2-thai-voice-io` to staging.
2. Open `/admin` and hard refresh.
3. Confirm the taskbar shows the Thai Voice button.
4. Open Sentinel AI chat.
5. Click **เปิดเสียงไทย** or open the voice panel and click **เปิด/ปลดล็อกเสียง**.
6. Test Sentinel voice.
7. Test Sentinel Core voice.
8. Send a Thai prompt to Sentinel; the answer should be spoken in Thai.
9. Click stop; speech must stop immediately.
10. Use the mic button or `PanthoriumVoice.listen()` on a supported browser; Thai speech should transcribe to text.

## Version

```text
14.2.0-thai-voice-io
```
