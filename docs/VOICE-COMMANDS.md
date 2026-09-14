# Sentinel voice commands

Both microphones classify voice input using `classifyVoiceInput` in the shared
catalog. System commands use `/api/sentinel/command` (`voiceMode: true`) and run
silently, except permission requests. Questions use `/api/chat` with `voice:true`
(`conversationalVoice: true` in the browser) and play the returned answer through
`/api/speech`. Typed chat continues using `/api/chat/stream`.

Both auth and streaming wrappers must preserve **both** options. The streaming
wrapper must not intercept conversational voice: its old `sentinel-stream` result
was discarded by a `via === "sentinel"` speech check. Speech policy now depends
on input intent and pending confirmation, not the transport name. Unknown/denied
commands never fall back to chat. Navigation needs no configured AI provider;
answering questions needs a working provider, and neural audio needs working TTS.

## Window controls

Say `เปิด <name>`, `<name> เปิดขึ้น`, `ปิด <name>`, `ปิดหน้าต่างนี้`, or
`ปิดทุกหน้าต่าง`. English open/close and the Thai aliases in
`voice-window-catalog.js` are also accepted. `รีเฟรช <name>` invokes the module's
existing refresh control when available. Opening an already open window brings
it to the front; opening a minimized window restores it.

| Window | Required permission |
| --- | --- |
| Sentinel AI | chat |
| AI Platform / AI Dashboard | chat |
| Sentinel Agent | chat |
| Settings / ตั้งค่า | settings |
| Security / Security Dashboard | settings and administrator role |
| Agent Automation | settings |
| Memory & Knowledge | settings |
| Multi-Agent | settings |
| Integrations | settings |
| Learning Lab / Training Lab | settings |
| Production Intelligence | settings |
| Governance | settings |
| Sentinel Control | settings |

Voice access also requires an authenticated session with chat permission.
The server checks permissions before returning an allowlisted UI instruction.
The client checks again, invokes the actual module lifecycle, verifies visibility,
then displays the result. A planner's prose alone is never evidence of execution.
Account and permission changes clear cached windows and pending confirmations.

## External apps

The same voice window path can open these allowlisted external sites in a
Panthorium window: `YouTube`, `Facebook`, `LINE`, `TikTok`, `Instagram`, and `X`.
For example, say `เปิด YouTube`, `เปิด เฟซบุ๊ก`, `เปิด ไลน์`, or `ปิด TikTok`.
Each launcher uses a fixed HTTPS URL and the current user's `chat` permission,
then opens the real website in a separate browser popup. It does not embed,
copy, or proxy the external page. If the browser blocks the popup, press
`เปิดเว็บไซต์จริง` in the Panthorium launcher window or allow popups for the
staging site. Panthorium does not accept arbitrary URLs from voice transcripts
or AI output. A native in-window WebView requires packaging Panthorium as a
desktop app such as Electron or Tauri.

## Other actions

- `แสดงสถานะระบบ` executes `system.status` with `system:read` permission.
- `ค้นความรู้ <query>` searches the current user's knowledge using `knowledge.search`.
- Other workflows use the existing registered Agent tools and require a working
  AI provider plus `sentinel:command` permission. Unsupported operations do not
  become executable merely because an AI describes them.
- Mutating or high-risk tool steps display the exact tool and arguments before
  execution. Say `ยืนยัน` or `ยกเลิก`. Confirmation is scoped to the current
  account and expires; network errors on confirmation must not trigger retries.
- `ปิดผลคำสั่ง` dismisses the result toast. There is no bottom-right result panel.

## Regression and acceptance

`npm test` includes the real auth/stream wrappers in both installation orders and
a jsdom integration test: final SpeechRecognition transcript → actual callAI →
HTTP command router with JWT verification → actual module DOM → silent result.
All 13 module windows are tested for open, duplicate prevention, close, repeated
close and reopen; supported refresh, minimized restore, guest/operator denials,
negation, silent opener failures and workflow confirmations are also covered.
`test/voice-conversation.js` additionally executes the actual shell, wrappers,
JWT-verified chat and speech HTTP routes, and audio playback lifecycle for both
microphones. It covers final/interim and natural-ended transcripts, expired chat
and TTS tokens, failed refresh, provider errors, TTS outages, autoplay rejection,
silent unsupported commands, and typed streaming. The AI/TTS providers and
physical hardware are fixtures; a successful test proves routing and playback
handling, not microphone accuracy, physical sound, or live provider health.

Audio warmup uses a nonzero-duration WAV blob compatible with the existing CSP;
`media-src` is not loosened. Only the top toast displays failures. `ok:false` and
HTTP errors cannot be reported as successful answers. Failure to play audio is
reported separately while retaining the answer under the Orb. Session refresh
uses the authenticated refresh-cookie route and does not silently create a guest.

For a spoken question, Network must show `/api/chat` with `voice:true`, then
`/api/speech` after a nonempty successful answer. A 200 health check or SSE stream
alone does not prove either AI success or audible playback. Ask a question such
as `การเรียนรู้คืออะไร` using each microphone; then check silent open/close and a
spoken permission request. Do not promote to production until actual-browser
voice acceptance passes.

Staging CI runs these tests before deploying and compares the deployed command
assets byte-for-byte with the tested checkout. On `/admin`, validate spoken
commands on the user's actual browser before promoting to main. Test at least
`เปิด Learning Lab`, `ปิด Learning Lab`, `Multi Agent เปิดขึ้น`, `เปิด AI Platform`,
`ปิดหน้าต่างนี้` and `ปิดทุกหน้าต่าง`; check that the window actually changes.
Voice commands execute silently: no echo, acknowledgement, error narration or
spoken `เสียงตอบกลับ` label. Results and errors appear on screen. The sole spoken
exception is an explicit permission/confirmation request before a gated action;
after the user confirms, execution is silent again. Both the global microphone
and the microphone inside Sentinel AI follow this rule.
