(function (root, factory) {
  'use strict';
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PanthoriumBillingCatalog = catalog;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Fixed service units, not money or provider prices. Preserve the full value of
  // all four old allowances when moving an existing grant into the shared pool.
  const aiRates = Object.freeze({voiceInputSeconds:100,voiceOutputSeconds:500,textInputTokens:1,textOutputTokens:5});
  const aiKeys = Object.freeze(Object.keys(aiRates));
  const quotaPolicy = Object.freeze({version:'ai-credits-v1',unit:'aiCredits',rates:aiRates});
  function creditCost(usage = {}) {
    let total = 0;
    for (const key of aiKeys) {
      const value = usage[key] ?? 0;
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_usage');
      total += value * aiRates[key];
      if (!Number.isSafeInteger(total)) throw new Error('invalid_usage');
    }
    return total;
  }
  function creditBalance(quotas = {}, used = {}) {
    const total = quotas.aiCredits ?? creditCost(quotas);
    const spent = (used.aiCredits || 0) + creditCost(used);
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(spent) || spent < 0) throw new Error('invalid_usage');
    return Math.max(0, total - spent);
  }
  const serviceDescription = 'Panthorium คือบริการผู้ช่วย AI ผ่านเว็บไซต์และแอป สำหรับถามตอบ สรุปข้อมูล ช่วยร่างข้อความ และสั่งงานเครื่องมือที่เปิดใช้งาน โดยพิมพ์ข้อความหรือพูดผ่านไมโครโฟน แล้วรับคำตอบเป็นข้อความหรือเสียง';
  const usageExplanation = 'Sentinel AI ใช้เครดิตร่วมสำหรับเสียงและข้อความตามแพ็กเกจของบัญชี เมื่อเครดิตไม่พอ ต้องรอรอบสิทธิ์ใหม่หรือเพิ่มเครดิตก่อนใช้งานต่อ ข้อความที่ส่งให้ AI รวมคำถาม คำสั่ง และบริบทที่จำเป็น โทเคนเป็นหน่วยย่อยของข้อความ ไม่ใช่จำนวนข้อความหรือจำนวนคำตายตัว โควต้านี้ไม่ใช่แพ็กเกจ SMS ค่าโทรศัพท์ หรือการส่งข้อความโฆษณา';
  const conversionDetails = Object.freeze(['ข้อความที่ส่งให้ AI 1 โทเคน = 1 เครดิต', 'คำตอบข้อความจาก AI 1 โทเคน = 5 เครดิต', 'เสียงที่ส่งให้ AI 1 วินาที = 100 เครดิต', 'เสียงคำตอบจาก AI 1 วินาที = 500 เครดิต']);
  const refundSummary = 'ไม่มีหักเงินต่ออายุอัตโนมัติ หากชำระซ้ำ ไม่ได้รับสิทธิ์ หรือบริการมีปัญหา ติดต่อ account@panthorium.net พร้อมเลขคำสั่งซื้อเพื่อขอยกเลิกหรือคืนเงิน ผู้ให้บริการตรวจสอบรายการและสิทธิ์ตามกฎหมายก่อนแจ้งผล ไม่จำกัดสิทธิ์ผู้บริโภคตามกฎหมาย';
  const products = [];
  function add(id, name, category, price, details, term, extra = {}) {
    products.push(Object.freeze({ id, name, category, price, amountSatang: price * 100, currency: 'THB', details: Object.freeze(details), term, ...extra }));
  }
  const plans = [
    ['free', 'Free', 0, 2.5, 5000, 1000, '50 MiB', 'ไม่ได้'],
    ['life', 'Life', 189, 65, 62500, 12500, '1 GiB', '1 GiB'],
    ['work', 'Work', 489, 200, 200000, 40000, '3 GiB', '2 GiB'],
    ['work-pro', 'Work Pro', 1089, 450, 600000, 120000, '5 GiB', '3 GiB']
  ];
  const n = value => value.toLocaleString('th-TH');
  plans.forEach(([id, name, price, voice, input, output, storage, download]) => add(id, name, 'membership', price, [
    `เครดิต Sentinel AI รวม ${n(creditCost({voiceInputSeconds:voice*60,voiceOutputSeconds:voice*60,textInputTokens:input,textOutputTokens:output}))} เครดิต/เดือน`,
    'Sentinel AI ใช้เสียงและข้อความจากยอดเดียวกัน',
    `พื้นที่ ${storage}`, `ดาวน์โหลด ${download}`
  ], price ? 'รอบ 1 เดือน · ชำระใหม่เมื่อต้องการต่ออายุ · โควต้าไม่ทบยอด' : 'แพ็กเกจฟรี · โควต้ารายเดือน', { kind: price ? 'subscription' : 'free', quotaPolicy, quotas: {aiCredits:creditCost({voiceInputSeconds:voice*60,voiceOutputSeconds:voice*60,textInputTokens:input,textOutputTokens:output}),storageBytes: id==='free' ? 50*1024**2 : Number(storage.split(' ')[0])*1024**3,downloadBytes: id==='free' ? 0 : Number(download.split(' ')[0])*1024**3} }));
  function aiAddon(id, price, credits) {
    add(id, 'AI ' + n(credits), 'ai', price, [`เครดิต Sentinel AI รวม ${n(credits)} เครดิต`, 'ใช้ได้ทั้งเสียงและข้อความจากยอดเดียวกัน'], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', {kind:'one-time',verifiedAccountRequired:true,quotaPolicy,quotas:{aiCredits:credits}});
  }
  // Stable IDs keep pending orders, payment receipts and historical grants valid.
  [['S', 59, 20], ['M', 169, 70], ['L', 399, 175], ['XL', 849, 375]].forEach(([size, price, minutes]) => aiAddon('voice-'+size.toLowerCase(),price,creditCost({voiceInputSeconds:minutes*60,voiceOutputSeconds:minutes*60})));
  [['S', 29, 150000, 30000], ['M', 99, 500000, 100000], ['L', 249, 1500000, 300000], ['XL', 499, 3000000, 600000]].forEach(([size, price, input, output]) => aiAddon('text-'+size.toLowerCase(),price,creditCost({textInputTokens:input,textOutputTokens:output})));
  [[5, 49, 1], [20, 129, 4], [50, 279, 10], [100, 499, 20]].forEach(([size, price, download]) => add('storage-' + size, 'Storage ' + size, 'storage', price, [
    `พื้นที่เพิ่ม ${size} GiB`, `ดาวน์โหลดเพิ่ม ${download} GiB/รอบ`, 'ไม่เพิ่มโควต้า AI · เฉพาะสมาชิก Life ขึ้นไป'
  ], 'ต่ออายุรายเดือน · การซื้อกลางรอบต้องแจ้งยอดก่อนชำระ', { kind: 'subscription', paidMembershipRequired: true, quotas:{storageBytes:size*1024**3,downloadBytes:download*1024**3} }));
  add('download-10', 'Download 10', 'storage', 99, ['ดาวน์โหลดเพิ่ม 10 GiB', 'ไม่เพิ่มพื้นที่หรือโควต้า AI', 'เฉพาะสมาชิก Life ขึ้นไป'], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', { kind: 'one-time', paidMembershipRequired: true, quotas:{downloadBytes:10*1024**3} });
  // Bangkok-local, end-exclusive: restores the original plan on Dec 1 without a scheduled job.
  const freeTokenPromotion = Object.freeze({
    id: 'free-tokens-20261018', startsAt: '2026-10-18T00:00:00+07:00',
    endsAt: '2026-12-01T00:00:00+07:00', timezone: 'Asia/Bangkok',
    unlimited: Object.freeze(['aiCredits', ...aiKeys])
  });
  const promotionAt = (now = Date.now()) => Number(now) >= Date.parse(freeTokenPromotion.startsAt) && Number(now) < Date.parse(freeTokenPromotion.endsAt) ? freeTokenPromotion : null;
  const hasQuota = (state, key) => {
    if (key === 'aiCredits' || aiKeys.includes(key)) {
      if (state.unlimited?.includes('aiCredits')) return true;
      if (Object.prototype.hasOwnProperty.call(state.remaining || {}, 'aiCredits')) return Number(state.remaining.aiCredits) >= (aiRates[key] || 1);
      if (key === 'aiCredits') return aiKeys.some(k => state.unlimited?.includes(k) || Number(state.remaining?.[k]) > 0);
    }
    return state.unlimited?.includes(key) || Number(state.remaining?.[key]) > 0;
  };
  const displayDetails = (product, now = Date.now()) => product.id === 'free' && promotionAt(now)
    ? product.details.map(detail => detail.startsWith('เครดิต Sentinel AI รวม') ? 'เครดิต Sentinel AI รวมไม่จำกัด ทั้งเสียงและข้อความในช่วงโปรโมชัน' : detail).concat('โปรโมชัน 18 ต.ค.–30 พ.ย. 2026 (เวลาไทย) · กลับโควต้าปกติ 1 ธ.ค. 2026')
    : product.details;
  return Object.freeze({ version: '2026-11-05', aiRates, aiKeys, quotaPolicy, creditCost, creditBalance, serviceDescription, usageExplanation, conversionDetails, refundSummary, promotionAt, hasQuota, displayDetails, taxStatus: 'individual-not-vat-registered', products: Object.freeze(products), get: id => products.find(item => item.id === id) || null });
});
