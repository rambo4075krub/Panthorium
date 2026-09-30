'use strict';
const assert = require('node:assert/strict');
const { ProviderManager } = require('../services/providerManager');

(async () => {
  const manager = new ProviderManager();
  manager.keys.groq = 'fixture-groq';
  manager.keys.openai = 'fixture-openai';
  manager.priority = ['groq', 'openai'];
  const originalFetch = global.fetch;
  let calls = [];
  let responses = [];
  global.fetch = async (url, options) => {
    calls.push({ url, form: options.body });
    return Response.json(responses.shift());
  };
  const response = (text, avgLogprob, noSpeechProb = 0.01) => ({
    text,
    model: 'fixture-whisper',
    segments: [{ avg_logprob: avgLogprob, no_speech_prob: noSpeechProb }]
  });
  try {
    responses = [response('เปิด Sentinel', -1.1), response('เปิด Sentinel', -0.2)];
    const checked = await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(checked.text, 'เปิด Sentinel');
    assert.equal(checked.crossCheckedBy, 'openai', 'uncertain primary transcript must be independently verified');
    assert.equal(calls.length, 2);
    for (const { form } of calls) {
      assert.equal(form.get('response_format'), 'verbose_json');
      assert.equal(form.get('temperature'), '0');
      assert.equal(form.get('language'), 'th');
      assert.match(form.get('prompt'), /ห้ามแปลหรือสรุป/);
      assert.match(form.get('prompt'), /Panthorium.*Sentinel.*Niwat/);
    }

    calls = [];
    responses = [response('เปิด Sentinel', -1.1), response('เปิด Setting', -0.2)];
    await assert.rejects(manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH'), error => error.code === 'transcription_uncertain');
    assert.equal(calls.length, 2, 'disagreeing transcripts must be withheld from AI processing');

    calls = [];
    responses = [response('วันนี้อากาศเป็นอย่างไร', -0.2)];
    const confident = await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(confident.text, 'วันนี้อากาศเป็นอย่างไร');
    assert.equal(calls.length, 1, 'confident speech stays on the fast one-pass path');

    manager.keys.openai = '';
    calls = [];
    responses = [response('เปิด Sentinel', -1.3)];
    await assert.rejects(manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH'), error => error.code === 'transcription_uncertain');
    assert.equal(calls.length, 1);
  } finally { global.fetch = originalFetch; }
  console.log('Transcription quality: Thai/English prompt, deterministic Whisper, low-confidence cross-check and fail-closed mismatch passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
