'use strict';

const PRODUCTION_ORIGINS = Object.freeze(['https://panthorium.net']);
const STAGING_URL = 'https://panthorium-backend-staging-124818950958.asia-southeast1.run.app/';

function resolveBuildConfig(env = process.env) {
  const mode = env.PANTHORIUM_ANDROID_BUILD || 'debug';
  if (!['debug', 'release'].includes(mode)) throw new Error('PANTHORIUM_ANDROID_BUILD must be debug or release');
  const release = mode === 'release';
  let url;
  try { url = new URL((env.PANTHORIUM_MOBILE_START_URL || (release ? PRODUCTION_ORIGINS[0] + '/' : STAGING_URL)).trim()); }
  catch { throw new Error('Invalid Panthorium Android start URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Android start URL requires HTTPS without credentials, query or fragment');
  if (release && (!PRODUCTION_ORIGINS.includes(url.origin) || url.pathname !== '/')) throw new Error('Release start URL must be a reviewed production origin root; staging and unknown hosts are forbidden');
  if (release && !/^[1-9][0-9]{0,9}$/.test(env.PANTHORIUM_VERSION_CODE || '')) throw new Error('Release requires an explicit positive PANTHORIUM_VERSION_CODE');
  const versionCode = Number(env.PANTHORIUM_VERSION_CODE);
  if (release && (!Number.isSafeInteger(versionCode) || versionCode > 2100000000)) throw new Error('Release versionCode exceeds Android limit');
  if (release && !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][A-Za-z0-9.-]+)?$/.test(env.PANTHORIUM_VERSION_NAME || '')) throw new Error('Release requires a plain semver PANTHORIUM_VERSION_NAME');
  return { mode, release, startUrl: url.toString(), hostname: url.hostname, webContentsDebuggingEnabled: !release, loggingBehavior: release ? 'none' : 'debug', targetSdk: 36 };
}

module.exports = { resolveBuildConfig, PRODUCTION_ORIGINS };
