const { SessionManager } = require("./sessionManager");
const { PromptManager } = require("./promptManager");
const { ProviderManager } = require("./providerManager");
const { AiGateway } = require("./aiGateway");

class SentinelCore {
  constructor({ sessions, prompts, providers, gateway, conversations, audit } = {}) {
    this.sessions = sessions || new SessionManager();
    this.prompts = prompts || new PromptManager();
    this.providers = providers || new ProviderManager();
    this.gateway = gateway || new AiGateway({ providers: this.providers, audit });
    this.conversations = conversations || null;
    console.log("[Sentinel Core] Initialized");
  }
  getAvailableProviders() { return this.providers.available(); }
  providerCatalog() { return this.gateway.catalog(); }
  clearSession(sessionId) { this.sessions.clear(sessionId); }
  async clearConversation(userId, sessionId) { this.sessions.clear(`${userId}:${sessionId}`); if (this.conversations) await this.conversations.clear(userId, sessionId); }
  async conversationHistory(userId, sessionId, limit) { return this.conversations ? this.conversations.history(userId, sessionId, limit) : []; }
  async conversationSessions(userId, limit) { return this.conversations ? this.conversations.listSessions(userId, limit) : []; }

  async chat({ sessionId, userId = "system", message, mode = "default", provider, model }) {
    if (!message || !String(message).trim()) return { ok: false, error: "empty_message", text: "ไม่มีข้อความที่ต้องการประมวลผล" };
    const clean = String(message).trim(); const localId = `${userId}:${sessionId || "default"}`;
    let history;
    if (this.conversations) {
      await this.conversations.append({ userId, sessionId: sessionId || "default", role: "user", content: clean });
      history = (await this.conversations.history(userId, sessionId || "default", 40)).map(({ role, content }) => ({ role, content }));
    } else history = this.sessions.append(localId, { role: "user", content: clean });

    const result = await this.gateway.complete({ systemPrompt: this.prompts.build(mode), history, preferredProvider: provider, preferredModel: model, userId, sessionId: sessionId || "default" });
    if (result.ok) {
      if (this.conversations) await this.conversations.append({ userId, sessionId: sessionId || "default", role: "assistant", content: result.text, provider: result.provider, model: result.model, usage: result.usage });
      else this.sessions.append(localId, { role: "assistant", content: result.text });
      return { ...result, sessionId: sessionId || "default", core: "Sentinel Core" };
    }
    return result;
  }
  status() { return { name: "Sentinel Core", version: "2.0.0-phase4", providers: this.getAvailableProviders(), sessions: this.sessions.size(), persistence: this.conversations?.pool ? "postgresql" : this.conversations ? "memory" : "legacy", uptime: process.uptime() }; }
}
module.exports = { SentinelCore };
