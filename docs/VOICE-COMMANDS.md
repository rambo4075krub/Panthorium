# Sentinel voice commands

Voice transcripts use `/api/sentinel/command`. Both the auth wrapper and the
streaming wrapper must preserve `voiceMode`. Commands must never silently fall
back to the chat endpoint. Navigation works without a configured AI provider.

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

## Other actions

- `แสดงสถานะระบบ` executes `system.status` with `system:read` permission.
- `ค้นความรู้ <query>` searches the current user's knowledge using `knowledge.search`.
- Other workflows use the existing registered Agent tools and require a working
  AI provider plus `sentinel:command` permission. Unsupported operations do not
  become executable merely because an AI describes them.
- Mutating or high-risk tool steps display the exact tool and arguments before
  execution. Say `ยืนยัน` or `ยกเลิก`. Confirmation is scoped to the current
  account and expires; network errors on confirmation must not trigger retries.
- `ปิดผลคำสั่ง` dismisses the result panel.

## Regression and acceptance

`npm test` includes the real auth/stream wrappers in both installation orders and
a jsdom integration test: final SpeechRecognition transcript → actual callAI →
HTTP command router with JWT verification → actual module DOM → silent result.
All 13 module windows are tested for open, duplicate prevention, close, repeated
close and reopen; supported refresh, minimized restore, guest/operator denials,
negation, silent opener failures and workflow confirmations are also covered.
Dashboard data and speech hardware/audio are fixtures. These tests do not certify
microphone accuracy, physical audio playback, or live provider/database health.

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
