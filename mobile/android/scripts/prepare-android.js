'use strict';

const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const androidRoot = path.resolve(process.argv[2] || path.join(mobileRoot, 'android'));
const manifestPath = path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = path.join(androidRoot, 'app', 'build.gradle');
const resourcesSource = path.join(mobileRoot, 'native-res');
const resourcesTarget = path.join(androidRoot, 'app', 'src', 'main', 'res');

if (!fs.existsSync(manifestPath)) {
  throw new Error('Android manifest not found at ' + manifestPath + '. Run "npx cap add android" first.');
}
if (!fs.existsSync(gradlePath)) {
  throw new Error('Android app/build.gradle not found at ' + gradlePath + '.');
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
const permissions = ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'];
for (const permission of permissions) {
  if (!manifest.includes('android:name="' + permission + '"')) {
    manifest = manifest.replace(
      /(<application\b)/,
      '    <uses-permission android:name="' + permission + '" />\n    $1'
    );
  }
}
for (const permission of permissions) {
  if (!manifest.includes('android:name="' + permission + '"')) {
    throw new Error('Failed to add required Android permission: ' + permission);
  }
}
manifest = manifest
  .replace(/android:icon="@mipmap\/[^"]+"/, 'android:icon="@mipmap/ic_launcher"')
  .replace(/android:roundIcon="@mipmap\/[^"]+"/, 'android:roundIcon="@mipmap/ic_launcher_round"');
fs.writeFileSync(manifestPath, manifest);

if (!fs.existsSync(resourcesSource)) throw new Error('Panthorium launcher icon resources are missing.');
fs.cpSync(resourcesSource, resourcesTarget, { recursive: true, force: true });

const packageJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'));
const runNumber = Number.parseInt(process.env.GITHUB_RUN_NUMBER || '0', 10);
const versionCode = Number(process.env.PANTHORIUM_VERSION_CODE || (runNumber ? 100000 + runNumber : (() => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(packageJson.version);
  if (!match) throw new Error('package.json must use a numeric semver version.');
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) || 1;
})()));
if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('Android versionCode must be a positive integer.');
const versionName = process.env.PANTHORIUM_VERSION_NAME || packageJson.version + (runNumber ? '-preview.' + runNumber : '');
let gradle = fs.readFileSync(gradlePath, 'utf8');
const defaultConfig = /defaultConfig\s*\{[\s\S]*?\n\s*\}/.exec(gradle);
if (!defaultConfig) throw new Error('Could not find the app defaultConfig block in build.gradle.');
let block = defaultConfig[0];
if (!/versionCode\s*(?:=\s*)?\d+/.test(block) || !/versionName\s*(?:=\s*)?["'][^"']+["']/.test(block)) {
  throw new Error('Could not find app versionCode and versionName in defaultConfig.');
}
block = block
  .replace(/versionCode\s*(?:=\s*)?\d+/, 'versionCode ' + versionCode)
  .replace(/versionName\s*(?:=\s*)?["'][^"']+["']/, "versionName '" + versionName + "'");
gradle = gradle.replace(defaultConfig[0], block);
fs.writeFileSync(gradlePath, gradle);
console.log('Android microphone permissions, Panthorium launcher icons, and app version ' + versionName + ' (' + versionCode + ') are prepared.');
