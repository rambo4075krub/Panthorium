# Panthorium Android preview

This is a **test wrapper** for checking Panthorium Browser and Sentinel on a physical Android device. It points to the staging web app by default. It is not a production Play Store package: the production app should bundle its web assets, use a production origin, disable WebView debugging, complete native permission flows, and pass device testing first.

## Build a debug APK

Requires Node.js 24, Java 21, Android SDK tools, and an Android device or emulator.

```sh
cd mobile/android
npm install
npx cap add android
npx cap sync android
npm run android:prepare
cd android
./gradlew assembleDebug
```

The APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on a physical device and test sign-in, microphone permission, Thai/English recording, streamed text, spoken playback, stop/resume, and returning to the app after backgrounding it.

Set `PANTHORIUM_MOBILE_START_URL` to another HTTPS environment when needed. Do not put credentials or API keys in this value.

## App updates and multi-device testing

The Android application ID stays `com.panthorium.browser`. The preparation script writes a positive, increasing Android `versionCode` for each GitHub Actions build and updates `versionName`; this is required for Google Play to recognize a newer release. Install the same preview build separately on a phone and tablet, then sign in to the same Panthorium account to test server-synced data and the responsive layout.

Google Play updates require a production Android App Bundle signed with the same Play App Signing identity for this application ID. The current downloadable APK is a debug preview and is not a Play Store update package. Repeated CI debug APKs may have different debug signing keys, so they are for fresh installs and cross-device smoke tests; use a Play internal-testing track or a stable private signing key for seamless APK-over-APK updates. Never commit a release keystore or credentials.

## Current scope

- Android shell for staging smoke tests
- Panthorium icon with its original red/orange mark inside a teal ring; everything outside the circle is transparent
- User-initiated microphone permission declaration
- Existing Panthorium web UI, authentication, and API behavior

Calendar, notifications, medication reminders, Play Billing, background audio, and production signing are not implemented by this wrapper yet. Keep production rollout blocked until those functions and privacy disclosures are implemented and tested.
