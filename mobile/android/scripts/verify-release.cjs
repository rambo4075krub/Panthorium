'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { resolveBuildConfig } = require('./build-config.cjs');

function verifyRelease(androidRoot, env = process.env) {
  const build = resolveBuildConfig(env);
  if (!build.release) throw new Error('Release verification requires release mode');
  const read = relative => fs.readFileSync(path.join(androidRoot, relative), 'utf8');
  const config = JSON.parse(read('app/src/main/assets/capacitor.config.json'));
  const receipt = JSON.parse(read('panthorium-release-info.json'));
  if (config.server?.url || config.server?.cleartext !== false || config.android?.webContentsDebuggingEnabled !== false || config.android?.allowMixedContent !== false || config.loggingBehavior !== 'none') throw new Error('Unsafe release WebView configuration');
  if (JSON.stringify(config.server.allowNavigation) !== JSON.stringify([build.hostname])) throw new Error('Release navigation allowlist mismatch');
  if (!config.plugins?.PushNotifications?.presentationOptions?.includes('alert')) throw new Error('Foreground notification presentation is missing');
  const activity = read('app/src/main/java/com/panthorium/browser/MainActivity.java');
  if (!activity.includes('registerPlugin(PanthoriumNotificationsPlugin.class)')) throw new Error('Native popup channel plugin is not registered');
  if (!activity.includes('PanthoriumCloudBridge.install(getBridge());')) throw new Error('Cloud notification bridge is not installed');
  const cloudBridge = read('app/src/main/java/com/panthorium/browser/PanthoriumCloudBridge.java');
  if (!cloudBridge.includes('CLOUD_ORIGIN = ' + JSON.stringify(new URL(build.startUrl).origin) + ';') || !cloudBridge.includes('Collections.singleton(CLOUD_ORIGIN)')) throw new Error('Cloud notification bridge origin mismatch');
  const channels = read('app/src/main/java/com/panthorium/browser/PanthoriumNotificationsPlugin.java');
  if (!channels.includes('panthorium_popups_silent_v2') || !channels.includes('silent.setSound(null, null)')) throw new Error('Native silent popup channel is missing');
  if (receipt.mode !== 'release' || receipt.startUrl !== build.startUrl || receipt.applicationId !== 'com.panthorium.browser' || receipt.versionCode !== Number(env.PANTHORIUM_VERSION_CODE) || receipt.versionName !== env.PANTHORIUM_VERSION_NAME || receipt.targetSdk !== 36) throw new Error('Release receipt mismatch');
  const expectedBootstrap = "'use strict';\nwindow.location.replace(" + JSON.stringify(build.startUrl) + ');\n';
  if (read('app/src/main/assets/public/panthorium-cloud-start.js') !== expectedBootstrap) throw new Error('Release bootstrap URL mismatch');
  if (!read('app/src/main/assets/public/index.html').includes('<script src="panthorium-cloud-start.js"></script>')) throw new Error('Release bootstrap is not loaded');
  const manifest = read('app/src/release/AndroidManifest.xml');
  if (/android:debuggable\s*=/.test(manifest)) throw new Error('Let Gradle set release debugging; do not hardcode it in the source manifest');
  if (!/debuggable\s+false/.test(read('panthorium-release.gradle'))) throw new Error('Release Gradle policy must disable debugging');
  for (const attr of ['usesCleartextTraffic', 'allowBackup']) if (!manifest.includes(`android:${attr}="false"`)) throw new Error('Unsafe release manifest: ' + attr);
  if (!read('app/build.gradle').includes("apply from: '../panthorium-release.gradle'")) throw new Error('Release signing policy is not applied');
  return receipt;
}
if (require.main === module) {
  const receipt = verifyRelease(path.resolve(process.argv[2] || path.join(__dirname, '..', 'android')));
  console.log(`Release preparation verified: ${receipt.applicationId} ${receipt.versionName} (${receipt.versionCode}), target SDK ${receipt.targetSdk}`);
}
module.exports = { verifyRelease };
