'use strict';

const fs = require('node:fs');
const path = require('node:path');

const androidRoot = path.resolve(process.argv[2] || path.join(__dirname, '..', 'android'));
const manifestPath = path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  throw new Error('Android manifest not found at ' + manifestPath + '. Run "npx cap add android" first.');
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
fs.writeFileSync(manifestPath, manifest);
console.log('Android microphone permissions are declared for user-initiated voice input.');
