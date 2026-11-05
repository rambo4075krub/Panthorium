'use strict';

const VOICE_STYLE_INSTRUCTION = 'รูปแบบคำตอบเสียง: พูดอย่างเป็นธรรมชาติและตรงประเด็น โดยไม่เติมหางเสียง ครับ ค่ะ คะ นะครับ นะคะ หรือ ครับผม จบประโยคที่เนื้อหา เช่น "ดำเนินการเรียบร้อยแล้ว" ใช้ข้อกำหนดนี้กับเสียงที่สร้างจริง ไม่ใช่เฉพาะข้อความถอดเสียง คงข้อความอ้างอิงหรือข้อความยืนยันการกระทำที่ต้องอ่านตรงตัว แต่ห้ามเติมคำลงท้ายของผู้ช่วย';
const segmenter = new Intl.Segmenter('th', { granularity: 'word' });

function stripParticles(text) {
  const boundaries = new Set([...segmenter.segment(text)].map(part => part.index));
  return text.replace(/(?:นะ[ \t]*)?(?:ครับผม|ครับ|ค่ะ|คะ)(?=\s|[,.!?;:…。、]|$)/g,
    (match, index) => boundaries.has(index) ? '' : match);
}

function removeThaiPoliteParticles(value) {
  const text = String(value || '');
  // Preserve quoted words/code, and use Thai word boundaries so a real word
  // ending in the same characters (e.g. ราคะ) is never damaged.
  const protectedText = /```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/g;
  let output = '', offset = 0;
  for (const match of text.matchAll(protectedText)) {
    output += stripParticles(text.slice(offset, match.index)) + match[0];
    offset = match.index + match[0].length;
  }
  return (output + stripParticles(text.slice(offset))).replace(/[ \t]+([,.!?;:…。、\n])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

module.exports = { VOICE_STYLE_INSTRUCTION, removeThaiPoliteParticles };
