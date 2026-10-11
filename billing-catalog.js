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
  ], price ? 'สมาชิกต่ออายุรายเดือน · โควต้าไม่ทบยอด' : 'แพ็กเกจฟรี · โควต้ารายเดือน', { kind: price ? 'subscription' : 'free' }));
  [['S', 59, 20], ['M', 169, 70], ['L', 399, 175], ['XL', 849, 375]].forEach(([size, price, minutes]) => add('voice-' + size.toLowerCase(), 'Voice ' + size, 'voice', price, [
    `เสียงเข้า ${minutes} / ออก ${minutes} นาที`, `เสียงรวม ${minutes * 2} นาที`, 'ไม่รวมโควต้าข้อความถอดเสียงเพิ่มเติม'
  ], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', { kind: 'one-time', verifiedAccountRequired: true }));
  [['S', 29, 150000, 30000], ['M', 99, 500000, 100000], ['L', 249, 1500000, 300000], ['XL', 499, 3000000, 600000]].forEach(([size, price, input, output]) => add('text-' + size.toLowerCase(), 'Text ' + size, 'text', price, [
    `ข้อความเข้า ${n(input)} โทเคน`, `ข้อความออก ${n(output)} โทเคน`, 'ไม่รวมโควต้าเสียงตอบของ Live'
  ], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', { kind: 'one-time', verifiedAccountRequired: true }));
  [[5, 49, 1], [20, 129, 4], [50, 279, 10], [100, 499, 20]].forEach(([size, price, download]) => add('storage-' + size, 'Storage ' + size, 'storage', price, [
    `พื้นที่เพิ่ม ${size} GiB`, `ดาวน์โหลดเพิ่ม ${download} GiB/รอบ`, 'ไม่เพิ่มโควต้า AI · เฉพาะสมาชิก Life ขึ้นไป'
  ], 'ต่ออายุรายเดือน · การซื้อกลางรอบต้องแจ้งยอดก่อนชำระ', { kind: 'subscription', paidMembershipRequired: true }));
  add('download-10', 'Download 10', 'storage', 99, ['ดาวน์โหลดเพิ่ม 10 GiB', 'ไม่เพิ่มพื้นที่หรือโควต้า AI', 'เฉพาะสมาชิก Life ขึ้นไป'], 'ซื้อครั้งเดียว · อายุ 30 วันนับจากชำระ', { kind: 'one-time', paidMembershipRequired: true });
  return Object.freeze({ version: '2026-10-11', taxStatus: 'individual-not-vat-registered', products: Object.freeze(products), get: id => products.find(item => item.id === id) || null });
});
