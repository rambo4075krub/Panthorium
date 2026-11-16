(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PanthoriumScreenVoiceCatalog = catalog;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function parse(input) {
    if (typeof input !== 'string' || input.length > 2000) return null;
    const request = input.normalize('NFC').trim().replace(/^(?:ช่วย|กรุณา|please\s+)/iu, '').trim();
    // Dictation is literal, including trailing Thai polite words in the value.
    const fill = /^(?:กรอก|พิมพ์(?:ใน)?|ใส่(?:ใน)?)\s*ช่อง\s*(.+?)\s*(?:ว่า|เป็น)\s*([\s\S]+)$|^fill\s+(.+?)\s+with\s+([\s\S]+)$/iu.exec(request);
    if (fill) return { action:'fill', target:(fill[1] || fill[3]).trim(), value:(fill[2] || fill[4]).trim() };
    const text = request.replace(/(?:ให้หน่อย|หน่อย|ครับ|ค่ะ|คะ|please)[.!?\s]*$/iu, '').trim();
    if (/^(?:อย่า|ห้าม|ไม่ต้อง|do not\b|don't\b)/iu.test(text)) return null;
    if (/^(?:อ่าน|สรุป)(?:เนื้อหา)?(?:หน้า(?:เว็บ)?นี้|หน้าปัจจุบัน|หน้าที่(?:กำลัง)?เปิดอยู่|หน้าจอนี้|หน้าต่างนี้)(?:ให้ฟัง|ให้หน่อย|หน่อย)?$/u.test(text) || /^(?:read|summarize) (?:this|the current|the active) (?:page|window|screen)$/iu.test(text)) return { action: /^(?:สรุป|summarize)/iu.test(text) ? 'summarize' : 'read' };
    if (/^(?:มีปุ่มอะไรบ้าง|แสดงปุ่ม|แสดงปุ่มในหน้านี้|คำสั่งในหน้านี้|list (?:controls|buttons))$/iu.test(text)) return { action: 'list' };
    const scroll = /^(?:เลื่อน(?:หน้า)?\s*(ขึ้น|ลง|บนสุด|ล่างสุด)|scroll (up|down|top|bottom))$/iu.exec(text);
    if (scroll) return { action: 'scroll', direction: ({ขึ้น:'up',ลง:'down',บนสุด:'top',ล่างสุด:'bottom'})[scroll[1]] || scroll[2].toLowerCase() };
    const click = /^(?:กด(?:ปุ่ม)?|คลิก(?:ปุ่ม)?|เลือกปุ่ม|click(?: button)?\s)\s*(.+)$/iu.exec(text);
    if (click) return { action:'click', target:click[1].trim() };
    const focus = /^(?:เลือกช่อง|โฟกัสช่อง|focus(?: field)?\s)\s*(.+)$/iu.exec(text);
    if (focus) return { action:'focus', target:focus[1].trim() };
    return null;
  }
  const toAction = (command, id) => 'screen_command:' + encodeURIComponent(command) + '#' + id;
  return { parse, toAction };
});
