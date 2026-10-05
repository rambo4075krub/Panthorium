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
    'import androidx.core.view.WindowInsetsCompat;'
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
        android.view.View webView = getBridge().getWebView();
        android.view.ViewParent parent = webView.getParent();
        android.view.View root = parent instanceof android.view.View ? (android.view.View) parent : webView;
        final int baseLeft = root.getPaddingLeft();
        final int baseTop = root.getPaddingTop();
        final int baseRight = root.getPaddingRight();
        final int baseBottom = root.getPaddingBottom();
        final int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets safe = insets.getInsets(types);
            view.setPadding(baseLeft + safe.left, baseTop + safe.top,
                baseRight + safe.right, baseBottom + safe.bottom);
            return new WindowInsetsCompat.Builder(insets).setInsets(types, Insets.NONE).build();
        });
        ViewCompat.requestApplyInsets(root);
        panthoriumWindowInsetsInstalled = true;
    }

    private void panthoriumHideSystemBars() {
        panthoriumInstallWindowInsets();
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            android.view.WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(android.view.WindowInsets.Type.statusBars() | android.view.WindowInsets.Type.navigationBars());
            }
            return;
        }
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
    }
`;
  activity = activity.replace(/\n}\s*$/, '\n' + methods + '}\n');
  fs.writeFileSync(activityPath, activity);
}
console.log('Android permissions, icons, immersive fullscreen, and app version ' + versionName + ' (' + versionCode + ') are prepared.');
