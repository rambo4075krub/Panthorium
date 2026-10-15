'use strict';

const { getDatabasePool } = require('./databasePool');
const { randomUUID } = require('crypto');
const TOKEN_COUNTS = Object.freeze(['promptTokenCount','responseTokenCount','totalTokenCount','cachedContentTokenCount','thoughtsTokenCount','toolUsePromptTokenCount','prompt_token_count','response_token_count','total_token_count','cached_content_token_count','thoughts_token_count','tool_use_prompt_token_count']);
const TOKEN_DETAILS = Object.freeze(['promptTokensDetails','responseTokensDetails','prompt_tokens_details','response_tokens_details']);
const MODALITIES = new Set(['TEXT','AUDIO','IMAGE','VIDEO','DOCUMENT']);
const validCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function scrubUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return {};
  const safe = {};
  for (const key of TOKEN_COUNTS) if (validCount(usage[key])) safe[key] = usage[key];
  for (const key of TOKEN_DETAILS) {
    if (!Array.isArray(usage[key])) continue;
    const details = usage[key].slice(0,32).flatMap(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !MODALITIES.has(item.modality)) return [];
      const entry = { modality:item.modality };
      for (const countKey of ['tokenCount','token_count']) if (validCount(item[countKey])) entry[countKey] = item[countKey];
      return Object.keys(entry).length > 1 ? [entry] : [];
    });
    if (details.length) safe[key] = details;
  }
  return safe;
}

// Usage is separate from entitlements and payment provider configuration.
// No transcript, prompt, secret or guessed currency amount is stored here.
class UsageLedgerRepository {
  constructor({ databaseUrl = '', databaseSslMode = 'disable', pool, required = false } = {}) {
    this.pool = pool || (databaseUrl ? getDatabasePool({ connectionString: databaseUrl, ssl: databaseSslMode === 'disable' ? false : { rejectUnauthorized: true } }) : null);
    this.required = required;
    this.ready = false;
  }
  async init() {
    if (!this.pool) { if (this.required) throw new Error('usage_database_required'); return; }
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_usage_events (
      event_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT,action_id TEXT,
      provider TEXT NOT NULL,model TEXT,modality TEXT NOT NULL,usage JSONB NOT NULL,
      outcome TEXT NOT NULL,elapsed_ms INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS panthorium_usage_owner_time ON panthorium_usage_events(user_id,created_at);`);
    this.ready = true;
  }
  async record({ eventId = randomUUID(), userId, sessionId, actionId, provider = 'gemini-live', model, modality = 'audio', usage = {}, outcome = 'completed', elapsedMs = 0 }) {
    if (!this.pool || !this.ready) { if (this.required) throw new Error('usage_store_unavailable'); return; }
    if (typeof userId !== 'string' || !userId || userId.length > 180 || typeof eventId !== 'string' || !eventId || eventId.length > 256) throw new Error('invalid_usage_identity');
    const safe = scrubUsage(usage);
    await this.pool.query(`INSERT INTO panthorium_usage_events(event_id,user_id,session_id,action_id,provider,model,modality,usage,outcome,elapsed_ms)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(event_id) DO NOTHING`,
      [String(eventId),String(userId),sessionId ? String(sessionId).slice(0,180) : null,actionId ? String(actionId).slice(0,180) : null,String(provider).slice(0,80),model ? String(model).slice(0,120) : null,String(modality).slice(0,40),JSON.stringify(safe),String(outcome).slice(0,40),Math.floor(Math.max(0,Math.min(Number(elapsedMs)||0,2147483647)))]);
  }
  async list(userId, limit = 100) {
    if (!this.ready) return [];
    const n = Math.floor(Math.max(1,Math.min(Number(limit)||100,200)));
    return (await this.pool.query('SELECT event_id,session_id,action_id,provider,model,modality,usage,outcome,elapsed_ms,created_at FROM panthorium_usage_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',[userId,n])).rows;
  }
}
module.exports = { UsageLedgerRepository, scrubUsage };
