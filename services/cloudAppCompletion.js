'use strict';
const { randomUUID } = require('crypto');
const { completeLive } = require('./geminiLiveCompletion');

// All app generation stays on the existing Google Cloud Live provider.
// This adapter never substitutes another model or executes model-supplied tools.
function createCloudAppCompletion({ complete = completeLive, entitlements, usageLedger, gate, textOutputEnabled = process.env.GEMINI_LIVE_TEXT_OUTPUT_VERIFIED === '1' } = {}) {
  const adapter = async ({ user, systemPrompt, messages, maxOutputTokens, timeoutMs, signal, cloudApp }) => {
    const eventId = randomUUID();
    const started = Date.now();
    const userId = user?.sub || user?.id;
    if (!userId) throw new Error('cloud_apps_account_required');
    let snapshots = 0;
    // Native AUDIO transcription is natural speech, not a reliable JSON codec.
    // The server supplies the draft envelope; it never invents source citations.
    const providerPrompt = textOutputEnabled ? systemPrompt : systemPrompt.split('\n')
      .filter(line => !line.startsWith('Return ONLY valid JSON'))
      .concat('Return a concise natural-language draft for spoken delivery. Include missing information and proposed next steps in the draft itself. Do not output JSON or claim that citations have been automatically verified. Stay within the requested output limit.').join('\n');
    const run = async () => {
      if (signal?.aborted) throw new Error('cloud_apps_execution_cancelled');
      const result = await complete({ systemPrompt: providerPrompt, history: messages, tools: [], userId,
        entitlements, maxOutputTokens, timeoutMs, signal, textOutputEnabled,
        onUsage: async event => { snapshots++; await usageLedger?.record({ ...event, userId, actionId: cloudApp?.runId, outcome: 'usage_snapshot' }); } });
      await usageLedger?.record({ eventId, userId, actionId: cloudApp?.runId,
        provider: 'gemini-live', model: result.model,
        modality: textOutputEnabled ? 'text' : 'audio_transcript',
        usage: snapshots ? {} : result.usage || {}, outcome: snapshots ? 'completed' : 'completed_usage_snapshot', elapsedMs: Date.now() - started });
      if (textOutputEnabled || result.functionCalls?.length || !String(result.text || '').trim()) return result;
      return { ...result, text: JSON.stringify({ draft: result.text, sourceIds: [],
        unknowns: ['ร่างจากคำตอบเสียง แหล่งอ้างอิงและข้อสรุปยังต้องตรวจสอบโดยผู้ใช้'], nextActions: [] }) };
    };
    try { return gate ? await gate.run(run) : await run(); }
    catch (error) {
      // A failed/aborted request is still an attempted provider call. Usage is
      // unknown unless the provider delivered metadata; never invent a cost.
      await usageLedger?.record({ eventId, userId, actionId: cloudApp?.runId,
        provider: 'gemini-live', modality: 'unknown', usage: {},
        outcome: signal?.aborted ? 'aborted' : 'failed', elapsedMs: Date.now() - started });
      throw error;
    }
  };
  adapter.outputFormat = textOutputEnabled ? 'structured_draft' : 'spoken_draft';
  return adapter;
}
module.exports = { createCloudAppCompletion };
