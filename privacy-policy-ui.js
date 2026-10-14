(function () {
  'use strict';

  const APP_ID = 'privacy-policy';
  // Extend the central registry through PanthoriumPrivacyPolicy.register({id,title,sections}).
  const policies = new Map();
  const initialPolicies = [
  {
    "id": "privacy-notice",
    "title": "นโยบายความเป็นส่วนตัว",
    "subtitle": "Privacy Notice",
    "sections": [
      [
        "ผู้ให้บริการและผู้ควบคุมข้อมูล",
        "Panthorium ดำเนินการโดยปานเทพ มีเหมือน ในฐานะบุคคลธรรมดา ข้อมูลที่อยู่กิจการและช่องทางติดต่อสำหรับคำขอใช้สิทธิแสดงในส่วนข้อมูลผู้ให้บริการด้านล่าง นโยบายนี้ครอบคลุมเว็บไซต์ บัญชีผู้ใช้ และบริการที่เชื่อมกับบัญชี Panthorium"
      ],
      [
        "ข้อมูลที่เก็บ",
        "ข้อมูลบัญชี อีเมลและข้อมูลยืนยันตัวตน ข้อมูลอุปกรณ์และเซสชัน ข้อความและเสียงที่ส่งให้ AI ไฟล์ที่อัปโหลด การตั้งค่าและความจำที่ใช้ให้บริการ ข้อมูลคำสั่งซื้อ แพ็กเกจ สถานะชำระเงิน โควตา และบันทึกความปลอดภัย แม่แบบเสียงเพื่อระบุตัวตนมีรายละเอียดและความยินยอมแยกในหัวข้อ Voice Identity"
      ],
      [
        "วัตถุประสงค์และฐานการประมวลผล",
        "ใช้ข้อมูลที่จำเป็นเพื่อให้บริการตามสัญญา จัดการบัญชี ประมวลผลคำขอ ส่งมอบแพ็กเกจและโควตา ใช้ข้อมูลธุรกรรมเพื่อปฏิบัติหน้าที่ด้านบัญชีและกฎหมาย ใช้ข้อมูลที่เหมาะสมเพื่อป้องกันการฉ้อโกงและดูแลความปลอดภัยโดยพิจารณาสิทธิของผู้ใช้ การใช้ข้อมูลชีวมิติต้องอาศัยความยินยอมโดยชัดแจ้งตามที่เกี่ยวข้อง"
      ],
      [
        "ผู้รับข้อมูลและการส่งต่างประเทศ",
        "Google ให้บริการโครงสร้างพื้นฐานและ Gemini Live API; Omise ประมวลผลการชำระเงิน; ผู้ให้บริการอีเมลที่ระบบใช้ส่งรหัสยืนยันได้รับข้อมูลที่จำเป็นสำหรับส่งอีเมล ผู้ให้บริการเหล่านี้อาจประมวลผลข้อมูลต่างประเทศ เราจะส่งเฉพาะข้อมูลที่จำเป็นและพิจารณามาตรการคุ้มครองตามกฎหมาย ไม่ขายข้อมูลส่วนบุคคล"
      ],
      [
        "สิทธิของคุณ",
        "คุณอาจขอเข้าถึงหรือรับสำเนา แก้ไข ลบ ระงับการใช้ คัดค้าน โอนข้อมูล และถอนความยินยอมได้ตามเงื่อนไขกฎหมาย ติดต่อช่องทางผู้ให้บริการพร้อมข้อมูลระบุตัวตนที่จำเป็น เราจะตรวจสอบคำขอและแจ้งผลหรือเหตุที่ไม่สามารถดำเนินการได้ คุณมีสิทธิร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล"
      ],
      [
        "การให้ข้อมูลและผู้เยาว์",
        "ข้อมูลจำเป็นต่อการสมัครและยืนยันตัวตนต้องให้เพื่อเปิดบัญชี หากไม่ให้ ระบบอาจให้บริการได้เฉพาะส่วนที่ไม่ต้องใช้ข้อมูลนั้น ผู้เยาว์ต้องได้รับความยินยอมหรือดำเนินการผ่านผู้แทนโดยชอบธรรมตามกฎหมายก่อนสมัครหรือให้ข้อมูลชีวมิติ"
      ]
    ]
  },
  {
    "id": "account-security",
    "title": "บัญชีและความปลอดภัย",
    "subtitle": "Account & Security",
    "sections": [
      [
        "การเข้าสู่ระบบ",
        "บัญชีใช้รหัสผ่านที่จัดเก็บเป็นค่า hash ร่วมกับการยืนยันอีเมลตามขั้นตอนสมัครหรือกู้บัญชี เก็บ refresh token เป็น hash ฝั่งเซิร์ฟเวอร์ คุกกี้เซสชันและข้อมูลอุปกรณ์ใช้รักษาการเข้าสู่ระบบและป้องกันการใช้งานที่ไม่ได้รับอนุญาต"
      ],
      [
        "คุกกี้และที่เก็บในอุปกรณ์",
        "คุกกี้ที่จำเป็นใช้สำหรับเซสชัน localStorage/sessionStorage ใช้บันทึกการตั้งค่า อุปกรณ์ และสถานะคำสั่งซื้อบางส่วน ไม่ใช้ข้อความนี้เป็นความยินยอมต่อการติดตามเพื่อโฆษณา หากเพิ่มการติดตามที่ต้องขอความยินยอม จะขอแยกก่อนเริ่ม"
      ],
      [
        "การป้องกัน",
        "ใช้การควบคุมสิทธิ์ฝั่งเซิร์ฟเวอร์ แยกสิทธิ์ผู้ใช้และผู้ดูแล และจำกัดอัตราคำขอ โปรดรักษารหัสผ่านและข้อมูลยืนยันบัญชี หากสงสัยว่าถูกเข้าถึงโดยไม่ได้รับอนุญาตให้ติดต่อผู้ให้บริการทันที"
      ]
    ]
  },
  {
    "id": "ai-processing",
    "title": "AI และการประมวลผล",
    "subtitle": "Gemini Live API",
    "sections": [
      [
        "ข้อมูลที่ส่งให้ AI",
        "ข้อความ เสียง และเนื้อหาที่คุณเลือกส่งจะถูกประมวลผลผ่าน Google Gemini Live API เพื่อสร้างคำตอบและทำงานตามคำสั่ง การใช้ไมโครโฟนขึ้นกับสิทธิ์ที่คุณอนุญาตในอุปกรณ์ อย่าส่งข้อมูลของบุคคลอื่นโดยไม่มีสิทธิ์"
      ],
      [
        "ผลลัพธ์และการตรวจสอบ",
        "AI อาจตอบผิด ไม่ครบ หรือให้ข้อมูลล้าสมัย คุณต้องตรวจผลลัพธ์ก่อนใช้ตัดสินใจหรือเผยแพร่ คำตอบไม่ใช่การรับรองข้อเท็จจริงหรือคำแนะนำวิชาชีพ"
      ],
      [
        "ความจำและการเรียนรู้",
        "ข้อมูลที่บันทึกเพื่อความจำหรือการปรับปรุงบริการต้องใช้ตามวัตถุประสงค์ที่แจ้ง ไม่ตีความว่าการส่งคำถามเป็นความยินยอมให้นำเสียงชีวมิติหรือข้อมูลอ่อนไหวไปฝึกโมเดล การใช้เพิ่มเติมที่ต้องอาศัยความยินยอมจะขอแยกต่างหาก"
      ]
    ]
  },
  {
    "id": "voice-identity",
    "title": "Voice Identity และข้อมูลชีวมิติ",
    "subtitle": "การลงทะเบียนและจดจำเสียง",
    "sections": [
      [
        "วัตถุประสงค์และความยินยอม",
        "Voice Identity อยู่ในขั้นตอนลงทะเบียนและใช้แม่แบบเสียงเพื่อจับคู่ผู้ใช้และควบคุมการเข้าถึงเสียง ต้องอ่านและให้ความยินยอมโดยชัดแจ้งก่อนสร้างหรือปรับปรุงโปรไฟล์ ความยินยอมนี้ไม่ครอบคลุมการโฆษณาหรือการฝึกโมเดลทั่วไป"
      ],
      [
        "การจัดเก็บและข้อจำกัด",
        "ระบบจัดเก็บแม่แบบเสียงที่ใช้จับคู่ภายใต้การควบคุมสิทธิ์ ผลการจับคู่เสียงอาจคลาดเคลื่อนและไม่ใช้แทนรหัสผ่านหรือสิทธิ์บัญชีทุกกรณี ไม่มีการรับประกันว่าการรู้จำเสียงถูกต้องทั้งหมด"
      ],
      [
        "ถอนความยินยอมและลบ",
        "คุณสามารถลบโปรไฟล์เสียงผ่านตัวเลือกที่มีหรือติดต่อผู้ให้บริการเพื่อถอนความยินยอมและขอลบ การถอนอาจทำให้ฟังก์ชันที่ต้องใช้การจดจำเสียงทำงานไม่ได้ และไม่กระทบการประมวลผลที่ชอบด้วยกฎหมายก่อนถอน"
      ]
    ]
  },
  {
    "id": "cloud-files",
    "title": "ไฟล์และพื้นที่จัดเก็บ",
    "subtitle": "Cloud Files",
    "sections": [
      [
        "พื้นที่และโควตา",
        "ไฟล์จัดเก็บในโครงสร้างพื้นฐาน Google Cloud โดยแยกเจ้าของและตรวจสิทธิ์ในการเข้าถึง ขนาดต่อไฟล์และพื้นที่รวมเป็นไปตามหน้าฟังก์ชันและแพ็กเกจ พื้นที่เพิ่มและสิทธิ์ดาวน์โหลดมีระยะใช้งานตามรายการซื้อ"
      ],
      [
        "สิทธิ์ในเนื้อหา",
        "คุณยังคงมีสิทธิ์ในเนื้อหาของคุณและอนุญาตให้ Panthorium ประมวลผล จัดเก็บ และส่งข้อมูลเท่าที่จำเป็นต่อบริการ ต้องมีสิทธิ์ใช้ไฟล์ก่อนอัปโหลด และรับผิดชอบการเผยแพร่หรือแบ่งปันของคุณ"
      ],
      [
        "การลบและสำรอง",
        "ลบไฟล์ได้ใน Files การออกจากระบบหรือปิดหน้าต่างไม่ใช่การลบข้อมูล สำเนาที่ดาวน์โหลดหรือส่งไปภายนอกไม่ถูกลบตามไปด้วย โปรดสำรองข้อมูลสำคัญก่อนสิทธิ์พื้นที่หมดอายุหรือขอปิดบัญชี"
      ]
    ]
  },
  {
    "id": "retention-choices",
    "title": "การเก็บข้อมูลและคำขอใช้สิทธิ",
    "subtitle": "Retention & Requests",
    "sections": [
      [
        "ระยะเก็บตามวัตถุประสงค์",
        "เก็บข้อมูลบัญชี ไฟล์ ความจำ และแม่แบบเสียงระหว่างที่จำเป็นต่อการให้บริการหรือจนได้รับคำขอลบที่ดำเนินการได้ เก็บข้อมูลธุรกรรมและหลักฐานบัญชีตามระยะที่กฎหมายกำหนด และอาจเก็บต่อเท่าที่จำเป็นต่อข้อพิพาท บันทึกความปลอดภัยเก็บเท่าที่จำเป็นต่อการตรวจเหตุและป้องกันความเสียหาย"
      ],
      [
        "การปิดบัญชีและข้อยกเว้น",
        "ติดต่อผู้ให้บริการเพื่อขอปิดบัญชี ลบหรือรับสำเนาข้อมูล เราจะยืนยันตัวตนและแจ้งขอบเขตที่ลบได้ ข้อมูลที่ต้องเก็บตามกฎหมายหรือข้อพิพาทจะจำกัดการใช้ต่อเฉพาะเหตุนั้น ไม่อ้างว่าลบทุกสำเนาอัตโนมัติทันที"
      ],
      [
        "เหตุละเมิดข้อมูล",
        "เมื่อพบเหตุที่กระทบข้อมูลส่วนบุคคล เราจะตรวจสอบ จำกัดผลกระทบ และแจ้งหน่วยงานหรือผู้ได้รับผลกระทบตามเงื่อนไขและระยะเวลาที่กฎหมายกำหนด"
      ]
    ]
  },
  {
    "id": "terms-of-use",
    "title": "เงื่อนไขบริการและการชำระเงิน",
    "subtitle": "Terms of Service",
    "sections": [
      [
        "ข้อตกลงและการใช้บริการ",
        "การใช้บริการอยู่ภายใต้เงื่อนไขนี้และรายละเอียดแพ็กเกจที่แสดงก่อนซื้อ ใช้บัญชีและบริการโดยชอบด้วยกฎหมาย ห้ามเข้าถึงบัญชีผู้อื่น ข้ามการควบคุมสิทธิ์ รบกวนระบบ หรือละเมิดสิทธิในเนื้อหา"
      ],
      [
        "ราคาและภาษี",
        "ราคาที่แสดงเป็นเงินบาทและเป็นยอดที่ต้องชำระตามหน้าสรุปรายการ ผู้ให้บริการเป็นบุคคลธรรมดาที่ยังไม่จดทะเบียนภาษีมูลค่าเพิ่ม จึงไม่ออกใบกำกับภาษี VAT ข้อมูลราคาและสถานะภาษีที่เปลี่ยนจะประกาศสำหรับรายการซื้อในอนาคต"
      ],
      [
        "การรับชำระและส่งมอบ",
        "การซื้อบนเว็บไซต์ใช้ Omise และช่องทางที่แสดงในหน้าชำระ Panthorium เปิดสิทธิ์หลังยืนยันการชำระจากผู้ให้บริการเท่านั้น QR ที่หมดอายุหรือรายการค้างไม่ถือว่าชำระแล้ว เก็บเลขคำสั่งซื้อและหลักฐานไว้ติดต่อกรณีผิดพลาด"
      ],
      [
        "ระยะใช้และการต่ออายุ",
        "แพ็กเกจสมาชิกมีระยะ 1 เดือนนับจากวันที่ชำระสำเร็จและไม่มีการตัดเงินต่ออายุอัตโนมัติ รายการเพิ่มมีระยะ 30 วันตามรายละเอียดก่อนซื้อ โควตาที่หมดอายุไม่สะสมต่อ ระบบอาจกำหนดให้บางรายการเพิ่มต้องมีสมาชิกที่ยังใช้งานอยู่"
      ],
      [
        "ยกเลิกและคืนเงิน",
        "ติดต่อผู้ให้บริการพร้อมเลขคำสั่งซื้อและเหตุผลหากชำระซ้ำ ไม่ได้รับสิทธิ์ หรือบริการมีข้อผิดพลาด เราจะตรวจสอบหลักฐานและสิทธิ์ตามกฎหมายก่อนแจ้งผลและช่องทางคืนเงิน ระยะรับเงินคืนขึ้นกับช่องทางและผู้ให้บริการชำระเงิน การคืนเงินอาจทำให้สิทธิ์ที่เกี่ยวข้องถูกเพิกถอน ไม่จำกัดสิทธิของผู้บริโภคที่กฎหมายคุ้มครอง"
      ],
      [
        "การระงับและความรับผิด",
        "อาจจำกัดบัญชีเมื่อพบการใช้งานผิดกฎหมาย การฉ้อโกง หรือความเสี่ยงต่อระบบ โดยแจ้งเหตุเท่าที่ทำได้ ไม่มีข้อกำหนดนี้ตัดสิทธิเรียกร้องหรือความรับผิดที่กฎหมายไม่อนุญาตให้ยกเว้น ติดต่อผู้ให้บริการเพื่อสอบถามหรือโต้แย้ง"
      ],
      [
        "แอปและการเปลี่ยนแปลง",
        "การซื้อภายในแอปใช้ช่องทางและข้อกำหนดที่แอปแสดงเมื่อเปิดให้บริการ ไม่ถือว่าช่องทางซื้อบนเว็บเปิดใช้ในทุกแอปโดยอัตโนมัติ การเปลี่ยนเงื่อนไขสำคัญจะประกาศพร้อมวันที่มีผล ไม่ลดสิทธิ์ของรายการที่ซื้อแล้วโดยย้อนหลัง"
      ]
    ]
  },
  {
    "id": "policy-archive",
    "title": "ฉบับและการเปลี่ยนแปลง",
    "subtitle": "Policy Version",
    "sections": [
      [
        "ฉบับปัจจุบัน",
        "ฉบับ 2.0 วันที่ 14 ตุลาคม 2026 ใช้เมื่อประกาศให้ผู้ใช้เข้าถึง ครอบคลุมบัญชี Gemini Live API ข้อมูลชีวมิติ Cloud Files การชำระผ่าน Omise และสิทธิของผู้ใช้"
      ],
      [
        "การเปลี่ยนแปลง",
        "เมื่อเปลี่ยนวัตถุประสงค์สำคัญหรือเงื่อนไขที่กระทบผู้ใช้ จะประกาศและขอความยินยอมเพิ่มเติมเมื่อกฎหมายกำหนด ประวัติการแก้ไขเก็บในระบบควบคุมเวอร์ชันของบริการ"
      ]
    ]
  }
];

  function cleanPolicy(value) {
    if (!value || typeof value !== 'object' || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(String(value.id || '')) || !String(value.title || '').trim()) return null;
    const sections = Array.isArray(value.sections) ? value.sections.map(section => {
      if (Array.isArray(section)) return [String(section[0] || ''), String(section[1] || '')];
      return [String(section?.title || ''), String(section?.body || '')];
    }).filter(section => section[0] && section[1]) : [];
    if (!sections.length) return null;
    return { id: String(value.id), title: String(value.title).trim(), subtitle: String(value.subtitle || '').trim(), sections };
  }
  initialPolicies.forEach(policy => policies.set(policy.id, cleanPolicy(policy)));

  function list() { return Array.from(policies.values(), policy => JSON.parse(JSON.stringify(policy))); }
  function register(policy) {
    const clean = cleanPolicy(policy);
    if (!clean) return false;
    policies.set(clean.id, clean);
    window.dispatchEvent(new CustomEvent('panthorium:policy-registry-changed'));
    return true;
  }
  function appendText(parent, tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }
  function renderArticle(root, id) {
    const policy = policies.get(id) || policies.values().next().value;
    if (!policy) return;
    root.dataset.selectedPolicy = policy.id;
    const nav = root.querySelector('[data-policy-nav]');
    const content = root.querySelector('[data-policy-content]');
    if (!nav || !content) return;
    nav.replaceChildren();
    content.replaceChildren();
    policies.forEach(entry => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.policyId = entry.id;
      button.className = entry.id === policy.id ? 'pp-nav-item active' : 'pp-nav-item';
      appendText(button, 'strong', entry.title);
      if (entry.subtitle) appendText(button, 'small', entry.subtitle);
      button.addEventListener('click', () => renderArticle(root, entry.id));
      nav.appendChild(button);
    });
    appendText(content, 'h2', policy.title, 'pp-title');
    if (policy.subtitle) appendText(content, 'p', policy.subtitle, 'pp-subtitle');
    policy.sections.forEach(([title, body]) => {
      const section = document.createElement('section');
      section.className = 'pp-section';
      appendText(section, 'h3', title);
      appendText(section, 'p', body);
      content.appendChild(section);
    });
  }
  function createWindow() {
    const root = document.createElement('section');
    root.id = 'panthorium-privacy-policy';
    root.tabIndex = -1;
    root.style.cssText = 'position:fixed;inset:0;z-index:10030;background:#10161d;color:#e7edf4;border:1px solid #33404a;border-radius:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;font:14px/1.55 system-ui,sans-serif';
    root.innerHTML = `
      <style>
        #panthorium-privacy-policy *{box-sizing:border-box}#panthorium-privacy-policy button{font:inherit;color:inherit;touch-action:manipulation}
        #panthorium-privacy-policy header{min-height:66px;padding:env(safe-area-inset-top,0px) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));display:flex;align-items:center;gap:12px;background:#1c242b;border-bottom:1px solid #34404a}
        #panthorium-privacy-policy .pp-brand{min-width:0;flex:1}#panthorium-privacy-policy .pp-brand h1{margin:0;font-size:18px;line-height:1.2}#panthorium-privacy-policy .pp-brand p{margin:4px 0 0;color:#9eacb7;font-size:12px}
        #panthorium-privacy-policy [data-close],#panthorium-privacy-policy [data-minimize]{min-width:40px;min-height:40px;border:1px solid #46535e;border-radius:8px;background:#252e36;cursor:pointer}
        #panthorium-privacy-policy .pp-review{padding:10px 16px;background:#372d18;color:#ffe3a1;border-bottom:1px solid #6f5c2b;font-size:12px}
        #panthorium-privacy-policy .pp-workspace{display:grid;grid-template-columns:minmax(210px,290px) minmax(0,1fr);flex:1;min-height:0}
        #panthorium-privacy-policy [data-policy-nav]{overflow:auto;padding:12px;background:#151c23;border-right:1px solid #303b45;overscroll-behavior:contain}
        #panthorium-privacy-policy .pp-nav-item{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin:0 0 6px;padding:11px;border:1px solid transparent;border-radius:8px;background:transparent;text-align:left;cursor:pointer}
        #panthorium-privacy-policy .pp-nav-item:hover,#panthorium-privacy-policy .pp-nav-item.active{background:#202c34;border-color:#2f746e;color:#8fe6d8}#panthorium-privacy-policy .pp-nav-item small{color:#9caab5;font-size:11px}
        #panthorium-privacy-policy [data-policy-content]{min-width:0;overflow:auto;padding:clamp(18px,4vw,42px);overscroll-behavior:contain}
        #panthorium-privacy-policy .pp-title{margin:0;font-size:clamp(22px,3vw,32px);line-height:1.2}#panthorium-privacy-policy .pp-subtitle{margin:8px 0 26px;color:#9eb0bc}
        #panthorium-privacy-policy .pp-section{max-width:920px;margin:0 0 18px;padding:18px;border:1px solid #2d3943;border-radius:10px;background:#171f26}
        #panthorium-privacy-policy .pp-section h3{margin:0 0 8px;color:#8fe6d8;font-size:15px}#panthorium-privacy-policy .pp-section p{margin:0;color:#c4cdd4;white-space:pre-wrap;line-height:1.7}
        #panthorium-privacy-policy.panthorium-window-fullscreen{padding:0!important}html[data-panthorium-immersive="true"] #panthorium-privacy-policy header{padding-top:8px}
        @media(max-width:700px){#panthorium-privacy-policy .pp-workspace{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(130px,28dvh) minmax(0,1fr)}#panthorium-privacy-policy [data-policy-nav]{border-right:0;border-bottom:1px solid #303b45;display:flex;gap:7px;overflow:auto;padding:8px}#panthorium-privacy-policy .pp-nav-item{width:190px;min-width:190px;align-self:stretch;margin:0;padding:8px}#panthorium-privacy-policy [data-policy-content]{padding:16px}#panthorium-privacy-policy .pp-section{padding:13px}}
        @media(max-width:700px) and (orientation:landscape){#panthorium-privacy-policy .pp-workspace{grid-template-columns:minmax(175px,32vw) minmax(0,1fr);grid-template-rows:minmax(0,1fr)}#panthorium-privacy-policy [data-policy-nav]{display:block;border-right:1px solid #303b45;border-bottom:0}#panthorium-privacy-policy .pp-nav-item{width:100%;min-width:0;min-height:54px;margin-bottom:5px}}
        @media(min-width:701px) and (orientation:portrait){#panthorium-privacy-policy .pp-workspace{grid-template-columns:minmax(190px,30vw) minmax(0,1fr)}}
      </style>
      <header><div class="pp-brand"><h1>🔐 Privacy/Policy</h1><p>ศูนย์รวมนโยบายและข้อกำหนดของ Panthorium</p></div><div class="pp-window-tools"><button type="button" data-close aria-label="ปิด Privacy/Policy" title="ปิด">✕</button></div></header>
      <div class="pp-review"><strong>ฉบับ 2.0 · 14 ตุลาคม 2026</strong><div data-operator>ผู้ให้บริการ: ปานเทพ มีเหมือน · Panthorium</div></div>
      <div class="pp-workspace"><nav data-policy-nav aria-label="หัวข้อ Privacy/Policy"></nav><main data-policy-content tabindex="0"></main></div>`;
    const backend = typeof OS !== 'undefined' ? OS.config?.backendUrl || '' : '';
    if (typeof fetch === 'function') fetch(backend.replace(/\/$/,'')+'/api/policies/operator').then(r=>r.ok?r.json():null).then(p=>{
      if(p?.ok) root.querySelector('[data-operator]').textContent = 'ผู้ให้บริการ: '+p.name+' · '+(p.address||'ข้อมูลที่อยู่ติดต่อยังไม่ได้ประกาศ')+' · '+(p.email||'ช่องทางติดต่อยังไม่ได้ประกาศ');
    }).catch(()=>{});
    root.querySelector('[data-close]').addEventListener('click', () => {
      if (window.PanthoriumWindowManager?.close?.(APP_ID)) return;
      root.remove();
    });
    renderArticle(root, root.dataset.selectedPolicy || policies.keys().next().value);
    document.body.appendChild(root);
    window.PanthoriumWindowManager?.registerExternal?.(APP_ID, 'Privacy/Policy', root, { menuAppId: APP_ID });
    return root;
  }
  function open() {
    const existing = window.PanthoriumWindowManager?.findByAppId?.(APP_ID)?.el || document.getElementById('panthorium-privacy-policy');
    if (existing) {
      if (window.PanthoriumWindowManager?.restore) window.PanthoriumWindowManager.restore(APP_ID);
      else existing.style.display = 'flex';
      renderArticle(existing, existing.dataset.selectedPolicy);
      existing.focus?.();
      return existing;
    }
    return createWindow();
  }

  window.PanthoriumPrivacyPolicy = Object.freeze({ open, list, register });
  window.PanthoriumStartMenuUI?.pinLast?.(APP_ID);
  window.addEventListener('panthorium:policy-registry-changed', () => {
    const root = document.getElementById('panthorium-privacy-policy');
    if (root) renderArticle(root, root.dataset.selectedPolicy);
  });
})();
