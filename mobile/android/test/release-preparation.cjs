'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveBuildConfig } = require('../scripts/build-config.cjs');
const { verifyRelease } = require('../scripts/verify-release.cjs');

const release = { PANTHORIUM_ANDROID_BUILD: 'release', PANTHORIUM_VERSION_CODE: '30001', PANTHORIUM_VERSION_NAME: '0.3.1', PANTHORIUM_MOBILE_START_URL: 'https://panthorium.net/' };
const debug = resolveBuildConfig({}); assert(debug.startUrl.includes('staging')); assert.equal(debug.webContentsDebuggingEnabled, true);
assert.equal(resolveBuildConfig(release).webContentsDebuggingEnabled, false);
assert.equal(resolveBuildConfig(release).loggingBehavior, 'none');
assert.throws(() => resolveBuildConfig({ PANTHORIUM_ANDROID_BUILD: 'release' }), /VERSION_CODE/);
for (const url of ['http://panthorium.net/', 'https://panthorium.net.evil.test/', 'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app/', 'https://user:secret@panthorium.net/', 'https://panthorium.net/?key=secret', 'https://panthorium.net/#secret', 'https://127.0.0.1/', 'https://panthorium.net/admin']) {
  assert.throws(() => resolveBuildConfig({ ...release, PANTHORIUM_MOBILE_START_URL: url }), /requires HTTPS|production origin/);
}
assert.throws(() => resolveBuildConfig({ ...release, PANTHORIUM_VERSION_CODE: '2100000001' }), /limit/);
assert.throws(() => resolveBuildConfig({ ...release, PANTHORIUM_VERSION_NAME: "0.3.1'; injected()" }), /semver/);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-release-'));
const write = (relative, value) => { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
const config = { loggingBehavior: 'none', android: { webContentsDebuggingEnabled: false, allowMixedContent: false }, server: { cleartext: false, allowNavigation: ['panthorium.net'], androidScheme: 'https' } };
const sourceIndex = '<!doctype html><html><head><title>Browser shell</title></head><body>Unchanged interface</body></html>';
function prepare(env = release) {
  return spawnSync(process.execPath, [path.join(__dirname, '../scripts/prepare-android.js'), root], { encoding: 'utf8', env: { ...process.env, ...env } });
}
try {
  write('app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@mipmap/old" android:roundIcon="@mipmap/old_round" android:allowBackup="true"></application></manifest>');
  write('app/build.gradle', "android {\n namespace 'com.panthorium.browser'\n defaultConfig {\n applicationId 'com.panthorium.browser'\n versionCode 1\n versionName '0.1.0'\n }\n}\n");
  write('app/src/main/assets/capacitor.config.json', JSON.stringify(config));
  write('app/src/main/assets/public/index.html', sourceIndex);
  const first = prepare(); assert.equal(first.status, 0, first.stderr);
  assert.equal(verifyRelease(root, release).versionCode, 30001);
  const second = prepare(); assert.equal(second.status, 0, second.stderr);
  const firebase=JSON.parse(fs.readFileSync(path.join(root,'app/google-services.json'),'utf8'));
  assert.equal(firebase.project_info.project_id,'project-0f6aa7d0-6055-420f-842');
  assert.equal(firebase.client[0].client_info.android_client_info.package_name,'com.panthorium.browser');
  const manifest=fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8');
  assert(manifest.includes('android.permission.POST_NOTIFICATIONS'));
  assert(manifest.includes('android:name="firebase_messaging_auto_init_enabled" android:value="false"'),'native token creation waits for opt-in');
  assert.equal((manifest.match(/firebase_messaging_auto_init_enabled/g)||[]).length,1);
  for (const feature of ['android.hardware.camera', 'android.hardware.camera.autofocus', 'android.hardware.microphone']) {
    assert.equal(manifest.split('android:name="' + feature + '"').length - 1, 1, 'hardware declarations remain unique after repeated preparation');
    assert(manifest.includes('<uses-feature android:name="' + feature + '" android:required="false"'), 'optional hardware must not exclude existing Play users');
  }
  write('wrong-firebase.json',JSON.stringify({project_info:{project_id:'wrong'},client:[]}));
  assert.notEqual(prepare({...release,PANTHORIUM_FIREBASE_CONFIG:path.join(root,'wrong-firebase.json')}).status,0,'mismatched package config is refused');
  const index = fs.readFileSync(path.join(root, 'app/src/main/assets/public/index.html'), 'utf8');
  assert.equal(index.match(/panthorium-cloud-start.js/g).length, 1);
  assert.equal(index.replace('<script src="panthorium-cloud-start.js"></script>\n', ''), sourceIndex, 'release preparation preserves the bundled interface');
  const gradle = fs.readFileSync(path.join(root, 'app/build.gradle'), 'utf8');
  assert.equal(gradle.match(/apply from: '\.\.\/panthorium-release.gradle'/g).length, 1);
  const signing = fs.readFileSync(path.join(root, 'panthorium-release.gradle'), 'utf8');
  assert(signing.includes("System.getenv('PANTHORIUM_UPLOAD_STORE_PASSWORD')"));
  assert(signing.includes('signingConfig signingConfigs.panthoriumUpload'));
  assert(signing.includes('targetSdkVersion 36')); assert(signing.includes('debuggable false'));
  assert(!gradle.includes('keystore-password-test'), 'secret values are not serialized');
  const releaseManifest = fs.readFileSync(path.join(root, 'app/src/release/AndroidManifest.xml'), 'utf8');
  assert(!releaseManifest.includes('android:debuggable'), 'Gradle owns debug mode; source must pass HardcodedDebugMode lint');
  write('app/src/release/AndroidManifest.xml', releaseManifest.replace('<application ', '<application android:debuggable=\"true\" '));
  assert.throws(() => verifyRelease(root, release), /do not hardcode/);
  write('app/src/release/AndroidManifest.xml', releaseManifest);
  write('panthorium-release.gradle', signing.replace('debuggable false', 'debuggable true'));
  assert.throws(() => verifyRelease(root, release), /disable debugging/);
  write('panthorium-release.gradle', signing);
  write('app/src/main/assets/capacitor.config.json', JSON.stringify({ ...config, android: { ...config.android, webContentsDebuggingEnabled: true } }));
  assert.throws(() => verifyRelease(root, release), /Unsafe/);
  assert.notEqual(prepare().status, 0, 'release refuses a debug sync');
  write('app/src/main/assets/capacitor.config.json', JSON.stringify(config));
  write('app/src/main/assets/public/panthorium-cloud-start.js', "window.location.replace('https://evil.test');");
  assert.throws(() => verifyRelease(root, release), /bootstrap URL/);
  const toDebug = prepare({ ...release, PANTHORIUM_ANDROID_BUILD: 'debug' }); assert.equal(toDebug.status, 0);
  assert(!fs.existsSync(path.join(root, 'panthorium-release-info.json')), 'debug preparation invalidates the release receipt');
  assert.throws(() => verifyRelease(root, release));
  // Validate the workflow's actual dispatch inputs, when running under release CI.
  if (process.env.PANTHORIUM_ANDROID_BUILD === 'release') resolveBuildConfig(process.env);
  console.log('Android release preparation: production allowlist, debug refusal, version bounds, bootstrap, signing policy and idempotency passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
