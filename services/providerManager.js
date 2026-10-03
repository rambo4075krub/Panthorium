const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_DEFAULT_MODEL = "openai/gpt-oss-20b";
// Migrate the old default even when it is pinned in Cloud Run or a saved client.
function currentGroqModel(model) {
  const value = String(model || "").trim();
  return !value || value === "llama-3.1-8b-instant" ? GROQ_DEFAULT_MODEL : value;
}
function completionOptions(url, model) {
  if (url === GROQ_CHAT_URL && model === GROQ_DEFAULT_MODEL) {
    // Reasoning shares the token budget. Return only the answer to chat/TTS.
    return { max_completion_tokens: 2048, reasoning_effort: "low", include_reasoning: false };
  }
  const configured = Number(process.env.SENTINEL_MAX_OUTPUT_TOKENS || 1536);
  const maxTokens = Number.isFinite(configured) ? Math.min(3072, Math.max(512, Math.floor(configured))) : 1536;
  return { max_tokens: maxTokens };
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function providerError(res) {
  let detail = "";
  try { const data = await res.clone().json(); detail = data?.error?.message || data?.message || data?.error || ""; } catch (_) { try { detail = await res.clone().text(); } catch (_) {} }
  detail = String(detail || "").replace(/[\r\n\t]+/g, " ").replace(/(key|token|secret)\s*[=:]\s*\S+/gi, "$1=[redacted]").slice(0, 220);
  const error = new Error(`Provider HTTP ${res.status}${detail ? `: ${detail}` : ""}`); error.status = res.status;
  const retry = res.headers.get('retry-after');
  error.retryAfterMs = retry ? (Number.isFinite(Number(retry)) ? Number(retry)*1000 : Math.max(0,Date.parse(retry)-Date.now())) : 60000;
  return error;
}
async function fetchProvider(makeRequest, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await makeRequest();
    if (res.ok) return res;
    last = res;
    if (res.status === 429 || res.status < 500) break;
    if (attempt < attempts - 1) { const retryAfter = Number(res.headers.get("retry-after")); await sleep(Number.isFinite(retryAfter) ? Math.min(10000, retryAfter * 1000) : 750 * (attempt + 1)); }
  }
  throw await providerError(last);
}
class ProviderManager {
  cooling = new Map();
  vertexToken = "";
  vertexTokenExpiresAt = 0;
  constructor() {
    this.keys = { groq: process.env.GROQ_API_KEY || "", openai: process.env.OPENAI_API_KEY || "", gemini: process.env.GEMINI_API_KEY || "", anthropic: process.env.ANTHROPIC_API_KEY || "" };
    this.priority = (process.env.AI_PRIORITY || "vertex,groq,openai,gemini,anthropic").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    this.vertex = {
      // Keep the original Vertex variable names working during the main
      // deployment migration; staging uses the explicit SENTINEL_* names.
      project: process.env.SENTINEL_VERTEX_PROJECT_ID || process.env.VERTEX_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "",
      location: process.env.SENTINEL_VERTEX_LOCATION || process.env.VERTEX_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || (process.env.VERTEX_ENDPOINT_ID ? "us" : ""),
      endpointId: process.env.SENTINEL_VERTEX_ENDPOINT_ID || process.env.VERTEX_ENDPOINT_ID || "",
      maxOutputTokens: Math.max(128, Math.min(8192, Number(process.env.SENTINEL_VERTEX_MAX_OUTPUT_TOKENS) || 4096))
    };
    this.models = { groq: currentGroqModel(process.env.GROQ_MODEL), openai: process.env.OPENAI_MODEL || "gpt-4o-mini", gemini: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite", anthropic: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001", vertex: process.env.SENTINEL_VERTEX_MODEL || process.env.VERTEX_MODEL || "sentinel-v3" };
  }
  vertexConfigured() { return Boolean(this.vertex.project && this.vertex.location && this.vertex.endpointId); }
  available() { return this.priority.filter((p) => p === "vertex" ? this.vertexConfigured() : Boolean(this.keys[p])); }
  catalog() { return this.priority.map((provider, priority) => ({ provider, model: this.models[provider] || null, configured: provider === "vertex" ? this.vertexConfigured() : Boolean(this.keys[provider]), priority, streaming: provider === "vertex" || provider === "groq" || provider === "openai" ? "native" : "buffered" })); }
  resolveModel(provider, requestedModel) {
    const configured = this.models[provider];
    if (!configured) return null;
    if (!requestedModel) return configured;
    const requested = provider === "groq" ? currentGroqModel(requestedModel) : String(requestedModel).trim();
    return requested === configured ? configured : null;
  }
  async transcribeAudio(buffer, mimeType = "audio/webm", language = "") {
    const candidates = [
      { provider: "groq", key: this.keys.groq, url: "https://api.groq.com/openai/v1/audio/transcriptions", model: process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3" },
      { provider: "openai", key: this.keys.openai, url: "https://api.openai.com/v1/audio/transcriptions", model: process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1" }
    ].filter(item => item.key && this.priority.includes(item.provider))
      .sort((a, b) => this.priority.indexOf(a.provider) - this.priority.indexOf(b.provider));
    if (!candidates.length) {
      const error = new Error("transcription_provider_unavailable");
      error.code = "transcription_provider_unavailable";
      throw error;
    }
    const transcribeWith = async item => {
      const form = new FormData();
      const extension = /mp4/i.test(mimeType) ? "mp4" : /ogg/i.test(mimeType) ? "ogg" : "webm";
      form.append("file", new Blob([buffer], { type: mimeType }), `panthorium-voice.${extension}`);
      form.append("model", item.model);
      form.append("response_format", "verbose_json");
      form.append("temperature", "0");
      form.append("prompt", "ถอดคำพูดตามเสียงจริง ห้ามแปลหรือสรุป คงภาษาไทยและ English ตามที่พูด รวมทั้งชื่อเฉพาะ Panthorium, Sentinel, Niwat, AI, API และ ProviderManager");
      if (language) form.append("language", String(language).toLowerCase().startsWith("th") ? "th" : "en");
      const response = await fetch(item.url, { method: "POST", headers: { Authorization: `Bearer ${item.key}` }, body: form, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Transcription HTTP ${response.status}`);
      const data = await response.json();
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text) throw new Error("empty_transcription");
      const segments = Array.isArray(data.segments) ? data.segments : [];
      const logprobs = segments.map(segment => Number(segment.avg_logprob)).filter(Number.isFinite);
      const noSpeech = segments.map(segment => Number(segment.no_speech_prob)).filter(Number.isFinite);
      return {
        text,
        provider: item.provider,
        model: data.model || item.model,
        confidence: logprobs.length ? logprobs.reduce((sum, value) => sum + value, 0) / logprobs.length : null,
        noSpeechProbability: noSpeech.length ? Math.max(...noSpeech) : null
      };
    };
    const uncertain = () => { const error = new Error("transcription_uncertain"); error.code = error.message; return error; };
    const likelySilence = result => result.noSpeechProbability !== null && result.noSpeechProbability > 0.65;
    const confidence = result => result.confidence;
    const normalize = value => String(value).normalize("NFKC").toLowerCase().replace(/[\\s\\p{P}\\p{S}]/gu, "");
    const similarity = (left, right) => {
      if (left === right) return 1;
      if (!left.length || !right.length) return 0;
      let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
      for (let i = 1; i <= left.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= right.length; j += 1) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
        previous = current;
      }
      return 1 - previous[right.length] / Math.max(left.length, right.length);
    };

    // A confident single-model transcript can still be the wrong question.
    // When a second provider is configured, compare both hypotheses in
    // parallel. Disagreement is withheld from the assistant instead of being
    // silently treated as the user's intent.
    if (candidates.length > 1) {
      const results = await Promise.allSettled(candidates.slice(0, 2).map(transcribeWith));
      const primary = results[0].status === "fulfilled" ? results[0].value : null;
      const secondary = results[1].status === "fulfilled" ? results[1].value : null;
      if (primary && secondary) {
        const firstSilent = likelySilence(primary), secondSilent = likelySilence(secondary);
        if (firstSilent && secondSilent) throw uncertain();
        if (firstSilent || secondSilent) {
          const clearer = firstSilent ? secondary : primary;
          if (confidence(clearer) !== null && confidence(clearer) < -0.6) throw uncertain();
          return { ...clearer, crossCheckedBy: firstSilent ? primary.provider : secondary.provider };
        }
        const firstText = normalize(primary.text), secondText = normalize(secondary.text);
        const matchScore = similarity(firstText, secondText);
        const firstConfidence = confidence(primary), secondConfidence = confidence(secondary);
        const best = firstConfidence === null || (secondConfidence !== null && secondConfidence > firstConfidence) ? secondary : primary;
        if (matchScore === 1) return { ...primary, crossCheckedBy: secondary.provider };
        if (matchScore >= 0.76) return { ...best, crossCheckedBy: best === primary ? secondary.provider : primary.provider };
        const low = firstConfidence === null || secondConfidence === null ? null : Math.min(firstConfidence, secondConfidence);
        const high = firstConfidence === null ? secondConfidence : secondConfidence === null ? firstConfidence : Math.max(firstConfidence, secondConfidence);
        if (high !== null && high >= -0.3 && (low === null || high - low >= 0.5)) {
          return { ...best, crossCheckDisagreed: true, crossCheckedBy: best === primary ? secondary.provider : primary.provider };
        }
        throw uncertain();
      }
      const onlyResult = primary || secondary;
      if (onlyResult && !likelySilence(onlyResult) && (confidence(onlyResult) === null || confidence(onlyResult) >= -0.6)) {
        return { ...onlyResult, crossCheckUnavailable: true };
      }
      if (onlyResult) throw uncertain();
      const error = new Error("transcription_provider_unavailable");
      error.code = "transcription_provider_unavailable";
      throw error;
    }

    try {
      const result = await transcribeWith(candidates[0]);
      if (likelySilence(result) || (confidence(result) !== null && confidence(result) < -0.85)) throw uncertain();
      return result;
    } catch (error) {
      if (error.code === "transcription_uncertain") throw error;
      const unavailable = new Error("transcription_provider_unavailable");
      unavailable.code = "transcription_provider_unavailable";
      throw unavailable;
    }
  }
  async call(provider, systemPrompt, history) { const result = await this.callDetailed(provider, systemPrompt, history); return result?.text || null; }
  async callDetailed(provider, systemPrompt, history, options = {}) {
    const paused=this.cooling.get(provider);
    if(paused&&paused.until>Date.now()){
      const error=new Error('Provider HTTP 429: provider cooling down');error.status=429;error.retryAfterMs=paused.until-Date.now();throw error;
    }
    try{return await this.callAvailable(provider,systemPrompt,history,options);}
    catch(error){if(error.status===429)this.cooling.set(provider,{until:Date.now()+Math.max(60000,error.retryAfterMs||60000)});throw error;}
  }
  async callAvailable(provider, systemPrompt, history, options = {}) {
    if (provider === "vertex") {
      if (!this.vertexConfigured()) return null;
      const model = this.resolveModel(provider, options.model);
      if (!model) throw new Error("model_not_allowed");
      return this.callVertexTuned(systemPrompt, history);
    }
    const key = this.keys[provider]; if (!key) return null; const model = this.resolveModel(provider, options.model); if (!model) throw new Error("model_not_allowed");
    if (provider === "groq") return this.callOpenAICompatible(GROQ_CHAT_URL, key, model, systemPrompt, history);
    if (provider === "openai") return this.callOpenAICompatible("https://api.openai.com/v1/chat/completions", key, model, systemPrompt, history);
    if (provider === "gemini") return this.callGemini(key, model, systemPrompt, history);
    if (provider === "anthropic") return this.callAnthropic(key, model, systemPrompt, history);
    return null;
  }
  async vertexAccessToken() {
    // Direct access token override for local testing or CI outside Cloud Run
    if (process.env.VERTEX_ACCESS_TOKEN) return process.env.VERTEX_ACCESS_TOKEN;
    // Cloud Run's metadata server supplies short-lived Application Default
    // Credentials. No service-account key or always-on inference VM is needed.
    if (this.vertexToken && this.vertexTokenExpiresAt > Date.now() + 60000) return this.vertexToken;
    try {
      const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
        headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.access_token) {
          this.vertexToken = data.access_token;
          this.vertexTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 300) * 1000;
          return data.access_token;
        }
      }
    } catch (_) {
      // metadata server unreachable (e.g. testing outside GCP)
    }
    // Fallback: Check if google-auth-library is available
    try {
      const { GoogleAuth } = require("google-auth-library");
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      const client = await auth.getClient();
      const tokenRes = await client.getAccessToken();
      const token = typeof tokenRes === "string" ? tokenRes : tokenRes?.token;
      if (token) {
        this.vertexToken = token;
        this.vertexTokenExpiresAt = Date.now() + 300000;
        return token;
      }
    } catch (_) {
      // google-auth-library not installed or ADC credentials not configured
    }
    throw new Error("vertex_adc_token_missing");
  }
  async callVertexTuned(systemPrompt, history) {
    const { project, location, endpointId, maxOutputTokens } = this.vertex;
    const host = process.env.VERTEX_HOST
      ? (process.env.VERTEX_HOST.startsWith("http") ? process.env.VERTEX_HOST : `https://${process.env.VERTEX_HOST}`)
      : (location === "eu" || location === "us"
        ? `https://aiplatform.${location}.rep.googleapis.com`
        : `https://${location}-aiplatform.googleapis.com`);
    const contents = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] }));
    const url = `${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/endpoints/${encodeURIComponent(endpointId)}:generateContent`;
    const request = async () => fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await this.vertexAccessToken()}`,
        "X-Goog-User-Project": String(project)
      },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig: { temperature: 0.65, maxOutputTokens } }),
      signal: AbortSignal.timeout(60000)
    });
    const response = await fetchProvider(request);
    const data = await response.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("").trim();
    const usage = data.usageMetadata;
    return {
      text: text || null,
      model: this.models.vertex,
      usage: usage ? { inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0, totalTokens: usage.totalTokenCount || 0 } : null
    };
  }
  async streamVertexTuned(systemPrompt, history, onDelta = () => {}) {
    const { project, location, endpointId, maxOutputTokens } = this.vertex;
    const host = process.env.VERTEX_HOST
      ? (process.env.VERTEX_HOST.startsWith("http") ? process.env.VERTEX_HOST : `https://${process.env.VERTEX_HOST}`)
      : (location === "eu" || location === "us"
        ? `https://aiplatform.${location}.rep.googleapis.com`
        : `https://${location}-aiplatform.googleapis.com`);
    const contents = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] }));
    const url = `${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/endpoints/${encodeURIComponent(endpointId)}:streamGenerateContent?alt=sse`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${await this.vertexAccessToken()}`,
        "X-Goog-User-Project": String(project)
      },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig: { temperature: 0.65, maxOutputTokens } }),
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw await providerError(response);
    if (!response.body) throw new Error("vertex_stream_unavailable");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let usage = null;
    let truncated = false;
    const model = this.models.vertex;
    const consumeFrame = (frame) => {
      const payloads = frame.split(/\\r?\\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
      for (const payload of payloads) {
        if (payload === "[DONE]") continue;
        let data;
        try { data = JSON.parse(payload); } catch (_) { continue; }
        const candidate = data.candidates?.[0];
        if (candidate?.finishReason === "MAX_TOKENS") truncated = true;
        const metadata = data.usageMetadata;
        if (metadata) usage = {
          inputTokens: metadata.promptTokenCount || 0,
          outputTokens: (metadata.candidatesTokenCount || 0) + (metadata.thoughtsTokenCount || 0),
          totalTokens: metadata.totalTokenCount || 0
        };
        for (const part of candidate?.content?.parts || []) {
          if (typeof part.text !== "string" || !part.text || part.thought) continue;
          text += part.text;
          onDelta(part.text);
        }
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\\r?\\n\\r?\\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) consumeFrame(frame);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeFrame(buffer);
    if (!text.trim()) throw new Error("vertex_stream_empty");
    return { text: text.trim(), model, usage, streaming: "native", truncated };
  }
  async streamDetailed(provider, systemPrompt, history, options = {}, onDelta = () => {}) {
    if (provider === "vertex") {
      if (!this.vertexConfigured()) return null;
      const model = this.resolveModel(provider, options.model);
      if (!model) throw new Error("model_not_allowed");
      return this.streamVertexTuned(systemPrompt, history, onDelta);
    }
    const key = this.keys[provider]; if (!key) return null; const model = this.resolveModel(provider, options.model); if (!model) throw new Error("model_not_allowed");
    if (provider === "groq") return this.streamOpenAICompatible(GROQ_CHAT_URL, key, model, systemPrompt, history, onDelta, false);
    if (provider === "openai") return this.streamOpenAICompatible("https://api.openai.com/v1/chat/completions", key, model, systemPrompt, history, onDelta, true);
    const result = await this.callDetailed(provider, systemPrompt, history, { model });
    if (result?.text) onDelta(result.text);
    return { ...result, streaming: "buffered" };
  }
  async streamOpenAICompatible(url, key, model, systemPrompt, history, onDelta, includeUsage = false) {
    const body = { model, messages: [{ role: "system", content: systemPrompt }, ...history], temperature: 0.65, ...completionOptions(url, model), stream: true };
    if (includeUsage) body.stream_options = { include_usage: true };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, Accept: "text/event-stream" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
    if (!res.body) throw new Error("provider_stream_unavailable");
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let text = ""; let usage = null; let responseModel = model; let truncated=false;
    while (true) {
      const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim(); if (!line.startsWith("data:")) continue; const payload = line.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
        let data; try { data = JSON.parse(payload); } catch { continue; }
        responseModel = data.model || responseModel;
        if(data.choices?.[0]?.finish_reason==='length')truncated=true;
        const tokenUsage = data.usage || data.x_groq?.usage;
        if (tokenUsage) usage = { inputTokens: tokenUsage.prompt_tokens || 0, outputTokens: tokenUsage.completion_tokens || 0, totalTokens: tokenUsage.total_tokens || 0 };
        const delta = data.choices?.[0]?.delta?.content || ""; if (delta) { text += delta; onDelta(delta); }
      }
    }
    if (!text.trim()) throw new Error("provider_stream_empty");
    return { text: text.trim(), model: responseModel, usage, streaming: "native", truncated };
  }
  async callOpenAICompatible(url, key, model, systemPrompt, history) {
    const request = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...history], temperature: 0.65, ...completionOptions(url, model) }), signal: AbortSignal.timeout(30000) });
    const res = await fetchProvider(request); const data = await res.json();
    const choice=data.choices?.[0];return { text: choice?.message?.content?.trim() || null, model: data.model || model, truncated: choice?.finish_reason === 'length', usage: data.usage ? { inputTokens: data.usage.prompt_tokens || 0, outputTokens: data.usage.completion_tokens || 0, totalTokens: data.usage.total_tokens || 0 } : null };
  }
  async callGemini(key, model, systemPrompt, history) {
    const contents = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    if (contents.length && contents[0].role === "user") contents[0].parts[0].text = `${systemPrompt}\n\n${contents[0].parts[0].text}`;
    const candidates = [...new Set([model, "gemini-3.5-flash-lite"])]; let lastError;
    for (const candidate of candidates) { try { const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:generateContent?key=${key}`; const configured=Number(process.env.SENTINEL_MAX_OUTPUT_TOKENS||1536);const maxOutputTokens=Number.isFinite(configured)?Math.min(3072,Math.max(512,Math.floor(configured))):1536;const res = await fetchProvider(() => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents, generationConfig: { temperature: 0.65, maxOutputTokens } }), signal: AbortSignal.timeout(30000) })); const data = await res.json(); const candidateResult=data.candidates?.[0];const usage = data.usageMetadata; return { text: candidateResult?.content?.parts?.[0]?.text?.trim() || null, model:candidate, truncated:candidateResult?.finishReason==='MAX_TOKENS', usage: usage ? { inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0, totalTokens: usage.totalTokenCount || 0 } : null }; } catch (error) { lastError=error; if(error.status!==404)throw error; } }
    throw lastError;
  }
  async callAnthropic(key, model, systemPrompt, history) {
    const candidates=[...new Set([model,"claude-haiku-4-5-20251001"])];let lastError;
    for(const candidate of candidates){try{const configured=Number(process.env.SENTINEL_MAX_OUTPUT_TOKENS||1536);const max_tokens=Number.isFinite(configured)?Math.min(3072,Math.max(512,Math.floor(configured))):1536;const res=await fetchProvider(()=>fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model:candidate, max_tokens, temperature: 0.65, system: systemPrompt, messages: history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })) }), signal: AbortSignal.timeout(30000) }));const data=await res.json();return { text: data.content?.[0]?.text?.trim() || null, model: data.model || candidate,truncated:data.stop_reason==='max_tokens', usage: data.usage ? { inputTokens: data.usage.input_tokens || 0, outputTokens: data.usage.output_tokens || 0, totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) } : null };}catch(error){lastError=error;if(![400,404].includes(error.status))throw error;}}
    throw lastError;
  }
}
module.exports = { ProviderManager };
