'use strict';

// All URLs in this small editorial index are first-party destination pages.
// It is also served with the search page so matches appear before network results.
const PanthoriumSearchDirectory = (() => {
  const collections = {
    stay: ['โรงแรม', 'กรุงเทพฯ ริมน้ำ ริมแม่น้ำ ริมเจ้าพระยา ริมแม่น้ำเจ้าพระยา ที่พัก สวีท โรงแรมริมน้ำ โรงแรมหรู bangkok riverside river chao phraya hotel hotels suites luxury'],
    dine: ['อาหาร', 'กรุงเทพฯ ร้านอาหาร ไฟน์ไดนิ่ง ไฟน์ไดนิง อาหารไทย เมนู คอร์ส ดินเนอร์ bangkok fine dining restaurant restaurants tasting menu dinner'],
    art: ['ศิลปะ', 'กรุงเทพฯ ศิลปะ นิทรรศการศิลปะ หอศิลป์ แกลเลอรี แกลเลอรี่ bangkok art gallery galleries exhibitions']
  };
  const entries = [
    ['stay', 'Mandarin Oriental, Bangkok', 'https://www.mandarinoriental.com/en/bangkok/chao-phraya-river',
      'บางรัก · กรุงเทพฯ', 'ดูห้องพัก ห้องสวีท และห้องอาหารของโรงแรมริมแม่น้ำเจ้าพระยา', 'แมนดาริน โอเรียนเต็ล โอเรียนทัล mandarin oriental'],
    ['stay', 'Capella Bangkok', 'https://capellahotels.com/en/capella-bangkok',
      'เจริญกรุง · กรุงเทพฯ', 'สำรวจห้องพักและวิลล่าริมน้ำ รวมถึงประสบการณ์ที่โรงแรมจัดให้ผู้เข้าพัก', 'คาเพลลา คาเปลลา วิลล่า capella villas'],
    ['stay', 'Four Seasons Hotel Bangkok', 'https://www.fourseasons.com/bangkok/',
      'เจริญกรุง · กรุงเทพฯ', 'ดูห้องพัก งานออกแบบ และร้านอาหารของโรงแรมโฟร์ซีซั่นส์ริมเจ้าพระยา', 'โฟร์ซีซั่นส์ โฟร์ซีซันส์ four seasons'],
    ['dine', 'Nusara · นุสรา', 'https://www.nusarabkk.com/',
      'ท่าเตียน · กรุงเทพฯ', 'อ่านที่มาของอาหารไทยสไตล์นุสรา และเปิดหน้าจองโต๊ะของร้าน', 'นุสรา เชฟต้น nusara tha tien'],
    ['dine', 'Le Du · ฤดู', 'https://www.ledubkk.com/',
      'สีลม · กรุงเทพฯ', 'ดูเทสติงเมนูที่ใช้วัตถุดิบไทยตามฤดูกาล และรายละเอียดการจองกับร้าน', 'เลอดู ฤดู le du silom'],
    ['dine', 'MICHELIN Guide Bangkok', 'https://guide.michelin.com/th/en/bangkok-region/bangkok/restaurants',
      'กรุงเทพฯ และพื้นที่ใกล้เคียง', 'เปิดคู่มือของมิชลินเพื่อกรองร้านตามย่าน ประเภทอาหาร และระดับราคา', 'มิชลิน มิชลินไกด์ michelin guide'],
    ['art', 'Bangkok Art and Culture Centre', 'https://www.bacc.or.th/',
      'ปทุมวัน · กรุงเทพฯ', 'ดูนิทรรศการ กิจกรรม และข้อมูลการเข้าชมหอศิลปวัฒนธรรมแห่งกรุงเทพมหานคร', 'หอศิลป์กรุงเทพ หอศิลปกรุงเทพ หอศิลปวัฒนธรรม bacc'],
    ['art', 'River City Bangkok', 'https://rivercitybangkok.com/',
      'สี่พระยา · กรุงเทพฯ', 'ดูโปรแกรมนิทรรศการ แกลเลอรี และกิจกรรมสำหรับนักสะสมที่ริเวอร์ ซิตี้', 'ริเวอร์ซิตี้ ริเวอร์ ซิตี้ นักสะสม river city rcb'],
    ['art', 'MOCA Bangkok', 'https://www.mocabangkok.com/',
      'จตุจักร · กรุงเทพฯ', 'สำรวจคอลเล็กชันศิลปะร่วมสมัย รายชื่อศิลปิน และข้อมูลสำหรับวางแผนเข้าชม', 'โมค่า โมคา พิพิธภัณฑ์ศิลปะไทยร่วมสมัย museum moca'],
    [null, 'The Great Wave · Katsushika Hokusai', 'https://www.metmuseum.org/art/collection/search/45434',
      'The Metropolitan Museum of Art · นิวยอร์ก', 'ดูภาพพิมพ์คลื่นยักษ์แห่งคานางาวะของโฮกูไซ พร้อมข้อมูลชิ้นงานจากพิพิธภัณฑ์เจ้าของคอลเล็กชัน', 'the great wave kanagawa hokusai met museum โฮกูไซ คลื่นยักษ์ คานางาวะ ภาพพิมพ์']
  ];
  const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  const stop = new Set(['a', 'an', 'the', 'in', 'of', 'at', 'for', 'and', 'official', 'website', 'เว็บไซต์', 'ทางการ', 'ที่', 'ใน', 'ของ', 'และ', 'ย่าน', 'หา', 'ค้นหา', 'ฯ']);
  const places = new Set(['กรุงเทพ', 'bangkok']);
  function words(text) {
    const normalized = normalize(text);
    const parts = segmenter ? Array.from(segmenter.segment(normalized), part => part.isWordLike ? part.segment : '') : normalized.split(/\s+/);
    return parts.filter(word => word && !stop.has(word))
      .map(word => word === 'กรุงเทพฯ' || word === 'กรุงเทพมหานคร' ? 'กรุงเทพ' : word);
  }
  const index = entries.map(([group, title, url, place, excerpt, aliases]) => {
    const [category, tags] = collections[group] || ['ศิลปะ', ''];
    const names = new Set(words(title + ' ' + aliases + ' ' + new URL(url).hostname));
    const terms = new Set([...names, ...words([category, tags, place].join(' '))]);
    return { names, terms, result: { title, url, place, excerpt, category, kind: 'selected', source: 'Panthorium Select' } };
  });
  function match(query) {
    const tokens = [...new Set(words(query))];
    if (!tokens.some(token => !places.has(token))) return [];
    return index.filter(site => tokens.every(token => site.terms.has(token)))
      .sort((a, b) => tokens.filter(token => b.names.has(token)).length - tokens.filter(token => a.names.has(token)).length)
      .map(site => site.result);
  }
  // Offer whole search phrases only. A spelling suggestion never changes the provider query.
  const topics = ['โรงแรมริมแม่น้ำเจ้าพระยา', 'โรงแรมริมเจ้าพระยา', 'ไฟน์ไดนิ่งในกรุงเทพฯ', 'นิทรรศการศิลปะกรุงเทพฯ'];
  const spellingKey = text => text.normalize('NFC').replace(/\s+/gu, '').replace(/[ฯ.!?。]+$/u, '');
  const phrases = [...new Set([...topics, ...entries.flatMap(entry => entry[5].split(' '))])]
    .filter(text => /^[ก-๙]{9,64}$/u.test(text))
    .map(text => ({ text, key:spellingKey(text) }));
  function editDistance(a, b) {
    let row = Array.from({length:b.length + 1}, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < b.length; j++) {
        next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])));
      }
      row = next;
    }
    return row[b.length];
  }
  function suggest(query) {
    const key = spellingKey(query);
    if (!/^[ก-๙]{8,64}$/u.test(key)) return '';
    const matches = [];
    for (const phrase of phrases) {
      const limit = Math.min(6, Math.floor(Math.max(key.length, phrase.key.length) / 4));
      if (Math.abs(key.length - phrase.key.length) > limit) continue;
      // Keep additional qualifiers, even when a known name forms most of the query.
      if (key !== phrase.key && key.includes(phrase.key)) continue;
      // A shared category must not outweigh a different place at the end of a query.
      if (key.slice(-2) !== phrase.key.slice(-2) && editDistance(key.slice(-4), phrase.key.slice(-4)) > 1) continue;
      const distance = editDistance(key, phrase.key);
      if (distance <= limit) matches.push({text:phrase.text, distance});
    }
    matches.sort((a, b) => a.distance - b.distance);
    if (!matches.length || (matches[1] && matches[1].distance <= matches[0].distance + 1)) return '';
    const candidate = matches[0].text;
    return candidate !== query && match(candidate).length ? candidate : '';
  }
  return { match, suggest };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PanthoriumSearchDirectory;
