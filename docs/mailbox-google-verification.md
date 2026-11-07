# Panthorium Gmail: preparation for public verification

Prepared 2026-11-07. This is a preparation record, not evidence of Google approval.

## Observed configuration

- Project: `project-0f6aa7d0-6055-420f-842` / `699017940678` (do not substitute the other project named panthorium-backend).
- App: Panthorium; External; **Testing**; one test user, `rambo4075krub@gmail.com`.
- Homepage: https://panthorium.net ; privacy: https://panthorium.net/privacy .
- Authorized domain: `panthorium.net`. Search Console shows a domain property and delegated-owner access for the signed-in account. Independent verified-owner eligibility for the OAuth review has not been established.
- Support and developer contact: `rambo4075krub@gmail.com`.
- Scopes: OpenID `openid`, email, and `https://www.googleapis.com/auth/gmail.modify`.
- Separate standard and AI Web clients exist; callback is `/api/mailbox/oauth/google/callback`.
- Verification Center says verification is not required because the app is Testing. This is not a successful brand or restricted-scope review.
- The logo field is empty. The existing public terms page and its anchor were verified without login; https://panthorium.net/privacy#terms-of-use was saved to Branding and confirmed with the “Branding changes saved!” signal. Testing status was preserved.
- Audience has a Publish app control. It was not clicked. No submission form, demo-video field, or final attestations were inspected.

## Prepared scope justification

Panthorium provides a user-facing mailbox linked to the same verified email address as the user's Panthorium account. Users explicitly connect their Google account through OAuth. The standard client supports listing, searching, opening, composing, sending, replying, marking read/unread, changing labels and moving mail to or from Trash. Permanent deletion is not supported. `gmail.readonly` cannot perform the user-requested mail mutations, and `gmail.send` alone cannot read, search or organize mail. `gmail.modify` supports the implemented read-and-manage workflow without the broader `mail.google.com` scope.

The separate AI client requires an additional user-facing disclosure and OAuth grant. Only after that grant may the user request email summaries, attachment analysis or mailbox actions through text/voice. Gemini through Google Cloud or Panthorium's Qwen processes the selected content according to the chosen mode. Email content is untrusted input and is not used for general model training. Model-generated actions require the existing exact-action confirmation mechanism; email text cannot authorize a send, deletion or move. An explicit Qwen selection never silently switches to a paid provider.

OpenID and email identify the authorized Google account and enforce that it matches the user's verified registration email. The application does not request full-mail permanent-deletion access or unrelated Google Drive scopes.

This draft must be checked against the actual review form and current deployed behavior before submission. Do not attest that untested workflows or assessments have passed.

## Evidence still needed

1. Confirm ownership of `panthorium.net` in Google Search Console using an appropriate project owner/editor. An authorized-domain entry alone is insufficient evidence.
2. Check the public homepage, privacy and terms on an unauthenticated browser. Privacy includes a Google API Services User Data Policy / Limited Use statement. The terms URL has been saved to Branding; repeat the public-page check after material changes.
3. Record a real walkthrough using explicitly permitted test data: application identity and client IDs; standard OAuth consent; separate AI disclosure and OAuth consent; search/read; summary/attachment processing; exact-action preview and cancellation; independent AI disconnect; reconnect and data deletion controls. Show the browser address bar and scope use. Never show credentials, tokens, unrelated real email or personal attachments. A synthetic unit-test recording is not a substitute for the real OAuth walkthrough.
4. Create an accessible demo-video link. **No demo video or URL has been created yet.**
5. Review the actual production/verification forms, copy the accurate scope justification, and supply the requested contact and evidence fields. Publishing and submitting are separate from approval; do not present either as completed verification.
6. Complete Google's applicable restricted-scope security assessment process for server-side Gmail processing. No assessor has been engaged and no assessment or Letter of Assessment has been obtained. Confirm the required scope and any fee before purchasing an assessment.

## Current functional evidence and limitations

- Owner's standard and AI connections were both observed active on 2026-11-07; authenticated service calls successfully listed/read a real Gmail message.
- A local summary attempt returned `local_resource_unavailable`; the broker reported `ram_pressure` at approximately 67.7% RAM usage against its 65% threshold. Keep the existing resource safeguards; do not raise RAM/VRAM limits to force a test.
- A synthetic Thai email completed through the production Gemini gateway and normal quota checks. The returned summary preserved the fixture month/day and preparation task. This did not use private email content.
- After explicit owner authorization, one real Gmail message was read and summarized through the normal production Gemini gateway on 2026-11-07. The result was Thai (266 characters), referenced the selected source correctly and was not truncated; latency was approximately 30 seconds. Mail state was unchanged; no message or private content is included in this record.
- Automated regression tests cover separate grants, account isolation, token encryption, single-use OAuth state, exact-action confirmation and replay handling. These are not proof of real email delivery, physical-device microphone/audio behavior, or Google approval.
- Microsoft support was canceled by the owner. This feature is restricted to Gmail mailboxes (including Workspace Gmail) matching the verified registration email; Microsoft API/native flows are rejected.

## Official references

- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- https://developers.google.com/terms/api-services-user-data-policy
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://support.google.com/cloud/answer/15549257

Console continuation: https://console.cloud.google.com/auth/verification?project=project-0f6aa7d0-6055-420f-842
