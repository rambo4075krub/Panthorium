'use strict';
function localEndpoint(value = 'http://127.0.0.1:8088/v1/chat/completions') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/chat/completions') throw new Error('local_llm_loopback_required');
  return url.href;
}
class LocalLlmProvider {
  constructor(env = process.env) {
    this.url = localEndpoint(env.LOCAL_LLM_URL);
    this.model = env.LOCAL_LLM_MODEL || 'panthorium-local';
    this.busy = false;
  }
  async complete(systemPrompt, history, { model } = {}, onDelta) {
    if (model && model !== this.model) throw new Error('model_not_allowed');
    if (this.busy) throw new Error('local_llm_busy');
    if (!Array.isArray(history) || history.length > 8 || history.some(m => !['user','assistant'].includes(m.role) || typeof m.content !== 'string') || history.reduce((n,m) => n + m.content.length, 0) > 4000 || String(systemPrompt).length > 2000) throw new Error('local_context_too_large');
    this.busy = true;
    try {
      const response = await fetch(this.url, { method:'POST', redirect:'error', signal:AbortSignal.timeout(90000), headers:{'Content-Type':'application/json'}, body:JSON.stringify({ model:this.model, messages:[{role:'system',content:String(systemPrompt)},...history], temperature:0.3, max_tokens:160, stream:false, chat_template_kwargs:{enable_thinking:false} }) });
      if (!response.ok) throw new Error('local_llm_http_' + response.status);
      const result = await response.json();
      const text = result.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('local_llm_empty');
      if (onDelta) onDelta(text);
      return {text,model:this.model,provider:'local',usage:result.usage || null,streaming:'buffered'};
    } finally { this.busy = false; }
  }
}
module.exports = { LocalLlmProvider, localEndpoint };
