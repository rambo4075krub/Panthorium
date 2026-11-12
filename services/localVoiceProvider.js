'use strict';
const { accountKey } = require('./localWorkIdentity');

function voiceOrigin(env = process.env) {
  const url = new URL(env.LOCAL_VOICE_URL || 'http://127.0.0.1:8765');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid_local_voice_endpoint');
  return url.origin;
}
function requestSignal(signal, ms) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms); }
async function speech(text, { userId, signal } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error('invalid_speech_request');
  const response = await fetch(voiceOrigin() + '/speech', { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-Panthorium-Account': accountKey(userId) },
    body: JSON.stringify({ text, voice: 'th_m_1', speed: 1 }), signal: requestSignal(signal, 110000) });
  if (!response.ok) throw new Error('local_voice_unavailable');
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > 8 * 1024 * 1024 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('invalid_speech_audio');
  return { audio, voice: 'local-th_m_1', contentType: 'audio/wav' };
}
async function transcribe(buffer, mimeType, { userId, signal } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 1024 * 1024) throw new Error('invalid_audio');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), 'speech.webm');
  const response = await fetch(voiceOrigin() + '/transcribe', { method: 'POST', redirect: 'error',
    headers: { 'X-Panthorium-Account': accountKey(userId) }, body: form, signal: requestSignal(signal, 140000) });
  if (!response.ok) throw new Error('local_transcription_unavailable');
  const value = await response.json();
  if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('transcription_uncertain');
  return { text: value.text.slice(0, 2000), provider: 'local', model: 'local-asr', creditsCharged: 0 };
}
module.exports = { voiceOrigin, speech, transcribe };
