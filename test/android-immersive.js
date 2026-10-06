const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'mobile', 'android', 'scripts', 'prepare-android.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-android-immersive-'));

function write(relative, value) {
  const file = path.join(temp, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
function run() {
  const result = spawnSync(process.execPath, [script, temp], {
    encoding: 'utf8', env: { ...process.env, PANTHORIUM_VERSION_CODE: '20001', PANTHORIUM_VERSION_NAME: '2.0.1' }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  write('app/src/main/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@mipmap/old" android:roundIcon="@mipmap/old_round"></application></manifest>');
  write('app/build.gradle', `android {\n    namespace 'com.panthorium.browser'\n    defaultConfig {\n        applicationId 'com.panthorium.browser'\n        minSdkVersion 23\n        targetSdkVersion 35\n        versionCode 1\n        versionName '1.0'\n    }\n}`);
  write('app/src/main/java/com/panthorium/browser/MainActivity.java', 'package com.panthorium.browser;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n}\n');
  run();
  const javaPath = path.join(temp, 'app/src/main/java/com/panthorium/browser/MainActivity.java');
  let java = fs.readFileSync(javaPath, 'utf8');
  assert.match(java, /PANTHORIUM_IMMERSIVE_MODE/, 'the generated Capacitor activity receives the Panthorium immersive hook');
  assert.match(java, /onResume\(\)/, 'immersive mode is restored when Android resumes the app');
  assert.match(java, /onWindowFocusChanged\(boolean hasFocus\)/, 'immersive mode is restored when the app regains focus');
  assert.match(java, /BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/, 'system bars can temporarily appear by swipe');
  assert.match(java, /ViewCompat\.setOnApplyWindowInsetsListener/, 'native insets are installed for the app content root');
  assert.match(java, /WindowInsetsCompat\.Type\.systemBars\(\) \| WindowInsetsCompat\.Type\.displayCutout\(\)/, 'system-bar and display-cutout insets are handled');
  assert.match(java, /view\.setPadding\(0, 0, 0, 0\)/, 'the native app surface fills every edge in portrait and landscape');
  assert.match(java, /setInsets\(types, Insets\.NONE\)/, 'system bars and display-cutout insets are cleared before reaching WebView');
  assert.match(java, /SYSTEM_UI_FLAG_IMMERSIVE_STICKY/, 'older Android releases use sticky immersive mode');
  const first = java.match(/PANTHORIUM_IMMERSIVE_MODE/g).length;
  run();
  java = fs.readFileSync(javaPath, 'utf8');
  assert.equal(java.match(/PANTHORIUM_IMMERSIVE_MODE/g).length, first, 're-running Android preparation does not duplicate lifecycle hooks');
  assert.match(fs.readFileSync(path.join(temp, 'app/build.gradle'), 'utf8'), /versionCode 20001/);
  console.log('Android immersive prep: edge-to-edge system bar hiding, swipe reveal, versioning and idempotency passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
