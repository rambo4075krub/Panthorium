class AiGateway {
  constructor({ providers, audit } = {}) { this.providers = providers; this.audit = audit; }
  catalog() { return this.providers.catalog(); }
  orderedProviders(preferredProvider) {
    const available = this.providers.available();
    return preferredProvider && available.includes(preferredProvider) ? [preferredProvider, ...available.filter((p) => p !== preferredProvider)] : available;
  }
  async complete({ systemPrompt, history, preferredProvider, preferredModel, userId, sessionId }) {
    const ordered = this.orderedProviders(preferredProvider);
    if (!ordered.length) return { ok: false, error: "no_provider", text: "Sentinel Core: ยังไม่ได้ตั้งค่า AI Provider บนเซิร์ฟเวอร์" };
    const attempts = [];
    for (const provider of ordered) {
      const started = Date.now();
      try {
        const result = await this.providers.callDetailed(provider, systemPrompt, history, { model: provider === preferredProvider ? preferredModel : undefined });
        if (!result?.text) throw new Error("empty_provider_response");
        const response = { ok: true, text: result.text, provider, model: result.model || null, usage: result.usage || null, latencyMs: Date.now() - started, fallbackCount: attempts.length, streaming: "none" };
        this.audit?.record("ai.gateway.complete", { userId, sessionId, provider, model: response.model, latencyMs: response.latencyMs, fallbackCount: response.fallbackCount, usage: response.usage });
        return response;
      } catch (error) {
        attempts.push({ provider, error: error.message, latencyMs: Date.now() - started });
        this.audit?.record("ai.gateway.provider_failed", { userId, sessionId, provider, error: error.message, latencyMs: Date.now() - started });
      }
    }
    return { ok: false, error: "all_providers_failed", text: "Sentinel Core: ไม่สามารถเชื่อมต่อ AI Provider ได้ในขณะนี้", attempts: process.env.NODE_ENV === "production" ? undefined : attempts };
  }
  async stream({ systemPrompt, history, preferredProvider, preferredModel, userId, sessionId, onDelta = () => {}, onProvider = () => {} }) {
    const ordered = this.orderedProviders(preferredProvider);
    if (!ordered.length) return { ok: false, error: "no_provider", text: "Sentinel Core: ยังไม่ได้ตั้งค่า AI Provider บนเซิร์ฟเวอร์" };
    const attempts = [];
    for (const provider of ordered) {
      const started = Date.now(); let emitted = false;
      try {
        onProvider({ provider, fallbackCount: attempts.length });
        const result = await this.providers.streamDetailed(provider, systemPrompt, history, { model: provider === preferredProvider ? preferredModel : undefined }, (delta) => { emitted = true; onDelta(delta); });
        if (!result?.text) throw new Error("empty_provider_response");
        const response = { ok: true, text: result.text, provider, model: result.model || null, usage: result.usage || null, latencyMs: Date.now() - started, fallbackCount: attempts.length, streaming: result.streaming || "buffered" };
        this.audit?.record("ai.gateway.stream_complete", { userId, sessionId, provider, model: response.model, latencyMs: response.latencyMs, fallbackCount: response.fallbackCount, usage: response.usage, streaming: response.streaming });
        return response;
      } catch (error) {
        attempts.push({ provider, error: error.message, latencyMs: Date.now() - started });
        this.audit?.record("ai.gateway.stream_provider_failed", { userId, sessionId, provider, error: error.message, emitted });
        if (emitted) return { ok: false, error: "stream_interrupted", text: "", provider, attempts: process.env.NODE_ENV === "production" ? undefined : attempts };
      }
    }
    return { ok: false, error: "all_providers_failed", text: "Sentinel Core: ไม่สามารถเชื่อมต่อ AI Provider ได้ในขณะนี้", attempts: process.env.NODE_ENV === "production" ? undefined : attempts };
  }
}
module.exports = { AiGateway };
