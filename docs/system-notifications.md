# System notifications

Panthorium's notification center is part of **ตั้งค่า → ตั้งค่าการแจ้งเตือน**. It combines account-scoped event history, delivery switches, and the existing verified-email reminder form. No new paid notification provider is required.

The settings page starts with an ordered vertical list of 48 notification events. Each row has its Thai name on the left and its own on/off switch on the right. Work started, work succeeded, work failed, new messages, incoming calls, and other events can be selected independently. Delivery options and history are collapsed below the list so they do not displace the controls.

## Delivery and controls

- In-app delivery starts enabled. Browser notifications, sound, and automatic speech start disabled and require the appropriate device permission or audio activation.
- Master, category, individual event, and channel switches control popups and automatic audio. They do not erase history or cancel independently approved email reminders. The advanced section retains category controls; turning on one event in a disabled category preserves the disabled state of sibling events.
- `notification-event-catalog.js` is shared by the server, settings page, delivery filtering, and voice tool schemas. Event choices are persisted as a strictly validated `settings.events` map. Existing preferences without this map keep their prior category behavior.
- Quiet hours use the saved IANA timezone, including overnight intervals. Equal start/end times mean quiet all day. Muted activity stays available in history.
- Detail previews start disabled. Automatic alerts use generic copy until the account explicitly enables details.
- Automatic notification audio does not interrupt an active voice conversation or call. A user can ask Sentinel to read notifications in the ongoing conversation.
- The open client polls the account's inbox. Background Push additionally requires the server deployment and device opt-in described below; it does not provide SMS or closed-app spoken reading. Previously approved email reminders remain a separate channel when its provider is configured.

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
- “ปิดแจ้งเตือนงานสำเร็จ แต่เปิดแจ้งเตือนงานล้มเหลว” / “ปิดแจ้งเตือนข้อความใหม่”
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

## Background Push and native popups

`notificationPushService` registers up to ten devices per account in PostgreSQL. VAPID keys are generated once and stored server-side, shared across instances and restarts. Web clients explicitly subscribe through the service worker; Android uses the Capacitor Push Notifications plugin and Firebase Cloud Messaging HTTP v1 with runtime service-account credentials. No service-account key is shipped to a client.

Push respects the master switch, browser channel, individual event switches, quiet hours, current account authorization, and current Social source visibility. Payloads intentionally contain generic text only. Notification titles, messages, sender identities, authentication tokens, and account IDs are never included in lock-screen payloads. Automatic spoken reading is still a foreground feature; background sound is controlled by OS channels and device settings.

The persistent delivery ledger recovers notification commits, leases batches across instances, retries temporary failures up to five attempts, and retires expired endpoints. Provider acceptance is not a device-delivery receipt. A network failure after provider acceptance may retry; stable tags/topics reduce repeated visible notifications. Events from before device opt-in are not replayed. Subscriptions expire after 90 days; an opted-in client refreshes registration on boot, reconnect, or foreground return, at most once per hour, without requesting permission again. Sign-out/account changes revoke registrations; a capability permits revocation even after the login token expires. Already accepted generic OS notifications cannot be recalled remotely.

The **บนอุปกรณ์** switch now performs device registration as part of enabling the channel. An opt-in card offers registration without requesting OS permission automatically. Cached device data is not proof of readiness: registration must succeed in the current session, and the test button checks an authenticated, owner-scoped subscription status before creating an immediate self-notification. The test result describes creation, not physical receipt.

Web foreground popups use `ServiceWorkerRegistration.showNotification`, including Android browsers that do not implement the `Notification` constructor. Foreground and remote deliveries share a stable tag and generic lock-screen copy. If the Push provider fails or takes more than 20 seconds, a granted OS permission can still enable foreground popups; the UI explicitly reports background reception as unready. A foreground-only self-test does not claim closed-tab receipt. Pending registration retains the existing account-generation cancellation checks.

The updated Android binary enables Capacitor foreground presentation and registers a high-importance, explicitly silent `panthorium_popups_silent_v2` channel. Existing low-importance channels cannot be upgraded by JavaScript; the new channel ID therefore requires an app update. New clients advertise the channel version when subscribing, while older clients retain their existing channel IDs. The backend uses the HTTP v1 `channel_id` field. Users' OS channel settings and Do Not Disturb still take precedence.

The updated desktop binary uses trusted-shell IPC for native popups, with an AppUserModelID matching the installed edition's shortcut. Opting in keeps the signed-in renderer running in the system tray when the window closes; it polls the authorized inbox every 30 seconds while hidden. The tray menu can reopen the window or explicitly quit. Quitting, signing out, or changing accounts disables this background session. It does not claim delivery after explicit quit or when the computer is asleep/offline. IPC accepts only a validated notification ID and sound flag, displays generic content, and deduplicates within the session.

Deployment requirements:
- PostgreSQL initializes the push tables and persistent VAPID key automatically.
- For Android, finish Firebase onboarding in the production Google Cloud project, register `com.panthorium.browser`, and put its public `google-services.json` in `mobile/android/firebase/` (or provide `PANTHORIUM_FIREBASE_CONFIG` at build time). Do not use a service-account JSON file here.
- Set `PANTHORIUM_FCM_PROJECT_ID` on the backend and grant its runtime identity only the FCM message-send permission in that project. Until configured, the native capability is reported unavailable.
- For unattended retries after scale-to-zero, call `POST /internal/push/tick` from Cloud Scheduler using a Google OIDC token. Configure `PUSH_SCHEDULER_AUDIENCE` and `PUSH_SCHEDULER_SERVICE_ACCOUNTS`; this route only drains push work. Ordinary event-producing requests also await a bounded immediate delivery attempt.
- Build/install the updated Android APK; an older APK cannot gain the native Firebase plugin through a web refresh.

Validation must include a closed-tab Web Push test and a real Android device test with the app closed before declaring production background delivery complete. Force-stop, revoked permissions, offline devices, and OS power restrictions can prevent or delay delivery.

### Provisioning checkpoint — 2026-10-26

Firebase is active in the existing production project `project-0f6aa7d0-6055-420f-842` (number `699017940678`). The owner approved Firebase terms and the existing project's Blaze pricing confirmation. Optional Analytics was not enabled. Android app `com.panthorium.browser` has app ID `1:699017940678:android:df1062f927f08d2a03d1c7`; its public SDK configuration is checked into `mobile/android/firebase/google-services.json`. This is not a service-account credential.

The owner subsequently approved and applied the following production configuration:

1. Create custom role `panthoriumPushSender` containing only `firebasecloudmessaging.messages.create` in this project, and bind it to the existing `backend-runtime@project-0f6aa7d0-6055-420f-842.iam.gserviceaccount.com` runtime identity. This permits sending FCM messages in this project; it grants no data read or administration permissions and requires no downloaded private key.
2. Create `push-scheduler@project-0f6aa7d0-6055-420f-842.iam.gserviceaccount.com` for a single authenticated Cloud Scheduler HTTP job `panthorium-push-retry` in `asia-southeast1`, every minute, targeting `https://panthorium-backend-64ltez5ocq-as.a.run.app/internal/push/tick`. Use that same URL as the OIDC audience. The application allowlist authorizes only the push retry endpoint; this identity does not need project-wide roles.
3. Configure the existing backend with `PANTHORIUM_FCM_PROJECT_ID`, `PUSH_SCHEDULER_AUDIENCE`, and `PUSH_SCHEDULER_SERVICE_ACCOUNTS` set to the project, URL, and scheduler identity above. Stage configuration without routing production traffic to an unverified revision. Enable the scheduler after the backend deployment, then verify its authenticated execution.

Firebase, FCM, Firebase Installations and Cloud Scheduler APIs are enabled. The production runtime configuration was verified on revision `panthorium-backend-00195-dul` receiving 100% traffic. The existing Scheduler was resumed on 2026-10-26 at 08:41 Asia/Bangkok. Scheduler execution logs show authenticated endpoint HTTP 200 responses at `2026-10-26T01:41:51.456886679Z` and `2026-10-26T01:42:13.499811536Z`.

This proves the production retry trigger executes; it does not prove a physical device received a push. The Android 1.0.1 versionCode 3 release is available on both Internal and closed Alpha tracks. Real closed-app receipt still requires device acceptance. Staging Scheduler provisioning remains unapplied: automatic approval review rejected enabling its API and creating its service account. The GitHub deployment identity also lacks Scheduler access; its historical verification-workflow failure must not be described as a delivery failure or a successful activation.
