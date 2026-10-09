const { connectGeminiLive, MODEL_ID } = require('./geminiLiveVertex');

// HTTP chat is a short Live session, never a fallback to another model.
async function completeLive({ systemPrompt, history = [], tools = [], onDelta = () => {}, connect = connectGeminiLive, timeoutMs = 60000 } = {}) {
  const socket = await connect({ systemInstruction: systemPrompt, tools, transcription: true });
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
      if (socket.readyState < 2) socket.close(1000, 'completion_finished');
      if (error) reject(error); else resolve(result);
    };
    const onClose = (code, reason) => finish(new Error(`gemini_live_closed_${code}:${String(reason).slice(0,120)}`));
    const onError = error => finish(error);
    const onMessage = data => {
      let frame;
      try { frame = JSON.parse(String(data)); } catch { return finish(new Error('gemini_live_invalid_json')); }
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
    const timer = setTimeout(() => finish(new Error('gemini_live_completion_timeout')), timeoutMs);
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}
module.exports = { completeLive };
