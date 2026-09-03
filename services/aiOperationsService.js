class AiOperationsService {
  constructor({ audit, conversations } = {}) { this.audit = audit; this.conversations = conversations; }
  num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  empty() { return { generatedAt: new Date().toISOString(), windowHours: 24, requests: 0, successful: 0, failed: 0, successRate: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, avgLatencyMs: 0, p95LatencyMs: 0, fallbacks: 0, streams: 0, nativeStreams: 0, providers: [], conversations: 0, messages: 0, persistence: this.conversations?.pool ? 'postgresql' : 'memory' }; }
  aggregate(entries) {
    const result = this.empty(); const providers = new Map(); const latencies = [];
    const requestEvents = new Set(['sentinel.chat','sentinel.chat_stream','ai.gateway.complete','ai.gateway.stream_complete']);
    const completions = entries.filter((e) => e.event === 'ai.gateway.complete' || e.event === 'ai.gateway.stream_complete');
    result.requests = entries.filter((e) => e.event === 'sentinel.chat' || e.event === 'sentinel.chat_stream').length || completions.length;
    result.successful = completions.length; result.failed = entries.filter((e) => e.event === 'ai.gateway.provider_failed' || e.event === 'ai.gateway.stream_provider_failed').length;
    for (const e of completions) {
      const usage = e.usage || {}; result.inputTokens += this.num(usage.inputTokens); result.outputTokens += this.num(usage.outputTokens); result.totalTokens += this.num(usage.totalTokens);
      const latency = this.num(e.latencyMs); if (latency > 0) latencies.push(latency); result.fallbacks += this.num(e.fallbackCount); if (String(e.streaming || '') === 'native') result.nativeStreams += 1; if (e.event === 'ai.gateway.stream_complete') result.streams += 1;
      const name = e.provider || 'unknown'; const p = providers.get(name) || { provider: name, requests: 0, tokens: 0, latencyTotal: 0, latencyCount: 0, failures: 0 };
      p.requests += 1; p.tokens += this.num(usage.totalTokens); if (latency > 0) { p.latencyTotal += latency; p.latencyCount += 1; } providers.set(name, p);
    }
    for (const e of entries.filter((x) => x.event === 'ai.gateway.provider_failed' || x.event === 'ai.gateway.stream_provider_failed')) { const name = e.provider || 'unknown'; const p = providers.get(name) || { provider: name, requests: 0, tokens: 0, latencyTotal: 0, latencyCount: 0, failures: 0 }; p.failures += 1; providers.set(name, p); }
    latencies.sort((a,b) => a-b); result.avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : 0; result.p95LatencyMs = latencies.length ? latencies[Math.min(latencies.length-1, Math.ceil(latencies.length*.95)-1)] : 0;
    result.successRate = result.requests ? Math.round((result.successful / result.requests) * 1000) / 10 : 0;
    result.providers = [...providers.values()].map((p) => ({ provider: p.provider, requests: p.requests, failures: p.failures, tokens: p.tokens, avgLatencyMs: p.latencyCount ? Math.round(p.latencyTotal/p.latencyCount) : 0, health: p.failures && !p.requests ? 'down' : p.failures ? 'degraded' : p.requests ? 'healthy' : 'idle' })).sort((a,b) => b.requests-a.requests || b.failures-a.failures);
    return result;
  }
  async conversationCounts(userId) {
    if (this.conversations?.pool) {
      const r = await this.conversations.pool.query('SELECT COUNT(DISTINCT session_id)::int AS conversations, COUNT(*)::int AS messages FROM panthorium_conversation_messages WHERE user_id=$1', [userId]);
      return r.rows[0] || { conversations: 0, messages: 0 };
    }
    const sessions = await this.conversations?.listSessions(userId, 100) || []; let messages = 0;
    for (const s of sessions) messages += (await this.conversations.history(userId, s.sessionId, 100)).length;
    return { conversations: sessions.length, messages };
  }
  async overview(userId, hours = 24) {
    const safeHours = Math.max(1, Math.min(Number(hours) || 24, 168)); const from = new Date(Date.now() - safeHours * 3600000).toISOString();
    const entries = await this.audit.listRecent({ limit: 500, from, userId }); const result = this.aggregate(entries); result.windowHours = safeHours;
    const counts = await this.conversationCounts(userId); result.conversations = this.num(counts.conversations); result.messages = this.num(counts.messages); result.generatedAt = new Date().toISOString();
    return result;
  }
}
module.exports = { AiOperationsService };
