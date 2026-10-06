# Voice Identity staging acceptance

The separate `panthorium-speaker-staging` service extracts a SpeechBrain ECAPA
speaker embedding from a 1–18 second recording. The service is private Cloud
Run; the backend calls it with its runtime service account's identity token.
The service rejects empty/quiet audio and returns `signalPresent: true` with
an embedding. It does **not** implement replay or deepfake liveness detection.
Do not present `signalPresent` as liveness to users.

The backend encrypts enrolled templates with `BIOMETRIC_TEMPLATE_KEY` and
stores them per owner in Cloud SQL. Guest profiles are scoped to a random
per-tab guest identity and contain only `user` or `family` subjects. A guest
without an enrolled voice gets a new anonymous identity after 24 hours.
Registration asks for an email, password, and six-digit email OTP. After the
OTP is verified and voice enrollment succeeds, the backend creates a permanent
user with a bcrypt password hash and transfers the guest's existing voice
profiles to that user. The user can sign in by email and password from any
device. The user's refresh cookie persists for 30 days only when they choose
to remember the session; browser credential storage is used only with consent.
The app never stores the raw password in local storage or Cloud SQL.

During registration, the contact email is encrypted with
`BIOMETRIC_TEMPLATE_KEY`, and a random device credential may be stored in
browser local storage. Only its SHA-256 hash is stored in Cloud SQL until the
guest profile is transferred. A recognized device can restore a registered
guest profile if account creation was interrupted; a bare guest UUID cannot
reclaim a device-bound owner. Enrolled profiles never expire automatically.
Password recovery sends a six-digit, single-use OTP that expires in 10 minutes
and permits at most five attempts. To enable delivery on staging:

1. Add and verify a sending domain in Resend, then create an API key limited to
   sending email. A verified sending domain is required; no mailbox is needed
   for the sender address.
2. Create a Google Secret Manager secret in the staging project for that key
   and grant the staging Cloud Run runtime service account
   `roles/secretmanager.secretAccessor` on it.
3. Set GitHub Actions staging environment variables `STAGING_RESEND_SECRET`
   to that secret's name and `STAGING_EMAIL_FROM` to an address on the
   verified domain, then run Deploy Staging.

Without those settings OTP delivery returns 503 and account registration stays
unavailable.
The raw audio is decoded in memory in the speaker
service and is not persisted. Enrollment requires explicit consent and 3–5 samples. The registration screen shows a shuffled reading prompt for each
12-second sample, for 36–60 seconds of total speech. The prompt is not
transcribed or compared with the words spoken; it is sampling guidance, not a
challenge-response liveness check. `/api/speech/transcribe` verifies a
signed-in owner's enrolled voice before calling paid transcription. The server
performs one speaker check per recording; the client does not repeat that model
call. The app gate defaults to 0, while the staging deploy workflow explicitly
sets `BIOMETRIC_GATE_ENABLED=1`. A signed-in owner with no profiles may use a
separate, rate-limited identity-navigation endpoint that accepts only exact
registration or login phrases and discards every other transcript. It never
routes that audio to Sentinel. Once a profile exists, this narrow route closes.
Unknown speakers cannot use general STT. Chat text remains available, subject
to account permissions. A registered voice never grants an account
role or administrator permission.

The staging deploy workflow builds the model image, grants the backend runtime
service account `roles/run.invoker` on the private speaker service, and updates
`BIOMETRIC_SPEAKER_URL` on the staging backend. The encryption secret must
already be attached to `BIOMETRIC_TEMPLATE_KEY`. The workflow uses the staging
project and does not alter production.

## Voice reliability staging work

The speaker endpoint returns an approximate active-speech duration after edge-silence trimming. It is a diagnostic signal; the existing ECAPA embedding and 0.75 staging threshold still decide the match. Short-utterance calibration remains disabled until measured owner and impostor samples support it.

Known audio-input failures are surfaced separately from provider outages: too-short, unclear, unsupported-duration, and undecodable audio return HTTP 422 with a specific error code. Actual speaker-service timeouts and 5xx responses remain service-unavailable errors. The shell now gives retry guidance for short or unclear speech.

The speech transcription endpoint records capture time supplied by the client (bounded to 60 seconds), profile lookup, biometric verification, transcription, total duration, outcome, and request ID. It never records raw audio or transcript in these timing events. `Server-Timing` exposes server phases to developer tools; staging-only `voiceTiming` response diagnostics support device testing.

For threshold evaluation, prepare a local CSV manifest with columns `path,speaker_id,split,device` and `split=enroll` or `test`. Keep audio and the manifest outside the repository. Include held-out recordings for registered and unregistered speakers, with separate device and duration conditions. Run:

```sh
python3 -m unittest discover -s speaker-service -p 'test_*.py'
python3 speaker-service/evaluate_speaker_identity.py --manifest /private/path/voice-tests.csv --threshold 0.75
```

The evaluator reports false-accept and false-reject rates at candidate thresholds, broken down by active speech duration and device. It does not choose or change the threshold automatically. Do not promote a threshold from the owner’s samples alone.

`livenessSupported` is explicitly `false`: current speaker similarity does not detect replayed or synthesized speech. Until a separately evaluated anti-spoof/liveness model is integrated, voice similarity alone must not approve payments, account changes, or other sensitive actions; retain account permissions and an explicit second confirmation.

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
