# Sentinel AI personal chats and remote work

Users open **Sentinel AI → อุปกรณ์ของฉัน** in the latest desktop Panthorium Browser, sign in, select a workspace folder and consent to local capabilities. The desktop app starts at OS user login and stays in the system tray when its window closes. No terminal is needed. It requires the computer to be on and connected; this is not a Windows service that runs before login. Windows desktop input additionally requires an unlocked interactive session. macOS/Linux support file, memory, browser and explicitly granted process operations, but not desktop input in this release.

The default local grants cover workspace files and chat synchronization. Process execution and screen control are separate opt-ins. Process execution runs with the OS user's privileges; a working directory is not an OS sandbox. A remote account cannot add capabilities that were not granted locally. Users may allow selected capabilities automatically, pause the local receiver, revoke a device or cancel work. A native confirmation precedes registration. Device credentials are stored with Electron safeStorage, never in a renderer or a browser profile; insecure Linux basic_text storage is rejected.

## Chats and storage

Typed, hybrid voice and live voice transcripts use `personal-<uuid>` sessions. The browser stores their content in IndexedDB scoped to the account; the server stores only titles, versions, byte counts and vault locations. Existing conversations remain available via **ประวัติก่อนอัปเดต** and can be copied into a personal chat. Personal sessions do not append conversation content to the legacy repository or its training/memory capture paths. Relevant conversation context still passes to the configured AI provider to answer a request.

New chats can instead use a paired computer as their vault. The browser keeps a local cache and sends versioned snapshots to the computer through the relay. Another device can retrieve them while that computer is online. The user must back up/export their own data before clearing browser storage or changing devices. Deleting an index/browser copy does not erase exported copies or a computer vault. Ordinary browser/phone clients can issue commands, but a browser tab alone is not the unattended desktop receiver.

The current billing entitlement supplies the account's storage limit, including add-ons. Personal chat bytes, reported managed workspace bytes, outstanding write reservations and existing cloud files share that account limit. PostgreSQL billing/remote advisory locks serialize reservations with cloud uploads. Warnings occur at 80%, 95% and 100%; over-limit accounts keep their existing content and can delete/export it. This is an application quota, not an OS disk limit: arbitrary programs explicitly allowed through the process scope have the user's OS permissions. Workspace usage is checked before file writes and monitored during managed process execution.

## Relay and execution

Outbound HTTPS polling avoids opening a port on user devices. The server authenticates the device against current account permissions/version on each call. All metadata, proposals, approvals and results are owner scoped. The model can propose bounded structured workflows; only the authenticated user's approval endpoint or previously granted automatic scopes can release them. Every process, path and operation is checked again by the native executor.

Commands and results are encrypted at rest in the relay with account/job authenticated data. They are transient, not end-to-end encrypted: the server processes them for routing and AI execution. Commands expire after at most 24 hours; completed result envelopes expire after 15 minutes. Metadata expires after 30 days. A periodic cleanup removes expired envelopes even without new traffic. Cleanup also runs on access; database backups follow the host's separate backup retention policy.

Jobs have idempotency keys, approval hashes, a 45-second heartbeat lease, cancellation and a local write-ahead journal. A crash with an uncertain side effect is reported as `unknown` and is not automatically replayed. Receipts are capped at 500/30 days. Full transport receipt outputs are removed locally after acknowledgment. Non-chat workflows also save commands and results as quota-counted `task-results/<job-id>.json` in the owner workspace, including when the chat is closed. This copy remains until the user deletes it. `resultArchivePath` identifies a saved copy; `resultArchiveError` explicitly reports insufficient space or a local write failure without misreporting the completed work. The open chat additionally captures available task results into its archive. A closed chat does not stop an already submitted workflow, but this release does not run an unbounded cloud AI planning loop after the chat closes.

## Validation and rollout

- `npm run test:remote`: real HTTP/owner isolation, filesystem execution, approvals, encrypted transit, concurrency, recovery, chat versions, quota changes, native IPC consent and process cancellation.
- `TEST_DATABASE_URL=... node test/remote-workspace-postgres.js`: same end-to-end service workflow on real PostgreSQL.
- `node test/personal-chat-browser.js`: real Chromium/IndexedDB typed and voice history, reload, account switching, mobile layout and full-quota blocking.
- `npm run check`, `npm test`, `npm run test:postgres`, existing browser/security tests remain required in CI.

Merge a passing PR into main; the existing CI-gated notebook publisher advances `deploy/notebook-production`. Verify the actual notebook deployment status and public release ID, not only the publisher job. The desktop build workflow produces platform/user installers and signed update manifests. Each user must install/update the desktop app and pair their own computer once. No default administrator grant or hidden machine enrollment is introduced.
