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
    const clearer = await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(clearer.text, 'เปิด Setting', 'use a substantially clearer independent transcript when the other recognizer is weak');
    assert.equal(calls.length, 2);

    calls = [];
    responses = [response('วันนี้อากาศเป็นอย่างไร', -0.2), response('วันนี้อากาศเป็นอย่างไร', -0.35)];
    const confident = await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(confident.text, 'วันนี้อากาศเป็นอย่างไร');
    assert.equal(calls.length, 2, 'even confident speech is verified by a second recognizer to catch plausible mishears');

    calls = [];
    responses = [response('เปิด Learning Lab', -0.15), response('เปิด Learning Lab', -0.2)];
    await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(calls.length, 2, 'confident matching models can pass');

    calls = [];
    responses = [response('เปิด Learning Lab', -0.15), response('เปิด Learning Lab settings', -0.2)];
    await assert.rejects(manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH'), error => error.code === 'transcription_uncertain');
    assert.equal(calls.length, 2, 'confident model disagreement must be withheld from chat');

    calls = [];
    responses = [response('วันนี้อากาศเป็นอย่างไร', -0.8), response('วันนี้อากาศเป็นอย่างไร', -0.75)];
    const consensus = await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(consensus.text, 'วันนี้อากาศเป็นอย่างไร', 'matching model outputs should pass even when confidence metadata is low');
    assert.equal(calls.length, 2);

    calls = [];
    responses = [response('วันนี้อากาศเป็นอย่างไร', -0.3), response('วันนี้อากาศเป็นอย่างไรบ้าง', -0.4)];
    const nearMatch = await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(nearMatch.text, 'วันนี้อากาศเป็นอย่างไร', 'minor Thai transcript differences should not trigger repeat prompts');

    manager.keys.openai = '';

    manager.priority = ['groq'];
    calls = [];
    responses = [response('เปิด Sentinel', -1.3)];
    await assert.rejects(manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH'), error => error.code === 'transcription_uncertain');
    assert.equal(calls.length, 1);
    calls = [];
    responses = [response('วันนี้อากาศเป็นอย่างไร', -0.2)];
    const singleProvider = await manager.transcribeAudio(Buffer.from('fixture audio'), 'audio/webm', 'th-TH');
    assert.equal(singleProvider.text, 'วันนี้อากาศเป็นอย่างไร');
    assert.equal(calls.length, 1, 'a sole provider remains usable when its signal confidence is strong');
  } finally { global.fetch = originalFetch; }
  console.log('Transcription quality: Thai/English prompt, deterministic Whisper, low-confidence cross-check and fail-closed mismatch passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
