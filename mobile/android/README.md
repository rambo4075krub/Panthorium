# Panthorium Browser for Android

This directory builds the Android **Browser shell**. AI inference, cloud apps, memory, files, jobs, and account data remain on Panthorium Cloud. The shell captures input, renders the existing interface, plays audio, and provides device controls. It does not include local AI, separate profession apps, or an offline data store.

There are two explicit build modes:

| Mode | Cloud destination | WebView debugging | Output |
| --- | --- | --- | --- |
| `debug` (default) | Existing staging origin, or a supplied HTTPS URL | Enabled for development | Debug APK |
| `release` | Reviewed production origin only; default `https://panthorium.net/` | Disabled; native logging disabled | Signed AAB, when upload-key secrets are configured |

Release preparation is implemented. An AAB is not produced merely by adding this workflow. A successful Android build, signature/manifest checks, real-device tests, and Play Console requirements must still be completed. This workflow does **not** upload to Google Play or change a release track.

## Debug APK

Requires Node.js 24, Java 21, and Android SDK tools. Capacitor versions and transitive dependencies are fixed by `package-lock.json`.

```sh
cd mobile/android
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install cap add android
npx --no-install cap sync android
node scripts/prepare-android.js
cd android
./gradlew assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. The existing preview workflow uses this mode. Repeated debug builds can use different debug certificates; use a Play test track for release-style update testing.

Set `PANTHORIUM_MOBILE_START_URL` for a different HTTPS debug environment. Credentials, query strings, and fragments are rejected in this build setting. No credentials or API keys belong in a URL or checked-in configuration.

## Prepare a signed release bundle in GitHub Actions

1. Merge and review the desired code on `main`. The manual **Android release bundle preparation** workflow runs only from `main` and uses the `android-release` GitHub environment.
2. Configure the environment to admit only the protected `main` branch, with the reviewers appropriate for this repository. Add these environment secrets:

| Secret | Required value |
| --- | --- |
| `PANTHORIUM_UPLOAD_KEYSTORE_BASE64` | Base64 encoding of the private upload keystore |
| `PANTHORIUM_UPLOAD_STORE_PASSWORD` | Keystore password |
| `PANTHORIUM_UPLOAD_KEY_ALIAS` | Upload-key alias within the keystore |
| `PANTHORIUM_UPLOAD_KEY_PASSWORD` | Password for that alias |

Use the existing upload key associated with this application in Play Console. For a genuinely new app, create and retain an upload key using Android Studio's signing workflow and configure Play App Signing. Do not generate a new identity on every CI run. Store the original key and recovery material securely outside this repository.

3. Run the workflow with an explicit `version_code` greater than **all versions already uploaded to Play**, a `version_name` such as `0.3.1`, and the reviewed production URL. A re-run uses the same version code; choose a new code before uploading a new build to Play.
4. Download the workflow artifact. It contains only `app-release.aab`, `release-info.json`, and `SHA256SUMS`. The receipt records source revision, destination, version, target SDK, digest, the actual bundle signer's certificate SHA-256, and verification results. Compare `uploadCertificateSha256` to the **upload key certificate** in Play Console, not Google's separate app signing certificate.

Before downloading the Android SDK or installing Capacitor, the release workflow checks all four signing secrets and proves that the configured private key can sign a temporary probe. It reports missing setting names or a fixed diagnostic, never passwords or raw Java error output. The probe is deleted immediately. The certificate fingerprint is public information; this check does not create or replace a key, build an AAB, or confirm Play eligibility.

The CI runner decodes the upload keystore into a private temporary file. Gradle reads signing passwords from environment variables. An always-run cleanup step removes the temporary key. Neither passwords nor the key are put into an Android asset, Gradle source, log command, or uploaded artifact. Missing secrets cause the build to fail.

## Release configuration

Release mode requires all three variables throughout Capacitor generation, sync, preparation, and Gradle execution:

```sh
export PANTHORIUM_ANDROID_BUILD=release
export PANTHORIUM_VERSION_CODE=30001
export PANTHORIUM_VERSION_NAME=0.3.1
export PANTHORIUM_MOBILE_START_URL=https://panthorium.net/
```

`30001` is an example, not a statement about the next valid version in Play Console. The numeric Android limit and a plain semver name are validated. The production origin allowlist is in `scripts/build-config.cjs`; currently only the existing `https://panthorium.net` origin is admitted. Staging, arbitrary hosts, alternate ports, admin paths, and credentials are rejected. Adding another production origin requires a reviewed code change.

Capacitor documents `server.url` as a live-reload setting. The release therefore bundles only the existing Browser bootstrap page and a tiny generated navigation script, then visits the exact allowlisted cloud origin. Release mode does not use `server.url`. The AI and application interfaces still come from Panthorium Cloud. This makes the wrapper's navigation policy explicit; it does not guarantee Play approval or every WebView behavior on every device.

`prepare-android.js` preserves the existing icons and immersive layout. It installs an idempotent Gradle signing policy, a release manifest overlay, the production bootstrap, and a preparation receipt. The release overlay disables debugging, cleartext traffic, and Android backup of the shell. The release Gradle policy targets API 36 and refuses release tasks without explicit release preparation and signing credentials.

For local signing, supply `PANTHORIUM_UPLOAD_KEYSTORE_PATH` as an absolute path outside the repository plus the three password/alias environment variables above. Do not put values into a command committed to Git or a shared terminal history. After generation and sync, run:

```sh
node scripts/prepare-android.js
node scripts/verify-release.cjs
python3 scripts/signing_preflight.py
cd android
./gradlew --no-daemon bundleRelease
cd ..
python3 scripts/verify-bundle.py
```

The final verifier checks the AAB's signature, embedded WebView configuration, production bootstrap, and actual merged manifest target/version/debugging settings. It fails if the expected Gradle output layout changes, instead of silently skipping a check. Signed output is at `android/app/build/outputs/bundle/release/`.

## Checks and device verification

Without an Android SDK, configuration tests can still be run from the repository root:

```sh
node mobile/android/test/release-preparation.cjs
node test/android-immersive.js
```

These cover production URL spoofing/staging rejection, debug-asset refusal, version bounds, signing-policy insertion, bootstrap integrity, idempotency, and preservation of the existing shell interface. They do not compile an APK/AAB or prove Play readiness.

With a full JDK (`keytool` and `jarsigner`), run the signing integration tests:

```sh
python3 -m unittest discover -s mobile/android/test -p 'test_signing_preflight.py' -v
```

These create and remove disposable test keys, check separate store/key passwords,
reject the standard debug alias, and compare a signed fixture's certificate to
the configured upload certificate. CI runs them without production secrets.

## ขั้นตอนถัดไปสำหรับเจ้าของบัญชี Play

ตัว Android คือ **Panthorium Browser**: รับอินพุต แสดงผล และเล่นเสียง ส่วน AI,
แอพงานและข้อมูลอยู่บน Google Cloud ที่เชื่อมไว้แล้ว รุ่น release ปัจจุบันเปิด
`https://panthorium.net/` เป็นหลัก การเตรียมนี้ไม่ได้เพิ่ม AI ที่ประมวลผลบนมือถือ
และไม่ได้ยืนยันว่าท่องทุกเว็บไซต์ได้เหมือนเบราว์เซอร์ทั่วไป

1. ตรวจว่ามี upload keystore เดิมสำหรับ `com.panthorium.browser` หรือไม่
   หากมีให้ใช้ของเดิม หากเป็นแอปใหม่ที่ยังไม่มีกุญแจ ให้สร้างและสำรองผ่าน
   Android Studio ตาม [คู่มือ Android](https://developer.android.com/studio/publish/app-signing)
   ไม่ใช้กุญแจ debug ของไฟล์ preview และไม่ส่งรหัสผ่านหรือไฟล์กุญแจในแชท
2. ใน GitHub repository ตั้ง environment `android-release` พร้อม secrets สี่ชื่อ
   ตามตารางด้านบน โดยจำกัดให้ branch `main` ใช้ได้
3. เมื่อโค้ดที่ต้องการอยู่บน `main` ให้รัน **Android release bundle preparation**
   ตั้ง `version_code` มากกว่าทุกเวอร์ชันที่เคยอัปโหลด และตั้ง `version_name`
   เป็นเวอร์ชันที่ต้องการเผยแพร่ ตัวเลขในเอกสารเป็นตัวอย่าง ไม่ใช่เลขที่จองใน Play
4. หาก build ผ่าน ให้ดาวน์โหลด artifact แล้วแตก ZIP เพื่อหา `app-release.aab`
   ไฟล์ APK preview ที่มีอยู่ใช้แทน AAB ไม่ได้ และเปลี่ยนนามสกุลเพื่อแปลงไม่ได้
5. ตรวจ receipt และนำ AAB เข้าช่องทดสอบของ Play เมื่อบัญชีพร้อม ทดสอบบนเครื่องจริง
   ก่อนขอเผยแพร่ ระบบ CI นี้ไม่อัปโหลดหรือเผยแพร่ไป Play ให้อัตโนมัติ

การสร้าง AAB ไม่ได้ทำให้ข้อกำหนดอื่นเสร็จโดยอัตโนมัติ: ยังต้องยืนยันบัญชี,
ทดสอบตามเงื่อนไขที่ Console แสดง, เตรียมข้อมูลหน้าร้านตามฟังก์ชันจริง,
ตรวจ Data safety และกระบวนการลบบัญชี รวมถึงให้ผู้ตรวจเข้าสู่ระบบได้

Before uploading an AAB, test the signed variant on a physical phone and tablet through an appropriate test track: sign-in/out, microphone permission denial/retry, Thai/English streaming, immediate stop, Bluetooth route changes, returning from background, immersive bars, production origin, and native purchase guards. Background microphone operation and Play Billing are not implemented by this preparation. The Browser must accurately show when its connection or microphone is unavailable.

## Official references

- [Capacitor configuration](https://capacitorjs.com/docs/config)
- [Android build variants and signing configuration](https://developer.android.com/build/build-variants)
- [Build an app bundle from the command line](https://developer.android.com/build/building-cmdline)
- [Android upload keys and Play App Signing](https://developer.android.com/studio/publish/app-signing)
