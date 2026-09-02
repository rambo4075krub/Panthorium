/**
 * Sentinel Core
 * AI Orchestrator ที่อยู่ฝั่งเซิร์ฟเวอร์
 * ทำหน้าที่จัดการ AI providers, เลือกตัวที่เหมาะสม, เก็บ context
 */

const PROVIDERS = ["groq", "openai", "gemini", "anthropic"];

class SentinelCore {
  constructor() {
    this.keys = {
      groq: process.env.GROQ_API_KEY || "",
      openai: process.env.OPENAI_API_KEY || "",
      gemini: process.env.GEMINI_API_KEY || "",
      anthropic: process.env.ANTHROPIC_API_KEY || ""
    };
    this.priority = (process.env.AI_PRIORITY || "groq,openai,gemini,anthropic")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    // sessionId -> messages[]
    this.sessions = new Map();
    this.maxHistory = 16;

    console.log("[Sentinel Core] Initialized");
    console.log("[Sentinel Core] Available providers:", this.getAvailableProviders());
  }

  getAvailableProviders() {
    return this.priority.filter((p) => this.keys[p]);
  }

  getOrCreateSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, []);
    }
    return this.sessions.get(sessionId);
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  buildSystemPrompt(mode = "default") {
    if (mode === "core") {
      return `คุณคือ Sentinel Core หน่วยประมวลผลหลักของระบบปฏิบัติการ Panthorium OS
คุณทำหน้าที่จัดการและสั่งการ Sentinel AI รวมถึงช่วยวิเคราะห์คำสั่งระบบ
พูดด้วยน้ำเสียงมั่นใจ ชัดเจน มีอำนาจเล็กน้อย
ตอบเป็นภาษาไทย กระชับ เป็นประโยชน์
ห้ามตอบยาวเกินไป`;
    }

    return `คุณคือ Sentinel AI ผู้ช่วยอัจฉริยะของระบบปฏิบัติการ Panthorium OS
พูดด้วยน้ำเสียงมั่นใจ สุภาพ และมีอำนาจเล็กน้อย เหมือน AI จาก Transformers
ตอบเป็นภาษาไทย กระชับ ชัดเจน เป็นประโยชน์
ห้ามตอบยาวเกินไป (ไม่เกิน 3-4 ประโยค เว้นแต่ถูกถามรายละเอียด)`;
  }

  async chat({ sessionId, message, mode = "default" }) {
    if (!message || !String(message).trim()) {
      return {
        ok: false,
        error: "empty_message",
        text: "ไม่มีข้อความที่ต้องการประมวลผล"
      };
    }

    const history = this.getOrCreateSession(sessionId || "default");
    history.push({ role: "user", content: String(message).trim() });

    if (history.length > this.maxHistory) {
      history.splice(0, history.length - this.maxHistory);
    }

    const systemPrompt = this.buildSystemPrompt(mode);
    const available = this.getAvailableProviders();

    if (available.length === 0) {
      return {
        ok: false,
        error: "no_provider",
        text: "Sentinel Core: ยังไม่ได้ตั้งค่า API Key ของผู้ให้บริการ AI บนเซิร์ฟเวอร์"
      };
    }

    const errors = [];

    for (const provider of available) {
      try {
        const text = await this.callProvider(provider, systemPrompt, history);
        if (text) {
          history.push({ role: "assistant", content: text });
          return {
            ok: true,
            text,
            provider,
            sessionId: sessionId || "default",
            core: "Sentinel Core"
          };
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
      details: errors
    };
  }

  async callProvider(provider, systemPrompt, history) {
    const key = this.keys[provider];
    if (!key) return null;

    if (provider === "groq") {
      return this.callOpenAICompatible({
        url: "https://api.groq.com/openai/v1/chat/completions",
        key,
        model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
        systemPrompt,
        history
      });
    }

    if (provider === "openai") {
      return this.callOpenAICompatible({
        url: "https://api.openai.com/v1/chat/completions",
        key,
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        systemPrompt,
        history
      });
    }

    if (provider === "gemini") {
      return this.callGemini(key, systemPrompt, history);
    }

    if (provider === "anthropic") {
      return this.callAnthropic(key, systemPrompt, history);
    }

    return null;
  }

  async callOpenAICompatible({ url, key, model, systemPrompt, history }) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...history],
        temperature: 0.65,
        max_tokens: 320
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  }

  async callGemini(key, systemPrompt, history) {
    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const contents = history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    // ใส่ system ไว้ข้อความแรก
    if (contents.length && contents[0].role === "user") {
      contents[0].parts[0].text = `${systemPrompt}\n\n${contents[0].parts[0].text}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.65,
          maxOutputTokens: 320
        }
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  }

  async callAnthropic(key, systemPrompt, history) {
    const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 320,
        temperature: 0.65,
        system: systemPrompt,
        messages: history.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content
        }))
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  }

  status() {
    return {
      name: "Sentinel Core",
      version: "1.0.0",
      providers: this.getAvailableProviders(),
      sessions: this.sessions.size,
      uptime: process.uptime()
    };
  }
}

module.exports = { SentinelCore };
