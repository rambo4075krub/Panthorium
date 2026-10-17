# Panthorium Browser privacy release — 2026-10-17

## Public and in-app notices

- `/privacy`: standalone Thai HTML policy, no login, JavaScript, microphone, account bootstrap, or PDF.
- `/account-deletion`: standalone public instructions and mailto request to account@panthorium.net; usable after uninstalling the app.
- `/?privacy=account-deletion`: existing authenticated request form with account ownership checks and receipt/status.
- `privacy-notice.js`: shared versioned source used by the public HTML and in-app policy registry.
- Desktop/orb, authentication and biometric requirements are not changed by this release.

After staging and production checks pass, use `https://panthorium.net/privacy` for Play's privacy URL. Use `https://panthorium.net/account-deletion` for its separate account-deletion URL. Recheck public HTTP 200, title and text before entering these links.

## Account deletion audit: operational gap remains

The current PrivacyRequestService is a durable request queue. `completed` closes a request; it does not erase data. AuthRepository.deleteUser alone is insufficient: it removes account/session records, not every associated object across services. Do not mark a request completed or tell a user their account data has been erased based only on either action. This change does not implement or run a cross-system erasure engine and does not delete real users.

Manual handling procedure for the operator:

1. Review the authenticated queue or the dedicated contact mailbox. Verify the requester owns the account; do not ask for a password/OTP. If email access is lost, resolve identity before disclosing or deleting data.
2. Identify account-owned records and objects across authentication, voice profiles/templates and consent, conversations, voice sessions, Files/Cloud Storage, notes/memory/knowledge, Creative Studio/media jobs, scheduled jobs, integrations, organizations and billing. Resolve shared organization ownership separately; never delete another user's data by matching display name.
3. Cancel pending/running work and revoke sessions/connections as applicable so deleted information is not recreated by background work. Export requested copies before erasure.
4. Delete the verified account-owned data using the relevant service operations or an operator-reviewed maintenance procedure. A login ban or user row deletion is not enough. Do not run ad-hoc broad SQL against production.
5. Check Google Cloud backup/PITR, object version/soft-delete/lifecycle settings, log retention and external provider retention. Record actual retention deadlines and any narrow legal/security exceptions. There is currently no verified universal backup purge interval; do not promise one.
6. Verify absence/inaccessibility of the deleted account data and failure of its old sessions; preserve only the minimum evidence needed to record the request and any documented exception. Notify the requester with scope, exceptions and remaining retention periods before closing the queue item.

Before claiming the complete deletion flow is production-ready, run this procedure against an authorized disposable test account with sample content, an active session and scheduled work, and retain evidence. No such end-to-end production erasure has been performed by this change. The public notice accurately says requests require manual processing; this alone does not certify Play or legal compliance.

## Data safety reconciliation before Play submission

Check actual enabled release functionality and provider configuration. The browser shell does not exempt the integrated Cloud service. Reconcile account identifiers, email, user content/files, conversation audio, biometric templates, device/session identifiers, logs, purchases, and optional connected tools with the form. Do not declare every category collected merely because a catalog entry exists, nor declare no collection because storage is on Google Cloud. Distinguish transient processing from persistent data, and service providers from user-directed sharing according to Play definitions. Review age targeting separately; the policy does not establish child-specific compliance.

Official references checked 2026-10-17:
- https://support.google.com/googleplay/android-developer/answer/10144311
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://support.google.com/googleplay/android-developer/answer/10787469
