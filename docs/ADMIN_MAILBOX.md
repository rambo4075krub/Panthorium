# Panthorium admin mailbox

Open **Start → กล่องอีเมล** as an administrator. The mailbox is shared by administrators, with server-side account revocation checks. It is not an individual user's private inbox.

## Features

- Inbox, sent, drafts, starred, archive, trash and restore; 50 messages per page; subject/sender/recipient search; unread count.
- Read inbound and outbound content, compose, reply with threading headers, forward text, CC/BCC, up to five outgoing attachments (900 KB total). Received attachments use fresh Resend signed HTTPS links.
- Save/edit drafts (To/subject/text only). Forwarded attachments must be downloaded and attached again. Trash/archive are local states; no remote permanent delete.
- Sync existing inbound messages; select Sent and sync to import existing system/OTP mail. Sync one 50-message page at a time, continuing with “ซิงก์หน้าถัดไป”. API limits apply.
- New mail arrives via verified webhook. Open mailbox refreshes local unread counts every minute. Without webhook, use Sync. No background polling worker/always-on Cloud Run instance is required.
- Audit trail records read, send, drafts and state changes without copying message bodies into logs.

## Deployment configuration

Existing `RESEND_API_KEY` must have full access to read receiving/sent emails and attachments; a sending-only key is insufficient. Existing OTP configuration is reused. Do not paste keys into the browser or commit them.

- `MAILBOX_FROM`: defaults to `Panthorium <account@panthorium.net>`; must be a verified Resend sender.
- `MAILBOX_SEND_ENABLED=1` enables explicit admin sends; `0` disables. Deployment workflows default to 1, overridable with repository variables `STAGING_MAILBOX_SEND_ENABLED` / `MAILBOX_SEND_ENABLED`.
- `RESEND_WEBHOOK_SECRET`: signing secret mounted from Secret Manager. Optional repository variables `STAGING_RESEND_WEBHOOK_SECRET` (staging) / `RESEND_WEBHOOK_SECRET_NAME` (production) contain the **secret resource name**, never its value. Grant runtime service-account Secret Accessor on this secret.
- Optional production repository variable `RESEND_API_KEY_SECRET_NAME` mounts a production full-access Resend key by its Secret Manager resource name. Existing bindings are preserved if omitted. Never bind staging secrets to production.
- PostgreSQL uses the existing shared PostgreSQL pool. Tables/index are created lazily and shared by Cloud Run instances. A database failure returns unavailable, never an in-memory mailbox.

Create a webhook in Resend for the correct deployed environment:

`https://<backend-host>/api/webhooks/resend`

Subscribe to `email.received`, `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`; save its signing secret as above. Use separate signing secrets per environment. Webhook uses raw JSON bytes, Svix HMAC SHA-256, a five-minute timestamp tolerance, deduplication, and retryable server errors. Unknown events are acknowledged. Content is never executed; HTML-only mail is converted to text in the reader, with no tracking images loaded.

Send uses a durable request key and payload hash, Resend idempotency and a 23-hour retry cutoff. In an ambiguous timeout, retry unchanged from the same composer. Before making a new request after an expired retry, inspect Resend history to avoid duplicates. A send-success/DB-failure retry reuses the same provider key.

## Acceptance

1. Deploy and test staging `/` and `/admin`; verify non-admin API 403 and logged-out API 401.
2. Administrator opens mailbox, syncs received and sent pages, reads test mail, stars/unreads/archives/trashes/restores, saves/reopens a draft.
3. Send an owner-approved test email, reply, download attachment; check provider status via webhook. Do not send test messages to real customers.
4. Send from an external mailbox to account@panthorium.net and verify delivery, unread badge and reader; test logout/account switch removes the mailbox and no prior response renders in another session.
5. Merge production only after staging acceptance. Production DNS MX already points to Resend; this feature does not alter DNS.

Limitations: Resend retention/rate limits apply; HTML layout is shown as safe text; drafts do not persist CC/BCC/attachments; mailbox is shared by admins. This is not IMAP/POP3 or a replacement for Resend account administration. No automatic email content is passed to an AI or executed as system instructions.
