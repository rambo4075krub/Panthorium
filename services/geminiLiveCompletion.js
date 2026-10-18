const {hasQuota}=require('../billing-catalog');
const { randomUUID } = require('node:crypto');
const { connectGeminiLive, MODEL_ID } = require('./geminiLiveVertex');

// HTTP chat is a short Live session, never a fallback to another model.
async function completeLive({ systemPrompt, history = [], tools = [], onDelta = () => {}, connect = connectGeminiLive, timeoutMs = 60000, entitlements = null, userId, textOutputEnabled = process.env.GEMINI_LIVE_TEXT_OUTPUT_VERIFIED === '1', signal = null, maxOutputTokens = null, onUsage = null } = {}) {
  // Vertex's model table lists text, but Live/native-audio guidance differs.
  // Enable only after a real TEXT-only smoke test for this exact model/project.
  // Never silently retry an unsupported session through another model/modality.
  const startedAt = Date.now();
  const completionId = randomUUID();
  let usageSequence = 0;
  if (signal?.aborted) throw new Error('gemini_live_completion_aborted');
  const responseModality = textOutputEnabled ? 'text' : 'audio';
  let quotaMeter=null;
  if(entitlements && /^[0-9a-f-]{36}$/i.test(userId || '')){const state=await entitlements.state(userId);if(!hasQuota(state,'textInputTokens') || !hasQuota(state,'textOutputTokens') || (!textOutputEnabled && !hasQuota(state,'voiceOutputSeconds')))throw new Error('quota_exceeded');const {LiveQuotaMeter}=require('./liveQuotaMeter');quotaMeter=new LiveQuotaMeter({entitlements,userId});}
  const connectionAbort = new AbortController();
  const socket = await new Promise((resolve, reject) => {
    let abandoned = false;
    const end = error => { if (abandoned) return; abandoned = true; clearTimeout(connectTimer); signal?.removeEventListener('abort', onAbort); connectionAbort.abort(); reject(error); };
    const onAbort = () => end(new Error('gemini_live_completion_aborted'));
    const connectTimer = setTimeout(() => end(new Error('gemini_live_completion_timeout')), Math.max(1, timeoutMs - (Date.now() - startedAt)));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    Promise.resolve().then(() => connect({ systemInstruction: systemPrompt, tools, transcription: !textOutputEnabled, responseModality, maxOutputTokens, signal: connectionAbort.signal, handshakeTimeoutMs: Math.min(timeoutMs, 10000) })).then(value => {
      if (abandoned) { if (value.readyState < 2) value.close(1000, 'completion_abandoned'); return; }
      clearTimeout(connectTimer); signal?.removeEventListener('abort', onAbort); resolve(value);
    }, error => { if (!abandoned) { clearTimeout(connectTimer); signal?.removeEventListener('abort', onAbort); reject(error); } });
  });
  if (signal?.aborted) { if (socket.readyState < 2) socket.close(1000, 'completion_aborted'); throw new Error('gemini_live_completion_aborted'); }
  return new Promise((resolve, reject) => {
    let done = false;
    let text = '';
    let usage = null;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.removeListener('message', onMessage);
      socket.removeListener('close', onClose);
      socket.removeListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (socket.readyState < 2) socket.close(1000, 'completion_finished');
      if (error) reject(error); else resolve(result);
    };
    const onClose = (code, reason) => finish(new Error(`gemini_live_closed_${code}:${String(reason).slice(0,120)}`));
    const onError = error => finish(error);
    const onAbort = () => finish(new Error('gemini_live_completion_aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    let queue=Promise.resolve();
    const onMessage = data => {queue=queue.then(()=>processMessage(data)).catch(error=>finish(error));};
    const processMessage = async data => {
      if(done)return;
      let frame;
      try { frame = JSON.parse(String(data)); } catch { return finish(new Error('gemini_live_invalid_json')); }
      if (textOutputEnabled) {
        const content = frame.serverContent || frame.server_content;
        const parts = content?.modelTurn?.parts || content?.model_turn?.parts || [];
        if (parts.some(part => /^audio\//.test((part.inlineData || part.inline_data)?.mimeType || (part.inlineData || part.inline_data)?.mime_type || ''))) return finish(new Error('gemini_live_text_mode_received_audio'));
      }
      const providerUsage = frame.usageMetadata || frame.usage_metadata;
      if (providerUsage && onUsage) await onUsage({ eventId: `${completionId}:${++usageSequence}`, userId, sessionId: completionId, provider: 'gemini-live', model: MODEL_ID, modality: responseModality, usage: providerUsage, outcome: 'usage', elapsedMs: Date.now() - startedAt });
      if(quotaMeter)await quotaMeter.output(frame);
      if(done)return;
      usage = frame.usageMetadata || frame.usage_metadata || usage;
      if (frame.error) return finish(new Error(`gemini_live_error:${JSON.stringify(frame.error).slice(0,240)}`));
      if (frame.setupComplete || frame.setup_complete) {
        const turns = history.map(message => ({ role: ['assistant','model'].includes(message.role) ? 'model' : 'user', parts: message.parts || [{text:String(message.content || '')}] }));
        socket.send(JSON.stringify({ client_content: { turns, turn_complete: true } }));
      }
      const toolCall = frame.toolCall || frame.tool_call;
      const calls = toolCall?.functionCalls || toolCall?.function_calls;
      if (calls?.length) return finish(null, { text, functionCalls: calls, modelParts: calls.map(functionCall => ({functionCall})), model:MODEL_ID, usage, streaming:'native' });
      const content = frame.serverContent || frame.server_content;
      if (!content) return;
      const transcript = content.outputTranscription || content.output_transcription;
      const delta = transcript?.text || (content.modelTurn?.parts || content.model_turn?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
      if (delta) { text += delta; onDelta(delta); }
      usage = frame.usageMetadata || frame.usage_metadata || usage;
      if (content.turnComplete || content.turn_complete) finish(text.trim() ? null : new Error('gemini_live_empty_transcript'), { text:text.trim(), model:MODEL_ID, usage, streaming:'native' });
    };
    const timer = setTimeout(() => finish(new Error('gemini_live_completion_timeout')), Math.max(1, timeoutMs - (Date.now() - startedAt)));
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}
module.exports = { completeLive };
