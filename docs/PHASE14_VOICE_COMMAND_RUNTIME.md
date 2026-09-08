# Phase 14.4 — System-wide Thai Voice Command Runtime

Phase 14.4 upgrades Panthorium from chat-window voice controls into a system-wide voice command layer.

## Goal

Users and administrators can speak directly to Panthorium and receive spoken answers without opening Sentinel Chat.

```text
Voice input → SpeechRecognition → Sentinel Core stream → Thai Text-to-Speech → Energy Orb voice events
```

## Runtime file

```text
voice-ui.js
```

The runtime is loaded through the shell script list and appears as a microphone button on the taskbar.

## Core behavior

- Default listening locale: `th-TH`
- Fallback locale chain: `th-TH` → `th` → `en-US`
- Text-to-Speech: browser `speechSynthesis`
- Speech-to-Text: `SpeechRecognition` / `webkitSpeechRecognition`
- Processing path: `window.PanthoriumAIStream.call(prompt)`
- Fallback path: existing `window.callAI(prompt)`
- No chat window is required
- No provider API key is exposed in the browser

## Profiles

```text
/admin → Sentinel Core voice profile
/      → Sentinel voice profile
```

Sentinel Core uses a lower pitch and slightly slower rate for back-office/admin responses.
Sentinel uses the normal Thai voice profile for public/user responses.

## Hands-free mode

The browser still requires an initial user gesture to unlock microphone and audio playback. After the user presses the taskbar microphone once, hands-free mode can keep listening after each response.

The runtime intentionally stops listening while the AI is speaking, so it does not capture its own TTS output as a new command.

## Direct voice commands

The runtime handles common system commands locally:

```text
หยุดพูด
หยุดฟัง
เปิดแชท
เปิด Governance
เปิด Dual AI
เปิด Training Lab
เปิด Production Intelligence
```

Other spoken text is sent to Sentinel Core for processing.

## Language fallback

Browsers do not expose a reliable full list of supported SpeechRecognition languages. The runtime therefore:

1. starts with `th-TH`;
2. listens for `language-not-supported` or grammar errors;
3. automatically falls back to the next language in the chain;
4. shows a user-facing warning if the browser has no SpeechRecognition support.

## Events

The runtime emits namespaced events for other UI layers, including the Energy Orb:

```text
panthorium:voice-command-ready
panthorium:voice-command-start
panthorium:voice-command-result
panthorium:voice-command-processing
panthorium:voice-command-done
panthorium:voice-command-error
panthorium:voice-user-start
panthorium:voice-user-result
panthorium:voice-user-end
panthorium:voice-start
panthorium:voice-boundary
panthorium:voice-end
panthorium:voice-error
```

## Safety boundaries

- No authentication changes
- No RBAC changes
- No admin action bypass
- No automatic deploy or merge behavior
- No permanent whole-document `MutationObserver`
- Browser microphone requires explicit user interaction

## Acceptance

1. Deploy `phase14-3-energy-orb-desktop` to Staging.
2. Open `/admin` and hard refresh.
3. Click the taskbar microphone button once.
4. Enable hands-free mode.
5. Say a Thai prompt without opening Sentinel Chat.
6. Confirm the system processes the command and speaks the answer.
7. Say “เปิด Governance”, “เปิด Dual AI”, or “เปิด Training Lab”.
8. Confirm the admin app opens and the system replies by voice.
9. Say “หยุดพูด” and confirm TTS stops.
10. Confirm Energy Orb reacts to voice start/boundary/end events.

## Version

```text
14.4.0-voice-command-runtime
```
