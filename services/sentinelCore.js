const { SessionManager } = require("./sessionManager");
const { PromptManager } = require("./promptManager");
const { ProviderManager } = require("./providerManager");
const { AiGateway } = require("./aiGateway");

class SentinelCore {
  constructor({ sessions, prompts, providers, gateway, conversations, training, audit } = {}) {
    this.sessions = sessions || new SessionManager();
    this.prompts = prompts || new PromptManager();
    this.providers = providers || new ProviderManager();
    this.gateway = gateway || new AiGateway({ providers: this.providers, audit });
    this.conversations = conversations || null;
    this.training = training || null;
    console.log("[Sentinel Core] Initialized");
  }
  getAvailableProviders() { return this.providers.available(); }
  providerCatalog() { return this.gateway.catalog(); }
  clearSession(sessionId) { this.sessions.clear(sessionId); }
  async clearConversation(userId, sessionId) { this.sessions.clear(`${userId}:${sessionId}`); if (this.conversations) await this.conversations.clear(userId, sessionId); }
  async conversationHistory(userId, sessionId, limit) { return this.conversations ? this.conversations.history(userId, sessionId, limit) : []; }
  async conversationSessions(userId, limit) { return this.conversations ? this.conversations.listSessions(userId, limit) : []; }
  async prepareHistory({ sessionId, userId, message }) {
    const clean = String(message).trim(); const sid = sessionId || "default"; const localId = `${userId}:${sid}`;
    if (this.conversations) {
      await this.conversations.append({ userId, sessionId: sid, role: "user", content: clean });
      return { sid, localId, history: (await this.conversations.history(userId, sid, 40)).map(({ role, content }) => ({ role, content })) };
    }
    return { sid, localId, history: this.sessions.append(localId, { role: "user", content: clean }) };
  }
  async persistAssistant({ userId, sid, localId, result }) {
    if (!result.ok || !result.text) return;
    if (this.conversations) await this.conversations.append({ userId, sessionId: sid, role: "assistant", content: result.text, provider: result.provider, model: result.model, usage: result.usage });
    else this.sessions.append(localId, { role: "assistant", content: result.text });
  }
  async chat({ sessionId, userId = "system", message, mode = "default", provider, model }) {
    if (!message || !String(message).trim()) return { ok: false, error: "empty_message", text: "ไม่มีข้อความที่ต้องการประมวลผล" };
    const prepared = await this.prepareHistory({ sessionId, userId, message });
    const trainingContext = this.training ? await this.training.contextFor(message) : '';
    const result = await this.gateway.complete({ systemPrompt: this.prompts.build(mode) + trainingContext, history: prepared.history, preferredProvider: provider, preferredModel: model, userId, sessionId: prepared.sid });
    await this.persistAssistant({ userId, sid: prepared.sid, localId: prepared.localId, result });
    return result.ok ? { ...result, sessionId: prepared.sid, core: "Sentinel Core" } : result;
  }
  async streamChat({ sessionId, userId = "system", message, mode = "default", provider, model, onDelta, onProvider }) {
    if (!message || !String(message).trim()) return { ok: false, error: "empty_message", text: "ไม่มีข้อความที่ต้องการประมวลผล" };
    const prepared = await this.prepareHistory({ sessionId, userId, message });
    const trainingContext = this.training ? await this.training.contextFor(message) : '';
    const result = await this.gateway.stream({ systemPrompt: this.prompts.build(mode) + trainingContext, history: prepared.history, preferredProvider: provider, preferredModel: model, userId, sessionId: prepared.sid, onDelta, onProvider });
    await this.persistAssistant({ userId, sid: prepared.sid, localId: prepared.localId, result });
    return result.ok ? { ...result, sessionId: prepared.sid, core: "Sentinel Core" } : result;
  }
  status() { return { name: "Sentinel Core", version: "2.2.0-training-lab", providers: this.getAvailableProviders(), sessions: this.sessions.size(), persistence: this.conversations?.pool ? "postgresql" : this.conversations ? "memory" : "legacy", training: Boolean(this.training), streaming: true, uptime: process.uptime() }; }
}
module.exports = { SentinelCore };
