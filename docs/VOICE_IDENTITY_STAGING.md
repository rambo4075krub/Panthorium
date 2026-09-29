# Voice Identity staging acceptance

The separate `panthorium-speaker-staging` service extracts a SpeechBrain ECAPA
speaker embedding from a 1–18 second recording. The service is private Cloud
Run; the backend calls it with its runtime service account's identity token.
The service rejects empty/quiet audio and returns `signalPresent: true` with
an embedding. It does **not** implement replay or deepfake liveness detection.
Do not present `signalPresent` as liveness to users.

The backend encrypts enrolled templates with `BIOMETRIC_TEMPLATE_KEY` and
stores them per owner in Cloud SQL. Guest profiles are scoped to a random
per-tab guest identity, contain only `user` or `family` subjects, and do not
expire automatically; they remain until explicitly deleted or transferred
when an account-upgrade flow is added. The guest identity currently lives in
the browser tab session, so keep that tab session available to continue using
its profiles before account linking is implemented. The raw audio is decoded in memory in the speaker
service and is not persisted. Enrollment requires explicit consent and 3–5 samples. The registration screen shows a shuffled reading prompt for each
12-second sample, for 36–60 seconds of total speech. The prompt is not
transcribed or compared with the words spoken; it is sampling guidance, not a
challenge-response liveness check. `/api/speech/transcribe` verifies a
signed-in owner's enrolled voice before calling paid transcription. The UI
also checks before STT **when `BIOMETRIC_GATE_ENABLED=1`**. The flag defaults
to 0 so a failed model build or uncalibrated threshold cannot interrupt the
existing staging microphone. Enroll and evaluate consented voices first; then
enable the flag in a separate staging revision. With the gate enabled, a guest
or unenrolled account has no voice access;
text access remains available. A registered voice never grants an account
role or administrator permission.

The staging deploy workflow builds the model image, grants the backend runtime
service account `roles/run.invoker` on the private speaker service, and updates
`BIOMETRIC_SPEAKER_URL` on the staging backend. The encryption secret must
already be attached to `BIOMETRIC_TEMPLATE_KEY`. The workflow uses the staging
project and does not alter production.

## Before promotion

1. Verify `/api/biometrics/status` as a signed-in staging admin: `configured`,
   `providerConfigured`, and `encryptionConfigured` should all be true.
2. Enroll the administrator, an ordinary user, and a consenting family member
   in the appropriate signed-in owner's account. Test clean speech, different
   devices, background talk, two simultaneous voices, recorded playback, and
   silence. Record false accepts and false rejects; tune
   `BIOMETRIC_VOICE_THRESHOLD` and `BIOMETRIC_ENROLLMENT_THRESHOLD` only from
   measured data, never by guessing a universal cosine threshold.
3. Verify an unknown voice never calls STT or Sentinel. Confirm the known
   voice works for commands and questions in Thai, English, and mixed speech.
   Confirm ordinary users cannot gain admin functions by enrolling an admin
   label.
4. Replay resistance is a separate requirement. Until a verified liveness
   component is integrated, do not treat voice matching as authentication for
   sensitive actions; keep login, RBAC, and explicit confirmations.
5. The Docker image/model is substantial and `min-instances=0` can cold start.
   Measure latency and staging cost before production sizing.

The served shell marks voice identity as required and disables the public
SpeechRecognition fallback on browsers without MediaRecorder, because that
fallback provides text without audio for verification. The static legacy
fixture still exercises historical speech behavior; staging acceptance must
verify the served shell on real devices.
