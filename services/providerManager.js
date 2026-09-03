class ProviderManager {
  constructor() {
    this.keys = { groq: process.env.GROQ_API_KEY || "", openai: process.env.OPENAI_API_KEY || "", gemini: process.env.GEMINI_API_KEY || "", anthropic: process.env.ANTHROPIC_API_KEY || "" };
    this.priority = (process.env.AI_PRIORITY || "groq,openai,gemini,anthropic").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    this.models = { groq: process.env.GROQ_MODEL || "llama-3.1-8b-instant", openai: process.env.OPENAI_MODEL || "gpt-4o-mini", gemini: process.env.GEMINI_MODEL || "gemini-1.5-flash", anthropic: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022" };
  }
  available() { return this.priority.filter((p) => this.keys[p]); }
  catalog() { return this.priority.map((provider, priority) => ({ provider, model: this.models[provider] || null, configured: Boolean(this.keys[provider]), priority, streaming: provider === "groq" || provider === "openai" ? "native" : "buffered" })); }
  resolveModel(provider, requestedModel) {
    const configured = this.models[provider];
    if (!configured) return null;
    if (!requestedModel) return configured;
    return String(requestedModel).trim() === configured ? configured : null;
  }
  async call(provider, systemPrompt, history) { const result = await this.callDetailed(provider, systemPrompt, history); return result?.text || null; }
  async callDetailed(provider, systemPrompt, history, options = {}) {
    const key = this.keys[provider]; if (!key) return null; const model = this.resolveModel(provider, options.model); if (!model) throw new Error("model_not_allowed");
    if (provider === "groq") return this.callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", key, model, systemPrompt, history);
    if (provider === "openai") return this.callOpenAICompatible("https://api.openai.com/v1/chat/completions", key, model, systemPrompt, history);
    if (provider === "gemini") return this.callGemini(key, model, systemPrompt, history);
    if (provider === "anthropic") return this.callAnthropic(key, model, systemPrompt, history);
    return null;
  }
  async streamDetailed(provider, systemPrompt, history, options = {}, onDelta = () => {}) {
    const key = this.keys[provider]; if (!key) return null; const model = this.resolveModel(provider, options.model); if (!model) throw new Error("model_not_allowed");
    if (provider === "groq") return this.streamOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", key, model, systemPrompt, history, onDelta, false);
    if (provider === "openai") return this.streamOpenAICompatible("https://api.openai.com/v1/chat/completions", key, model, systemPrompt, history, onDelta, true);
    const result = await this.callDetailed(provider, systemPrompt, history, { model });
    if (result?.text) onDelta(result.text);
    return { ...result, streaming: "buffered" };
  }
  async streamOpenAICompatible(url, key, model, systemPrompt, history, onDelta, includeUsage = false) {
    const body = { model, messages: [{ role: "system", content: systemPrompt }, ...history], temperature: 0.65, max_tokens: 320, stream: true };
    if (includeUsage) body.stream_options = { include_usage: true };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, Accept: "text/event-stream" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
    if (!res.body) throw new Error("provider_stream_unavailable");
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let text = ""; let usage = null; let responseModel = model;
    while (true) {
      const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim(); if (!line.startsWith("data:")) continue; const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
        let data; try { data = JSON.parse(payload); } catch { continue; }
        responseModel = data.model || responseModel;
        if (data.usage) usage = { inputTokens: data.usage.prompt_tokens || 0, outputTokens: data.usage.completion_tokens || 0, totalTokens: data.usage.total_tokens || 0 };
        const delta = data.choices?.[0]?.delta?.content || ""; if (delta) { text += delta; onDelta(delta); }
      }
    }
    if (!text.trim()) throw new Error("provider_stream_empty");
    return { text: text.trim(), model: responseModel, usage, streaming: "native" };
  }
  async callOpenAICompatible(url, key, model, systemPrompt, history) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...history], temperature: 0.65, max_tokens: 320 }), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Provider HTTP ${res.status}`); const data = await res.json();
    return { text: data.choices?.[0]?.message?.content?.trim() || null, model: data.model || model, usage: data.usage ? { inputTokens: data.usage.prompt_tokens || 0, outputTokens: data.usage.completion_tokens || 0, totalTokens: data.usage.total_tokens || 0 } : null };
  }
  async callGemini(key, model, systemPrompt, history) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`; const contents = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    if (contents.length && contents[0].role === "user") contents[0].parts[0].text = `${systemPrompt}\n\n${contents[0].parts[0].text}`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents, generationConfig: { temperature: 0.65, maxOutputTokens: 320 } }), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Provider HTTP ${res.status}`); const data = await res.json(); const usage = data.usageMetadata;
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null, model, usage: usage ? { inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0, totalTokens: usage.totalTokenCount || 0 } : null };
  }
  async callAnthropic(key, model, systemPrompt, history) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 320, temperature: 0.65, system: systemPrompt, messages: history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })) }), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Provider HTTP ${res.status}`); const data = await res.json();
    return { text: data.content?.[0]?.text?.trim() || null, model: data.model || model, usage: data.usage ? { inputTokens: data.usage.input_tokens || 0, outputTokens: data.usage.output_tokens || 0, totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) } : null };
  }
}
module.exports = { ProviderManager };
