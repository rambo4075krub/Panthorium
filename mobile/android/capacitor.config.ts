import type { CapacitorConfig } from '@capacitor/cli';

const fallbackUrl = 'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app/';
const startUrl = (process.env.PANTHORIUM_MOBILE_START_URL || fallbackUrl).trim();
const parsedStartUrl = new URL(startUrl);

if (parsedStartUrl.protocol !== 'https:') {
  throw new Error('Panthorium Android preview requires an HTTPS start URL.');
}

const config: CapacitorConfig = {
  appId: 'com.panthorium.browser',
  appName: 'Panthorium Browser',
  webDir: 'www',
  server: {
    url: parsedStartUrl.toString(),
    cleartext: false,
    allowNavigation: [parsedStartUrl.hostname],
    androidScheme: 'https'
  },
  android: {
    backgroundColor: '#08090c',
    allowMixedContent: false,
    webContentsDebuggingEnabled: true
  }
};

export default config;
