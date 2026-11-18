'use strict';

function localOnly(env = process.env) { return env.PANTHORIUM_AI_MODE === 'local-only'; }
function assertCloudAiAllowed(env = process.env) {
  if (localOnly(env)) throw Object.assign(new Error('cloud_ai_disabled'), { code: 'cloud_ai_disabled', status: 503 });
}
function enforceAiMode(env = process.env) {
  if (env.PANTHORIUM_GEMINI_EXTENDED === '1' && env.PANTHORIUM_LOCAL_PROFILE !== '1') {
    Object.assign(env, {PANTHORIUM_AI_MODE:'gemini-live-only', GEMINI_LIVE_ENABLED:'1', AI_PRIORITY:'gemini-live', PANTHORIUM_HYBRID_AI:'0', PANTHORIUM_LOCAL_QWEN:'0', PANTHORIUM_QWEN_DISABLED:'1', SENTINEL_AUTO_TRAINING:'0', SENTINEL_AUTO_CAPTURE:'0', SENTINEL_TEACHER_PROVIDERS:'', SENTINEL_EVALUATOR_PROVIDERS:''});
    return;
  }
  if (!localOnly(env)) return;
  env.GEMINI_LIVE_ENABLED = '0';
  env.AI_PRIORITY = 'local';
  env.LOCAL_LLM_REASONING = '0';
  env.SENTINEL_AUTO_TRAINING = '0';
  env.SENTINEL_AUTO_CAPTURE = '0';
  env.SENTINEL_TEACHER_PROVIDERS = '';
  env.SENTINEL_EVALUATOR_PROVIDERS = '';
  // Google credentials also serve FCM and account integrations. Keep those;
  // the provider boundary prevents AI calls independently of credentials.
}
module.exports = { localOnly, assertCloudAiAllowed, enforceAiMode };
