'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveBuildConfig } = require('./build-config.cjs');
const build = resolveBuildConfig(process.env);

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

// Firebase client configuration contains public app identifiers, never service-account keys.
const firebasePath = process.env.PANTHORIUM_FIREBASE_CONFIG || path.join(mobileRoot, 'firebase', 'google-services.json');
if (fs.existsSync(firebasePath)) {
  const firebase = JSON.parse(fs.readFileSync(firebasePath, 'utf8'));
  if (!firebase.project_info?.project_id || !firebase.client?.some(client => client.client_info?.android_client_info?.package_name === 'com.panthorium.browser')) throw new Error('Firebase config does not match com.panthorium.browser');
  fs.copyFileSync(firebasePath, path.join(androidRoot, 'app', 'google-services.json'));
}
let manifest = fs.readFileSync(manifestPath, 'utf8');
const permissions = ['android.permission.POST_NOTIFICATIONS', 'android.permission.CAMERA', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS'];
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
// Permission requests otherwise imply mandatory hardware in Google Play. The
// Browser's text and notification flows work without a camera or microphone.
for (const feature of ['android.hardware.camera', 'android.hardware.camera.autofocus', 'android.hardware.microphone']) {
  const declaration = '    <uses-feature android:name="' + feature + '" android:required="false" />\n';
  const existing = new RegExp('<uses-feature\\b[^>]*android:name="' + feature.replace(/\./g, '\\.') + '"[^>]*/>\\s*', 'g');
  manifest = manifest.replace(existing, '');
  manifest = manifest.replace(/(<application\b)/, declaration + '    $1');
}
manifest = manifest
  .replace(/android:icon="@mipmap\/[^"]+"/, 'android:icon="@mipmap/ic_launcher"')
  .replace(/android:roundIcon="@mipmap\/[^"]+"/, 'android:roundIcon="@mipmap/ic_launcher_round"');
if (!manifest.includes('firebase_messaging_auto_init_enabled')) manifest = manifest.replace('</application>', '    <meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false" />\n    <meta-data android:name="firebase_analytics_collection_enabled" android:value="false" />\n</application>');
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
if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('Android versionCode must be a positive integer.');
const versionName = process.env.PANTHORIUM_VERSION_NAME || packageJson.version + (runNumber ? '-preview.' + runNumber : '');
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9.-]+)?$/.test(versionName)) throw new Error('Android versionName must be a plain semver value.');
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
const signingPolicy = "apply from: '../panthorium-release.gradle'";
if (!gradle.includes(signingPolicy)) gradle += '\n// Panthorium release validation and upload-key signing.\n' + signingPolicy + '\n';
fs.copyFileSync(path.join(mobileRoot, 'release-signing.gradle'), path.join(androidRoot, 'panthorium-release.gradle'));
fs.writeFileSync(gradlePath, gradle);

const receiptPath = path.join(androidRoot, 'panthorium-release-info.json');
if (build.release) {
  const capacitorPath = path.join(androidRoot, 'app', 'src', 'main', 'assets', 'capacitor.config.json');
  if (!fs.existsSync(capacitorPath)) throw new Error('Run cap sync with the same release environment before preparation.');
  const capacitor = JSON.parse(fs.readFileSync(capacitorPath, 'utf8'));
  if (capacitor.android?.webContentsDebuggingEnabled !== false || capacitor.android?.allowMixedContent !== false || capacitor.server?.cleartext !== false || capacitor.server?.url || capacitor.loggingBehavior !== 'none' || JSON.stringify(capacitor.server?.allowNavigation) !== JSON.stringify([build.hostname])) throw new Error('Capacitor assets are not configured for the selected production release.');
  const releaseManifest = path.join(androidRoot, 'app', 'src', 'release', 'AndroidManifest.xml');
  fs.mkdirSync(path.dirname(releaseManifest), { recursive: true });
  fs.writeFileSync(releaseManifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">\n  <application android:usesCleartextTraffic="false" android:allowBackup="false" tools:replace="android:usesCleartextTraffic,android:allowBackup" />\n</manifest>\n');
  const publicRoot = path.join(androidRoot, 'app', 'src', 'main', 'assets', 'public');
  const indexPath = path.join(publicRoot, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error('Bundled Browser bootstrap is missing; run cap sync first.');
  let index = fs.readFileSync(indexPath, 'utf8');
  const bootstrapTag = '<script src="panthorium-cloud-start.js"></script>';
  if (!index.includes(bootstrapTag)) index = index.replace('</head>', bootstrapTag + '\n</head>');
  if (!index.includes(bootstrapTag)) throw new Error('Browser bootstrap must contain a head element.');
  fs.writeFileSync(indexPath, index);
  fs.writeFileSync(path.join(publicRoot, 'panthorium-cloud-start.js'), "'use strict';\nwindow.location.replace(" + JSON.stringify(build.startUrl) + ");\n");
  fs.writeFileSync(receiptPath, JSON.stringify({ mode: 'release', applicationId: 'com.panthorium.browser', versionCode, versionName, startUrl: build.startUrl, targetSdk: build.targetSdk, sourceRevision: /^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA || '') ? process.env.GITHUB_SHA : 'local-preparation' }, null, 2) + '\n');
} else if (fs.existsSync(receiptPath)) {
  fs.unlinkSync(receiptPath);
}

const appNamespace = /namespace\s+["']([^"']+)["']/.exec(gradle)?.[1]
  || /applicationId\s+["']([^"']+)["']/.exec(block)?.[1];
if (!appNamespace || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(appNamespace)) {
  throw new Error('Could not determine the Android app namespace for MainActivity.');
}
const activityPath = path.join(androidRoot, 'app', 'src', 'main', 'java', ...appNamespace.split('.'), 'MainActivity.java');
fs.mkdirSync(path.dirname(activityPath), { recursive: true });
let activity = fs.existsSync(activityPath)
  ? fs.readFileSync(activityPath, 'utf8')
  : `package ${appNamespace};\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n}\n`;
const immersiveMarker = 'PANTHORIUM_IMMERSIVE_MODE';
if (!activity.includes(immersiveMarker)) {
  if (!/class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/.test(activity)) {
    throw new Error('MainActivity must extend Capacitor BridgeActivity before immersive mode can be installed.');
  }
  if (/\bonResume\s*\(|onWindowFocusChanged\s*\(/.test(activity)) {
    throw new Error('MainActivity already overrides a fullscreen lifecycle method; merge immersive mode manually to avoid replacing app behavior.');
  }
  const requiredImports = [
    'import android.os.Bundle;',
    'import android.view.View;',
    'import androidx.core.graphics.Insets;',
    'import androidx.core.view.ViewCompat;',
    'import androidx.core.view.WindowCompat;',
    'import androidx.core.view.WindowInsetsCompat;',
    'import androidx.core.view.WindowInsetsControllerCompat;'
  ];
  const missingImports = requiredImports.filter(importLine => !activity.includes(importLine));
  if (missingImports.length) activity = activity.replace(/^(package [^;]+;)/m, '$1\n\n' + missingImports.join('\n'));
  const methods = `
    // ${immersiveMarker}: status and navigation bars reappear temporarily on a swipe.
    @Override
    public void onResume() {
        super.onResume();
        panthoriumHideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) panthoriumHideSystemBars();
    }

    private boolean panthoriumWindowInsetsInstalled;

    private void panthoriumInstallWindowInsets() {
        if (panthoriumWindowInsetsInstalled || getBridge() == null || getBridge().getWebView() == null) return;
        android.webkit.WebView webView = getBridge().getWebView();
        android.view.ViewParent parent = webView.getParent();
        android.view.View root = parent instanceof android.view.View ? (android.view.View) parent : webView;
        final int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            // Keep the native surface edge to edge and forward stable system-bar
            // and display-cutout dimensions for the fullscreen window safe area.
            view.setPadding(0, 0, 0, 0);
            Insets stableInsets = insets.getInsetsIgnoringVisibility(types);
            float density = webView.getResources().getDisplayMetrics().density;
            int safeTopCssPx = density > 0 ? Math.round(stableInsets.top / density) : stableInsets.top;
            String safeAreaScript = "(function(){var root=document.documentElement;if(root){root.style.setProperty('--panthorium-native-safe-area-top','" + safeTopCssPx + "px');}})();";
            webView.post(() -> webView.evaluateJavascript(safeAreaScript, null));
            return insets;
        });
        ViewCompat.requestApplyInsets(root);
        panthoriumWindowInsetsInstalled = true;
    }

    private void panthoriumHideSystemBars() {
        android.view.Window window = getWindow();
        // Use AndroidX so Android 10+ and newer Android releases follow the
        // same immersive path, including devices that enforce edge-to-edge.
        WindowCompat.setDecorFitsSystemWindows(window, false);
        View decorView = window.getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars());
        panthoriumInstallWindowInsets();
    }
`;
  activity = activity.replace(/\n}\s*$/, '\n' + methods + '}\n');
  fs.writeFileSync(activityPath, activity);
}
console.log('Android permissions, icons, immersive fullscreen, and app version ' + versionName + ' (' + versionCode + ') are prepared.');
