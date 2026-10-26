import type { CapacitorConfig } from '@capacitor/cli';

const { resolveBuildConfig } = require('./scripts/build-config.cjs');
const build = resolveBuildConfig(process.env);

const config: CapacitorConfig = {
  appId: 'com.panthorium.browser',
  appName: 'Panthorium Browser',
  webDir: 'www',
  loggingBehavior: build.loggingBehavior,
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] }
  },
  server: {
    // Release starts from a bundled Browser bootstrap, then visits our exact
    // cloud origin. Capacitor server.url remains a debug/live-reload setting.
    ...(build.release ? {} : { url: build.startUrl }),
    cleartext: false,
    allowNavigation: [build.hostname],
    androidScheme: 'https'
  },
  android: {
    backgroundColor: '#08090c',
    allowMixedContent: false,
    webContentsDebuggingEnabled: build.webContentsDebuggingEnabled,
    appendUserAgent: ' PanthoriumAndroid'
  }
};

export default config;
