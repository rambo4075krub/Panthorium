(function (root, factory) {
  'use strict';
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.PanthoriumBillingCatalog = catalog;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
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
    `เสียงเข้า ${n(voice)} / ออก ${n(voice)} นาที`, `เสียงรวม ${n(voice * 2)} นาที`,
    `ข้อความเข้า ${n(input)} โทเคน`, `ข้อความออก ${n(output)} โทเคน`,
    `พื้นที่ ${storage}`, `ดาวน์โหลด ${download}`,
    ...(id === 'free' ? ['เสียงรวมไม่เกิน 1 นาที/วัน'] : [])
  ], price ? 'สมาชิกต่ออายุรายเดือน · โควต้าไม่ทบยอด' : 'แพ็กเกจฟรี · โควต้ารายเดือน', { kind: price ? 'subscription' : 'free', quotas: {voiceInputSeconds:voice*60,voiceOutputSeconds:voice*60,textInputTokens:input,textOutputTokens:output,storageBytes: id==='free' ? 50*1024**2 : Number(storage.split(' ')[0])*1024**3,downloadBytes: id==='free' ? 0 : Number(download.split(' ')[0])*1024**3} }));
  [['S', 59, 20], ['M', 169, 70], ['L', 399, 175], ['XL', 849, 375]].forEach(([size, price, minutes]) => add('voice-' + size.toLowerCase(), 'Voice ' + size, 'voice', price, [
    `เสียงเข้า ${minutes} / ออก ${minutes} นาที`, `เสียงรวม ${minutes * 2} นาที`, 'ไม่รวมโควต้าข้อความถอดเสียงเพิ่มเติม'
  ], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', { kind: 'one-time', verifiedAccountRequired: true, quotas: {voiceInputSeconds:minutes*60,voiceOutputSeconds:minutes*60} }));
  [['S', 29, 150000, 30000], ['M', 99, 500000, 100000], ['L', 249, 1500000, 300000], ['XL', 499, 3000000, 600000]].forEach(([size, price, input, output]) => add('text-' + size.toLowerCase(), 'Text ' + size, 'text', price, [
    `ข้อความเข้า ${n(input)} โทเคน`, `ข้อความออก ${n(output)} โทเคน`, 'ไม่รวมโควต้าเสียงตอบของ Live'
  ], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', { kind: 'one-time', verifiedAccountRequired: true, quotas: {textInputTokens:input,textOutputTokens:output} }));
  [[5, 49, 1], [20, 129, 4], [50, 279, 10], [100, 499, 20]].forEach(([size, price, download]) => add('storage-' + size, 'Storage ' + size, 'storage', price, [
    `พื้นที่เพิ่ม ${size} GiB`, `ดาวน์โหลดเพิ่ม ${download} GiB/รอบ`, 'ไม่เพิ่มโควต้า AI · เฉพาะสมาชิก Life ขึ้นไป'
  ], 'ต่ออายุรายเดือน · การซื้อกลางรอบต้องแจ้งยอดก่อนชำระ', { kind: 'subscription', paidMembershipRequired: true, quotas:{storageBytes:size*1024**3,downloadBytes:download*1024**3} }));
  add('download-10', 'Download 10', 'storage', 99, ['ดาวน์โหลดเพิ่ม 10 GiB', 'ไม่เพิ่มพื้นที่หรือโควต้า AI', 'เฉพาะสมาชิก Life ขึ้นไป'], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', { kind: 'one-time', paidMembershipRequired: true, quotas:{downloadBytes:10*1024**3} });
  // Bangkok-local, end-exclusive: restores the original plan on Dec 1 without a scheduled job.
  const freeTokenPromotion = Object.freeze({
    id: 'free-tokens-20261018', startsAt: '2026-10-18T00:00:00+07:00',
    endsAt: '2026-12-01T00:00:00+07:00', timezone: 'Asia/Bangkok',
    unlimited: Object.freeze(['voiceInputSeconds', 'voiceOutputSeconds', 'textInputTokens', 'textOutputTokens'])
  });
  const promotionAt = (now = Date.now()) => Number(now) >= Date.parse(freeTokenPromotion.startsAt) && Number(now) < Date.parse(freeTokenPromotion.endsAt) ? freeTokenPromotion : null;
  const hasQuota = (state, key) => state.unlimited?.includes(key) || Number(state.remaining?.[key]) > 0;
  const displayDetails = (product, now = Date.now()) => product.id === 'free' && promotionAt(now)
    ? product.details.filter(detail => !detail.startsWith('เสียง')).map(detail => /^ข้อความ(เข้า|ออก)/.test(detail) ? detail.replace(/[\d,]+ โทเคน/, 'ไม่จำกัดโทเคน') : detail).concat('เสียงเข้าและออกไม่จำกัด · ไม่มีโควต้าเสียงรายวัน', 'โปรโมชัน 18 ต.ค.–30 พ.ย. 2026 (เวลาไทย) · กลับโควต้าปกติ 1 ธ.ค. 2026')
    : product.details;
  return Object.freeze({ version: '2026-10-18', promotionAt, hasQuota, displayDetails, taxStatus: 'individual-not-vat-registered', products: Object.freeze(products), get: id => products.find(item => item.id === id) || null });
});
