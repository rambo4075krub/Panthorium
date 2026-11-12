'use strict';

function localOnly(env = process.env) { return env.PANTHORIUM_AI_MODE === 'local-only'; }
function assertCloudAiAllowed(env = process.env) {
  if (localOnly(env)) throw Object.assign(new Error('cloud_ai_disabled'), { code: 'cloud_ai_disabled', status: 503 });
}
function enforceAiMode(env = process.env) {
  if (!localOnly(env)) return;
  env.GEMINI_LIVE_ENABLED = '0';
  env.AI_PRIORITY = 'local';
  env.SENTINEL_AUTO_TRAINING = '0';
  env.SENTINEL_AUTO_CAPTURE = '0';
  env.SENTINEL_TEACHER_PROVIDERS = '';
  env.SENTINEL_EVALUATOR_PROVIDERS = '';
  // Google credentials also serve FCM and account integrations. Keep those;
  // the provider boundary prevents AI calls independently of credentials.
}
module.exports = { localOnly, assertCloudAiAllowed, enforceAiMode };
