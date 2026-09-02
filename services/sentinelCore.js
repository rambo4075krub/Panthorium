const { SessionManager } = require("./sessionManager");
const { PromptManager } = require("./promptManager");
const { ProviderManager } = require("./providerManager");

class SentinelCore {
  constructor({ sessions, prompts, providers } = {}) {
    this.sessions = sessions || new SessionManager();
    this.prompts = prompts || new PromptManager();
    this.providers = providers || new ProviderManager();
    console.log("[Sentinel Core] Initialized");
    console.log("[Sentinel Core] Available providers:", this.getAvailableProviders());
  }

  getAvailableProviders() { return this.providers.available(); }
  clearSession(sessionId) { this.sessions.clear(sessionId); }

  async chat({ sessionId, message, mode = "default" }) {
    if (!message || !String(message).trim()) return { ok: false, error: "empty_message", text: "ไม่มีข้อความที่ต้องการประมวลผล" };
    const clean = String(message).trim();
    const history = this.sessions.append(sessionId || "default", { role: "user", content: clean });
    const available = this.getAvailableProviders();
    if (!available.length) return { ok: false, error: "no_provider", text: "Sentinel Core: ยังไม่ได้ตั้งค่า API Key ของผู้ให้บริการ AI บนเซิร์ฟเวอร์" };

    const errors = [];
    for (const provider of available) {
      try {
        const text = await this.providers.call(provider, this.prompts.build(mode), history);
        if (text) {
          this.sessions.append(sessionId || "default", { role: "assistant", content: text });
          return { ok: true, text, provider, sessionId: sessionId || "default", core: "Sentinel Core" };
        }
      } catch (err) {
        errors.push(`${provider}: ${err.message}`);
        console.warn(`[Sentinel Core] ${provider} failed:`, err.message);
      }
    }
    return {
      ok: false,
      error: "all_providers_failed",
      text: "Sentinel Core: ไม่สามารถเชื่อมต่อกับหน่วยประมวลผลใดได้ในขณะนี้",
      details: process.env.NODE_ENV === "production" ? undefined : errors
    };
  }

  status() {
    return { name: "Sentinel Core", version: "1.1.0", providers: this.getAvailableProviders(), sessions: this.sessions.size(), uptime: process.uptime() };
  }
}
module.exports = { SentinelCore };
