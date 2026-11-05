'use strict';
const assert = require('node:assert/strict');
const { removeThaiPoliteParticles: clean, VOICE_STYLE_INSTRUCTION } = require('../services/voiceStyle');
const { createSetupMessage } = require('../services/geminiLiveVertex');
const { Sentinel } = require('../services/sentinel');
for (const suffix of ['ครับ', 'ค่ะ', 'คะ', 'นะครับ', 'นะคะ', 'ครับผม']) {
  assert.equal(clean('ดำเนินการเรียบร้อยแล้ว' + suffix), 'ดำเนินการเรียบร้อยแล้ว');
  assert.equal(clean('พร้อมแล้ว ' + suffix + '!'), 'พร้อมแล้ว!');
}
assert.equal(clean('สวัสดีครับ วันนี้พร้อมค่ะ\nเริ่มได้เลยนะคะ'), 'สวัสดี วันนี้พร้อม\nเริ่มได้เลย');
assert.equal(clean('ตอบได้ครับผม ต่อไปทำอะไรคะ'), 'ตอบได้ ต่อไปทำอะไร');
assert.equal(clean('ราคะ และคำว่า “ครับ” รวมถึง `ค่ะ`'), 'ราคะ และคำว่า “ครับ” รวมถึง `ค่ะ`');
assert.equal(clean('ราคา 546.02 บาทครับ'), 'ราคา 546.02 บาท');
assert.equal(clean('ครับ'), '');
assert.equal(Sentinel.prototype.normalizeVoiceAnswer({ok:true,text:'เสร็จแล้วนะครับ'}).text, 'เสร็จแล้ว');
assert(Sentinel.prototype.voiceLanguageGuard().includes(VOICE_STYLE_INSTRUCTION));
for (const responseModality of ['audio', 'text']) {
  const setup = createSetupMessage({model:'test',systemInstruction:'existing instruction',responseModality}).setup;
  assert(setup.system_instruction.parts[0].text.startsWith('existing instruction'));
  assert(setup.system_instruction.parts[0].text.endsWith(VOICE_STYLE_INSTRUCTION));
}
console.log('Voice style: Thai endings removed, real words/quotes/decimals preserved, Gemini audio and text instructions enforced');
