(function (root, factory) {
  'use strict';
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PanthoriumBillingCatalog = catalog;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Fixed service units, not money or provider prices. Preserve the full value of
  // all four old allowances when moving an existing grant into the shared pool.
  const aiRates = Object.freeze({voiceInputSeconds:100,voiceOutputSeconds:500,textInputTokens:1,textOutputTokens:5,thinkingTokens:5,audioInputTokens:4,audioOutputTokens:14,imageInputTokens:2,videoInputTokens:2,toolInputTokens:1,unclassifiedInputTokens:4,unclassifiedOutputTokens:14,estimatedTranscriptionTokens:5});
  const aiKeys = Object.freeze(Object.keys(aiRates));
  const quotaPolicy = Object.freeze({version:'ai-credits-v2',unit:'aiCredits',rates:aiRates});
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
  const usageExplanation = 'Sentinel AI ใช้เครดิตร่วมสำหรับข้อความ เสียง การคิด บริบท ผลเครื่องมือ และภาพหรือวิดีโอที่ส่งเข้าตามแพ็กเกจของบัญชี เมื่อเครดิตไม่พอ ต้องรอรอบสิทธิ์ใหม่หรือเพิ่มเครดิตก่อนใช้งานต่อ ข้อความที่ส่งให้ AI รวมคำถาม คำสั่ง และบริบทที่จำเป็น โทเคนเป็นหน่วยข้อมูลที่ใช้ประมวลผล ไม่ใช่จำนวนข้อความหรือจำนวนคำตายตัว โควต้านี้ไม่ใช่แพ็กเกจ SMS ค่าโทรศัพท์ หรือการส่งข้อความโฆษณา';
  const conversionDetails = Object.freeze(['ข้อความและผลเครื่องมือที่ส่งให้ AI 1 โทเคน = 1 เครดิต', 'คำตอบข้อความและการคิดของ AI 1 โทเคน = 5 เครดิต', 'เสียงเข้า 1 โทเคน = 4 เครดิต · เสียงออก 1 โทเคน = 14 เครดิต', 'ภาพและวิดีโอที่ส่งให้ AI 1 โทเคน = 2 เครดิต', 'รวมบริบทที่ประมวลผลซ้ำตามยอดรายงานจริง ไม่ใช่เฉพาะคำถามล่าสุด', 'เมื่อผู้ให้บริการไม่แจกแจงชนิดของโทเคน ใช้อัตราเผื่อขาเข้า 4 / ขาออก 14 เครดิตต่อโทเคน ส่วนข้อความถอดเสียงที่ไม่มีจำนวนโทเคนใช้จำนวนไบต์ UTF-8 เป็นเพดานประมาณการ และแยกบันทึกจากยอดที่วัดได้']);
  const refundSummary = "แพ็กเกจและโควต้าที่ชำระแล้วไม่รับคืนเงินตามความสมัครใจ เช่น เปลี่ยนใจ ไม่ได้ใช้งาน ใช้ไม่หมด หรือหยุดใช้ก่อนครบกำหนด ไม่มีการหักเงินต่ออายุอัตโนมัติ เงื่อนไขนี้ไม่ตัดสิทธิตามกฎหมายหรือข้อกำหนดของผู้ให้บริการชำระเงินและร้านค้าแอป หากชำระซ้ำ ยอดผิด ไม่ได้รับสิทธิ์ หรือสงสัยรายการที่ไม่ได้อนุญาต ให้ติดต่อ account@panthorium.net พร้อมเลขคำสั่งซื้อเพื่อตรวจสอบและแก้ไข";
  const products = [];
  function add(id, name, category, price, details, term, extra = {}) {
    products.push(Object.freeze({ id, name, category, price, amountSatang: price * 100, currency: 'THB', details: Object.freeze(details), term, ...extra }));
  }
  const plans = [
    ['free', 'Free', 0, 5000, 50*1024**2, 0],
    ['life', 'Life', 189, 750000, 1024**3, 1024**3],
    ['work', 'Work', 489, 2300000, 3*1024**3, 2*1024**3],
    ['work-pro', 'Work Pro', 1589, 8000000, 5*1024**3, 3*1024**3]
  ];
  const n = value => value.toLocaleString('th-TH');
  plans.forEach(([id, name, price, credits, storageBytes, downloadBytes]) => add(id, name, 'membership', price, [
    `ข้อความเข้าอย่างเดียวสูงสุด ${n(credits)} โทเคน/เดือน`,
    `หรือคำตอบและการคิดอย่างเดียวสูงสุด ${n(Math.floor(credits/5))} โทเคน/เดือน`,
    'ใช้โควต้าก้อนเดียวกัน รวมเสียงและภาพนำเข้า ไม่ใช่ได้เต็มทั้งสองจำนวน',
    `พื้นที่ ${id==='free'?'50 MiB':storageBytes/1024**3+' GiB'}`,
    `ดาวน์โหลด ${downloadBytes?downloadBytes/1024**3+' GiB':'ไม่ได้'}`
  ], price ? 'รอบ 1 เดือน · ชำระใหม่เมื่อต้องการต่ออายุ · โควต้าไม่ทบยอด' : 'แพ็กเกจฟรี · โควต้ารายเดือน', { kind: price ? 'subscription' : 'free', quotaPolicy, quotas: {aiCredits:credits,storageBytes,downloadBytes} }));
  function aiAddon(id, price, credits) {
    add(id, 'AI · ขาเข้าสูงสุด ' + n(credits) + ' โทเคน', 'ai', price, [`ข้อความเข้าอย่างเดียวสูงสุด ${n(credits)} โทเคน`, `หรือคำตอบและการคิดอย่างเดียวสูงสุด ${n(Math.floor(credits/5))} โทเคน`, 'ใช้โควต้าก้อนเดียวกัน รวมเสียงและภาพนำเข้า'], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', {kind:'one-time',verifiedAccountRequired:true,quotaPolicy,quotas:{aiCredits:credits}});
  }
  // Stable IDs keep pending orders, payment receipts and historical grants valid.
  [['S',59,250000],['M',169,850000],['L',399,2200000],['XL',849,4500000]].forEach(([size,price,credits])=>aiAddon('voice-'+size.toLowerCase(),price,credits));
  [['S',29,70000],['M',99,500000],['L',249,1300000],['XL',499,2700000]].forEach(([size,price,credits])=>aiAddon('text-'+size.toLowerCase(),price,credits));
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
    ? product.details.filter(detail=>!detail.startsWith('หรือคำตอบและการคิดอย่างเดียว')).map(detail => detail.startsWith('ข้อความเข้าอย่างเดียวสูงสุด') ? 'โควต้า Sentinel AI ไม่จำกัด ทั้งเสียงและข้อความในช่วงโปรโมชัน' : detail).concat('โปรโมชัน 18 ต.ค.–30 พ.ย. 2026 (เวลาไทย) · กลับโควต้าปกติ 1 ธ.ค. 2026')
    : product.details;
  return Object.freeze({ version: '2026-11-18', aiRates, aiKeys, quotaPolicy, creditCost, creditBalance, serviceDescription, usageExplanation, conversionDetails, refundSummary, promotionAt, hasQuota, displayDetails, taxStatus: 'individual-not-vat-registered', products: Object.freeze(products), get: id => products.find(item => item.id === id) || null });
});
