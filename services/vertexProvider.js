let auth = null;
async function callVertex(model, systemPrompt, history) {
  if (!auth) {
    const { GoogleAuth } = require("google-auth-library");
    auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  const token = await auth.getAccessToken();
  if (!token) throw new Error("vertex_auth_failed");
  const host = process.env.VERTEX_HOST || "aiplatform.us.rep.googleapis.com";
  const location = process.env.VERTEX_LOCATION || "us";
  const url = `https://${host}/v1/projects/${process.env.VERTEX_PROJECT}/locations/${location}/endpoints/${process.env.VERTEX_ENDPOINT_ID}:generateContent`;
  const contents = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const generationConfig = { temperature: 0.65, maxOutputTokens: Number(process.env.VERTEX_MAX_OUTPUT_TOKENS) || 1024 };
  if (process.env.VERTEX_THINKING_BUDGET) generationConfig.thinkingConfig = { thinkingBudget: Number(process.env.VERTEX_THINKING_BUDGET) };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, generationConfig }), signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`Provider HTTP ${res.status}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
  const u = data.usageMetadata;
  return { text: text || null, model: data.modelVersion || model, usage: u ? { inputTokens: u.promptTokenCount || 0, outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), totalTokens: u.totalTokenCount || 0 } : null };
}
module.exports = { callVertex };