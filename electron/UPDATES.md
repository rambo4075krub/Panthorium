# Desktop update publisher authentication

The desktop client verifies an Ed25519 signature before downloading or executing
an installer. SHA-256 still verifies the binary against the authenticated manifest.
Unsigned, changed or unknown-key manifests are never installed. Quiet version
checks continue to work and report `installable: false` with the verification reason.

Before publishing a release:

1. Have the release owner provision and securely retain an Ed25519 signing key.
   Do not commit the private key or generate a throwaway production identity.
2. Add its PEM public key to `electron/update-trust.json`, under a stable key ID:
   `{ "version": 1, "keys": { "release-2026": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n" } }`.
   Review this trust change separately. Existing installed clients must already
   trust the signing key; the initial migration needs a publisher-verified install.
3. Set the protected publication workflow secret
   `PANTHORIUM_UPDATE_SIGNING_PRIVATE_KEY` to the private-key PEM and the variable
   `PANTHORIUM_UPDATE_SIGNING_KEY_ID` to that exact key ID. Grant access only to the
   manifest-signing publication step. The signing script verifies the key matches
   the committed public key and fails when either is missing.
4. Sign the Windows/macOS packages with the platform publisher identity as well.
   Manifest signing authenticates the binary downloaded by this updater; it does
   not substitute for OS package signing, notarization or protected release access.

Key rotation requires shipping both old and new public keys in a release signed by
an already trusted key before publishing updates signed by the new one. Do not
fetch public keys from the same mutable release endpoint as the manifest.

This repository intentionally contains an empty trust store until the owner
provisions a real release identity. Automated installation is unavailable in that
state; there is no unsigned fallback.
