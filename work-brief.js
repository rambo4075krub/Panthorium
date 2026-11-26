/* Shared review rules, package descriptions and baht formatting. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PanthoriumBrief = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const plans = {
    free: { level: 0, title: 'เทียบคำขอลูกค้ากับบรีฟที่ตกลงแล้ว' },
    life: { level: 1, title: 'ทำบัตรส่งต่องานจากบรีฟและกำหนดส่งจริง' },
    work: { level: 2, title: 'ออกข้อเสนอสองทางเลือก พร้อมราคางานเพิ่ม' },
    'work-pro': { level: 3, title: 'รวมข้อเสนอที่รอคำตอบและยอดที่ลูกค้าตกลงข้ามแฟ้ม' }
  };
  const categories = { included: 'อยู่ในข้อตกลง', extra: 'งานเพิ่ม', schedule: 'เปลี่ยนกำหนดส่ง', clarify: 'ต้องถามเพิ่ม' };
  const statuses = { draft: 'ร่าง', pending: 'รอลูกค้าตอบ', accepted: 'ลูกค้าตกลงแล้ว', declined: 'ลูกค้าไม่รับข้อเสนอ' };
  const sample = {
    baseline: 'วิดีโอแนวนอน 60 วินาที 1 ไฟล์ MP4 ราคา 8,000 บาท\nแก้โลโก้และข้อความได้ 2 รอบ\nกำหนดส่ง 6 ธันวาคม',
    request: 'แก้โลโก้รอบแรก\nเพิ่มคลิปแนวตั้ง 15 วินาที 3 คลิป\nขอเลื่อนส่งเป็น 3 ธันวาคม\nขอไฟล์โปรเจกต์ตัดต่อด้วย'
  };
  const lines = text => text.split(/\r\n?|\n/u).map(line => line.trim()).filter(Boolean);
  const money = satang => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' บาท';
  const normalized = s => s.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
  // An exact line can be proposed as included. Different wording, quantities and
  // revision counts require a human decision. Never infer a contractual right.
  function suggest(baseline, request) {
    const terms = lines(baseline);
    return lines(request).map(text => {
      const exact = terms.findIndex(term => normalized(term) === normalized(text));
      if (exact >= 0) return { text, category: 'included', evidence: exact };
      const schedule = /เลื่อน(?:วัน|เวลา|ส่ง|กำหนด)|(?:ขอ|เปลี่ยน)กำหนดส่ง|ส่งเร็วขึ้น|bring forward|reschedule|move the deadline/iu;
      if (schedule.test(text)) {
        const index = terms.findIndex(term => /กำหนดส่ง|ส่งภายใน|วันส่ง|deadline|due date/iu.test(term));
        return { text, category: 'schedule', evidence: index < 0 ? null : index };
      }
      if (/^(?:ขอ(?:ให้|ทำ)?\s*)?(?:เพิ่ม|ทำเพิ่ม|add\b|additional\b)/iu.test(text)) return { text, category: 'extra', evidence: null };
      return { text, category: 'clarify', evidence: null };
    });
  }
  function quoteText(review, baseline) {
    const quote = review.quote;
    return ['ทางเลือก 1 · ทำตามบรีฟเดิม', baseline.text, '', 'ทางเลือก 2 · เพิ่มงานต่อไปนี้',
      ...quote.items.map(item => item.label + ' × ' + item.quantity + ' @ ' + money(item.unitSatang) + ' = ' + money(item.quantity * item.unitSatang)),
      'เพิ่มจากราคาเดิมรวม ' + money(quote.totalSatang),
      ...(quote.delivery ? ['กำหนดส่งที่เสนอ ' + quote.delivery] : []),
      'รบกวนยืนยันทางเลือกและกำหนดส่งก่อนเริ่มงานเพิ่มเติม'].join('\n');
  }
  function replyText(review, baseline) {
    const results = review.rows.map(row => categories[row.category] + ' · ' + row.text +
      (row.evidence === null ? '' : '\n  อ้างอิง “' + lines(baseline.text)[row.evidence] + '”'));
    return ['ขอสรุปคำขอเทียบกับบรีฟที่ตกลงกัน', ...results, 'รบกวนยืนยันรายการที่ต้องตกลงเพิ่มเติมก่อนเริ่มงาน ขอบคุณครับ/ค่ะ'].join('\n');
  }
  return { plans, categories, statuses, sample, lines, money, suggest, quoteText, replyText };
});
