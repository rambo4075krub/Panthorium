# System notifications

Panthorium's notification center is part of **ตั้งค่า → ตั้งค่าการแจ้งเตือน**. It combines account-scoped event history, delivery switches, and the existing verified-email reminder form. No new paid notification provider is required.

## Delivery and controls

- In-app delivery starts enabled. Browser notifications, sound, and automatic speech start disabled and require the appropriate device permission or audio activation.
- Master, category, and channel switches control popups and automatic audio. They do not erase history or cancel independently approved email reminders.
- Quiet hours use the saved IANA timezone, including overnight intervals. Equal start/end times mean quiet all day. Muted activity stays available in history.
- Detail previews start disabled. Automatic alerts use generic copy until the account explicitly enables details.
- Automatic notification audio does not interrupt an active voice conversation or call. A user can ask Sentinel to read notifications in the ongoing conversation.
- The open client polls the account's inbox. There is no server Web Push, SMS, or closed-app audio delivery. An offline, closed, or suspended client cannot reliably alert. Previously approved email reminders remain the separate closed-app channel when its provider is configured.

## Event sources

| Category | Source |
| --- | --- |
| System | Explicit immediate self-notifications and supported account events |
| Security | Account login, password/access changes, and scoped security events |
| Operations | Action receipts and scheduled/workflow job progress, approval, success, failure, cancellation, or uncertain outcome |
| Reminders | Scheduling, postponement, cancellation, and email provider delivery status |
| Calendar | Account calendar record changes |
| Files | Completed file writes/deletions and creative work outcomes |
| Social | Committed activity addressed to the account, rechecked against current visibility |
| Billing | Verified, committed order/payment states; test payments explicitly labeled |
| AI | Supported provider/stream failures |

Notifications describe observed outcomes. They do not infer success from a started operation, and an uncertain action receipt stays uncertain. An email provider accepting delivery does not establish that the user received or read it.

## Voice and chat

The authenticated tool registry exposes `notifications.read` and `notifications.write` to Sentinel. Read supports history, unread items, pagination, and settings. Write supports an immediate self-notification, a precise settings patch, read marks, or deleting selected items. Writes keep the existing durable action approval flow and cannot select a different recipient account.

Examples:

- “มีการแจ้งเตือนอะไรที่ยังไม่อ่าน” / “อ่านการแจ้งเตือนให้ฟัง”
- “ส่งแจ้งเตือนถึงฉันด้วย” (use the established subject; clarify when missing)
- “เปิดการแจ้งเตือนการดำเนินการ” / “ปิดเสียงแจ้งเตือน”
- “ห้ามรบกวนตั้งแต่สี่ทุ่มถึงเจ็ดโมงเช้า”
- “ทำเครื่องหมายรายการนี้ว่าอ่านแล้ว” / “ลบการแจ้งเตือนรายการนี้”

`askBeforeNotify` permits Sentinel to offer an additional concrete notification or reminder with “ให้ส่งแจ้งเตือนไหม”. The offer does not count as approval. A request to notify when a job finishes must be tied to the actual operation state; changing the operations category affects future operations generally and is not a per-job subscription. Future reminders use the separate reminder tools and verified-email consent.

## Storage and boundaries

Production stores preferences and inbox records in PostgreSQL. Development memory storage must be explicitly enabled. Additive tables and account indexes are created during service initialization. All routes derive ownership from authenticated identity, reject guests, validate input, and return `Cache-Control: no-store`.

Stable event identifiers prevent duplicate publication. Dismissal retains a tombstone during retention so polling or action reconciliation cannot resurrect a deleted notice. Inbox history is retained for 90 days. Notification storage failures do not change a successfully committed file, payment, or social operation into a failed operation.

Social notifications contain generic text and are checked against current source access before being shown. They do not disclose private messages, profiles, or deleted content through the central inbox. Notification text and tool results are untrusted content and never executable instructions.

## Verification

- `npm run test:notifications`: services, routes, tools, producers, and DOM behavior.
- `node test/notifications-browser.js`: real Chromium settings, delivery, mobile layout, and session isolation.
- `TEST_DATABASE_URL=... node test/notifications-postgres.js`: real PostgreSQL migration, concurrent updates, deduplication, persistence, and ownership. Use only a disposable test database.
- `npm run check`, `npm test`, and `npm run test:postgres` include the new checks alongside existing regressions.
