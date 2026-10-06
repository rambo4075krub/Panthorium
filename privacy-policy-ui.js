(function () {
  'use strict';

  const APP_ID = 'privacy-policy';
  const policies = new Map();
  const initialPolicies = [
    {
      id: 'privacy-notice', title: 'Privacy Notice', subtitle: 'การเก็บ ใช้ และดูแลข้อมูลส่วนบุคคล',
      sections: [
        ['สถานะและผู้ให้บริการ', 'หน้านี้เป็นประกาศความเป็นส่วนตัวฉบับ staging ของ Panthorium รวบรวมข้อมูลการทำงานที่ตรวจพบจากโค้ดและเอกสารใน repository ณ วันที่ 6 ตุลาคม 2026 เอกสารเดิมที่พบมีเพียงบันทึกว่าการจัดทำนโยบายสำหรับส่งสโตร์ยังค้างอยู่ ไม่พบประกาศฉบับเต็มก่อนหน้า จึงไม่มีข้อความฉบับเก่าที่จะย้ายมาโดยอ้างว่าเป็นฉบับเดิม ชื่อผู้ควบคุมข้อมูล ที่อยู่ และช่องทางติดต่อยังไม่ได้ระบุ ต้องให้ผู้ดำเนินบริการเติมและยืนยันก่อนเผยแพร่เป็นนโยบายทางการ'],
        ['ข้อมูลที่ระบบใช้', 'ขึ้นกับฟังก์ชันที่คุณเลือกใช้ อาจมีข้อมูลบัญชีและอีเมล, รายละเอียดไฟล์และสื่อที่คุณอัปโหลดหรือสร้าง, ข้อความและไฟล์ที่ส่งให้ Sentinel, ข้อมูลการตั้งค่า, โทเคนสำหรับรักษาเซสชัน และข้อมูลแม่แบบเสียงเมื่อสมัคร Voice Identity ระบบมีข้อมูลที่จำเป็นต่อการทำงานและความปลอดภัยของบริการด้วย แต่ระยะเก็บและรายการบันทึกปฏิบัติการทั้งหมดต้องได้รับการยืนยันจากผู้ดำเนินบริการก่อนประกาศฉบับ production'],
        ['เหตุผลในการใช้ข้อมูล', 'ระบบใช้ข้อมูลเพื่อเข้าสู่ระบบและกำหนดสิทธิ์, ให้บริการ Sentinel และเครื่องมือที่ผู้ใช้เรียก, เก็บและส่งคืนไฟล์ใน Cloud Files, ประมวลผลคำขอ AI, รองรับการจดจำเสียงเมื่อผู้ใช้เลือกลงทะเบียน และดูแลความปลอดภัย/การทำงานของระบบ'],
        ['สิทธิ์และการควบคุม', 'ใช้เฉพาะฟังก์ชันที่ต้องการ หลีกเลี่ยงการส่งข้อมูลลับที่ไม่จำเป็นให้ AI หรืออัปโหลดข้อมูลของบุคคลอื่นโดยไม่มีสิทธิ์ หากกฎหมายที่ใช้บังคับให้สิทธิในการเข้าถึง แก้ไข ลบ คัดค้าน หรือถอนความยินยอม ผู้ดำเนินบริการต้องจัดช่องทางคำขอและแจ้งวิธีใช้สิทธิเพิ่มเติม ช่องทางติดต่อดังกล่าวยังรอการกำหนด'],
        ['ข้อมูลเด็กและผู้เยาว์', 'ยังไม่พบข้อกำหนดอายุขั้นต่ำหรือขั้นตอนยินยอมโดยผู้ปกครองที่ตรวจสอบได้ใน repository ผู้ดำเนินบริการต้องกำหนดเงื่อนไขนี้ก่อนเปิดใช้งานหรือเผยแพร่ในวงกว้าง']
      ]
    },
    {
      id: 'account-security', title: 'Accounts & Sessions', subtitle: 'บัญชี การยืนยันตัวตน และการเก็บในอุปกรณ์',
      sections: [
        ['บัญชีและรหัสผ่าน', 'เอกสารระบบระบุว่ารหัสผ่านไม่เก็บเป็นข้อความดิบ แต่ตรวจด้วย bcrypt และเก็บค่า hash ใน data store ส่วน refresh token จะเก็บเฉพาะค่า SHA-256 hash ฝั่ง server; AI API keys และ JWT secret อยู่ใน environment ของ server และไม่ควรอยู่ในหน้าเว็บหรือ localStorage'],
        ['โทเคนและคุกกี้', 'access token อยู่ในหน่วยความจำ JavaScript ของหน้าเว็บ ส่วน refresh token ใช้คุกกี้ HttpOnly และ SameSite; เมื่อ logout ระบบเพิกถอน refresh token การจำเซสชันระยะยาวอาจใช้คุกกี้ตามตัวเลือกที่ระบบแสดง'],
        ['ที่เก็บในเบราว์เซอร์', 'การตั้งค่าหน้าต่างที่ใช้ร่วมกันเก็บใน localStorage; ข้อมูล guest session แบบชั่วคราวเก็บใน sessionStorage; ระหว่างสมัคร Voice Identity อาจมี device credential แบบสุ่มใน localStorage เมื่อผู้ใช้ยินยอม และระบบออกแบบให้เก็บ hash ไว้ใน data store แทน credential ดิบ การทำงานจริงอาจต่างกันตามรุ่นเบราว์เซอร์และตัวเลือกที่ผู้ใช้ให้ไว้'],
        ['สิทธิ์เข้าถึง', 'ระบบตรวจสิทธิ์และบทบาทที่ฝั่ง server สำหรับ API; การซ่อนแอปในหน้าเว็บไม่ใช่การควบคุมสิทธิ์เพียงชั้นเดียว อย่าเปิดเผยรหัสผ่าน โทเคน หรือ secret ให้ผู้อื่น']
      ]
    },
    {
      id: 'ai-processing', title: 'Sentinel AI & Providers', subtitle: 'การส่งคำขอ AI และผู้ให้บริการประมวลผล',
      sections: [
        ['เนื้อหาที่ส่ง', 'ข้อความ ไฟล์ หรือข้อมูลที่แนบกับคำขออาจถูกส่งไปประมวลผลกับ provider ที่ผู้ดำเนินบริการตั้งค่าไว้ เอกสารทางเทคนิคปัจจุบันระบุการรองรับ Vertex AI, Groq, OpenAI และ Gemini การเลือก provider อาจเปลี่ยนตามการตั้งค่าและความพร้อมของระบบ'],
        ['การใช้โดย provider', 'provider ที่รับคำขอจะประมวลผลตามเงื่อนไขและนโยบายของตนเอง Panthorium ไม่รับรองว่าทุก provider ใช้ข้อมูลเหมือนกัน หรือไม่ใช้ข้อมูลเพื่อฝึก/ปรับปรุงบริการ โปรดตรวจ provider และเงื่อนไขที่เกี่ยวข้องก่อนส่งข้อมูลลับหรือข้อมูลอ่อนไหว'],
        ['การลดข้อมูล', 'ส่งเฉพาะเนื้อหาที่จำเป็นกับคำสั่ง ลบข้อมูลระบุตัวบุคคลที่ไม่จำเป็น และตรวจผลลัพธ์ก่อนนำไปใช้ โดยเฉพาะการสร้างเนื้อหาหรือการกระทำที่มีผลต่อบัญชี ไฟล์ หรือค่าใช้จ่าย'],
        ['การบันทึกคำขอ', 'อายุการเก็บคำขอและ log ของบริการ AI ยังไม่มีระยะเวลาที่ระบุอย่างครบถ้วนในเอกสารที่ตรวจพบ ผู้ดำเนินบริการต้องยืนยัน retention ของแต่ละ provider และระบบ backend ก่อนอนุมัติประกาศฉบับ production']
      ]
    },
    {
      id: 'voice-identity', title: 'Voice Identity & Biometrics', subtitle: 'แม่แบบเสียง ความยินยอม และการลบ',
      sections: [
        ['สมัครและยินยอม', 'Voice Identity ต้องได้รับความยินยอมก่อนบันทึกตัวอย่าง และใช้ตัวอย่างเสียง 3–5 ช่วงเพื่อสร้างแม่แบบเสียง การลงทะเบียนบัญชียังใช้การยืนยันอีเมลตาม flow ที่ระบบกำหนด ห้ามลงทะเบียนเสียงของผู้อื่นโดยไม่มีความยินยอมและอำนาจที่เหมาะสม'],
        ['เสียงดิบและแม่แบบ', 'เอกสารของ speaker service ระบุว่าเสียงดิบถูกถอดรหัสในหน่วยความจำและไม่ถูกบันทึกถาวรโดย service นั้น Backend เข้ารหัสแม่แบบเสียงด้วย AES-256-GCM ผ่าน BIOMETRIC_TEMPLATE_KEY และเก็บแม่แบบแยกตามเจ้าของใน Cloud SQL; ข้อมูลแม่แบบมีรายละเอียดที่จำเป็นต่อการจัดการโปรไฟล์และความยินยอม'],
        ['อายุและการลบ', 'โปรไฟล์เสียงที่ลงทะเบียนแล้วไม่มีการหมดอายุอัตโนมัติตามเอกสารปัจจุบัน ผู้ใช้เจ้าของบัญชีสามารถลบโปรไฟล์จาก Voice Identity การลบโปรไฟล์เสียงไม่จำเป็นต้องลบบัญชีหรือข้อมูลชนิดอื่นโดยอัตโนมัติ'],
        ['ข้อจำกัดความปลอดภัย', 'ระบบตรวจความคล้ายคลึงของเสียงไม่ใช่การตรวจ liveness เอกสารระบุว่ายังไม่มีการป้องกัน replay/deepfake แบบ liveness จึงไม่ควรถือว่า voice match เพียงอย่างเดียวเป็นการยืนยันตัวตนสำหรับการกระทำอ่อนไหว การเข้าสู่ระบบ สิทธิ์ RBAC และการยืนยันเพิ่มเติมยังเป็นกลไกแยกกัน'],
        ['guest', 'guest profile ที่ไม่มีเสียงซึ่งระบบรู้จักอาจได้ identity ชั่วคราวใหม่หลัง 24 ชั่วโมงตามเอกสาร staging; กติกา guest ไม่ได้เปลี่ยน retention ของโปรไฟล์เสียงที่ลงทะเบียนแล้ว']
      ]
    },
    {
      id: 'cloud-files', title: 'Cloud Files & Media', subtitle: 'ไฟล์ที่อัปโหลด วิดีโอ และผลลัพธ์',
      sections: [
        ['พื้นที่ Cloud Files', 'ไฟล์ของบัญชีเก็บใน Cloud Storage ของ Panthorium ตาม bucket และ project ที่ deployment กำหนด โดย object path แยกตาม UUID เจ้าของ และ API ตรวจสิทธิ์เจ้าของไฟล์ เอกสารรุ่นทดสอบกำหนดขนาดไม่เกิน 20 MiB ต่อไฟล์ และรวม 100 MiB ต่อบัญชี ขีดจำกัดอาจเปลี่ยนตามแผนหรือรุ่นระบบ'],
        ['Media Studio', 'Media Studio อ่านสื่อจาก Cloud Files และบันทึกไฟล์ผลลัพธ์กลับเข้า Cloud Files ตาม flow ของฟีเจอร์ งานสร้างวิดีโออาจเรียก provider ภายนอก มี quota หรือค่าใช้จ่าย และหน้าแอปแจ้งให้ยืนยันก่อนเริ่มเมื่อฟีเจอร์นั้นเปิดใช้'],
        ['การควบคุมไฟล์', 'ตรวจชื่อและเนื้อหาไฟล์ก่อนอัปโหลด หลีกเลี่ยงข้อมูลที่ไม่มีสิทธิ์เผยแพร่ ดาวน์โหลดสำเนาหากต้องการเก็บเอง และลบไฟล์ที่ไม่ใช้ผ่านเครื่องมือจัดการไฟล์ การลบจาก Cloud Files ไม่จำเป็นต้องลบสำเนาที่คุณดาวน์โหลดหรือสำเนาที่ส่งต่อออกไป'],
        ['ปลายทางจัดเก็บ', 'ให้ใช้พื้นที่ Cloud Files ที่เชื่อมกับ project ของ Panthorium สำหรับไฟล์ที่แอปสร้างหรืออัปโหลด แอปไม่ควรใช้พื้นที่จัดเก็บเครื่องเป็นปลายทางถาวร อย่างไรก็ตาม cache ชั่วคราวของเบราว์เซอร์หรือระบบปฏิบัติการอาจอยู่นอกการควบคุมของเว็บแอป']
      ]
    },
    {
      id: 'retention-choices', title: 'Retention & Your Choices', subtitle: 'ระยะเก็บข้อมูล การจัดการ และคำขอผู้ใช้',
      sections: [
        ['ระยะเวลา', 'มีเฉพาะบางรายการที่มีระยะเวลาชัดเจนในเอกสาร เช่น guest identity ชั่วคราว 24 ชั่วโมง และรหัส OTP สำหรับกู้รหัสผ่าน 10 นาที โปรไฟล์เสียงไม่หมดอายุอัตโนมัติ ส่วนระยะเก็บไฟล์บัญชี ประวัติ AI, audit log และข้อมูลปฏิบัติการโดยรวมยังไม่ได้ระบุครบถ้วน ห้ามตีความว่าระบบลบข้อมูลทั้งหมดอัตโนมัติเมื่อปิดหน้าต่างหรือออกจากระบบ'],
        ['ปิดหน้าต่างและออกจากระบบ', 'การย่อหน้าต่างเก็บ state ไว้จนกว่าจะกดปิดหน้าต่าง ส่วน logout ใช้เพิกถอน refresh token; ทั้งสองอย่างไม่ใช่คำสั่งลบไฟล์ Cloud Files หรือข้อมูลบัญชี'],
        ['จัดการ/ลบ', 'ใช้ Files เพื่อลบไฟล์และ Voice Identity เพื่อลบโปรไฟล์เสียงตามตัวเลือกที่มี การลบข้อมูลประเภทอื่นและการขอสำเนาข้อมูลต้องดำเนินผ่านช่องทางช่วยเหลือที่ผู้ให้บริการประกาศ ช่องทางนั้นยังต้องกำหนดก่อนเปิด production'],
        ['ก่อนส่งขึ้น production', 'ผู้ดำเนินบริการต้องกำหนดและตรวจสอบชื่อผู้ควบคุมข้อมูล/นิติบุคคล, ที่อยู่และช่องทางติดต่อ, ระยะเก็บของแต่ละประเภท, รายชื่อผู้ประมวลผล/ผู้ให้บริการ, วิธีรับคำขอใช้สิทธิ, ขั้นตอนเหตุข้อมูลรั่วไหล และการตรวจทานตามกฎหมายที่ใช้บังคับ']
      ]
    },
    {
      id: 'terms-of-use', title: 'Terms of Use', subtitle: 'ข้อกำหนดการใช้บริการฉบับ staging',
      sections: [
        ['การใช้บริการ', 'ใช้ Panthorium ตามสิทธิ์ของบัญชีและกฎหมายที่เกี่ยวข้อง ห้ามพยายามข้ามการควบคุมสิทธิ์ รบกวนบริการ เข้าถึงบัญชีหรือไฟล์ของผู้อื่น หรือใช้เครื่องมือสร้างเนื้อหาเพื่อทำสิ่งที่ไม่มีสิทธิ์'],
        ['เนื้อหาและสิทธิ', 'คุณต้องมีสิทธิ์ใช้ข้อความ ภาพ เสียง วิดีโอ และไฟล์ที่ส่งเข้า และรับผิดชอบตรวจผลลัพธ์ก่อนเผยแพร่ Sentinel อาจสร้างคำตอบผิดหรือไม่ครบ การตอบของ AI ไม่ใช่คำแนะนำวิชาชีพหรือการรับรองข้อเท็จจริง'],
        ['ค่าใช้จ่ายและฟีเจอร์ภายนอก', 'บางฟีเจอร์อาจมี quota หรือค่าใช้จ่ายจาก provider ให้ตรวจข้อมูลยืนยันบนหน้าฟีเจอร์ก่อนเริ่ม การเชื่อมต่อ provider ภายนอกอยู่ภายใต้เงื่อนไขของ provider ด้วย'],
        ['สถานะเอกสาร', 'ไม่พบ Terms of Use ฉบับเดิมใน repository นี้ ข้อความนี้เป็นฉบับ staging สำหรับตรวจทาน ไม่ใช่สัญญาที่ผ่านการตรวจจากผู้ดำเนินบริการหรือที่ปรึกษากฎหมาย เงื่อนไขฉบับทางการต้องระบุผู้ให้บริการและกลไกติดต่อให้ครบก่อนเผยแพร่']
      ]
    },
    {
      id: 'policy-archive', title: 'Policy Archive & Changes', subtitle: 'ศูนย์รวมฉบับเก่าและรายการปรับปรุง',
      sections: [
        ['รายการเดิมที่ตรวจพบ', 'การตรวจ repository ครั้งนี้ไม่พบ Privacy Policy หรือ Terms of Use ฉบับเต็มที่เคยเผยแพร่ พบเพียงเอกสาร mobile store ที่ระบุว่าการจัดทำนโยบาย privacy สำหรับส่งสโตร์ยังเป็นงานค้าง บันทึกนั้นไม่ใช่ตัวนโยบายและไม่มีเนื้อหาที่จะย้ายซ้ำ'],
        ['ฉบับปัจจุบัน', 'ฉบับ staging 1.0 · 6 ตุลาคม 2026 · รวบรวมข้อมูลจากเอกสารระบบ Authentication, Voice Identity, Cloud Files และ Media Studio พร้อมระบุหัวข้อที่ผู้ดำเนินบริการต้องยืนยันก่อนเผยแพร่จริง'],
        ['การเก็บฉบับในอนาคต', 'ทุกหัวข้อ Privacy/Policy ของแอปนี้มาจาก registry กลางเดียวใน privacy-policy-ui.js และแสดงในหน้าต่างนี้ ผู้พัฒนาสามารถเพิ่มฉบับหรือหัวข้อผ่าน PanthoriumPrivacyPolicy.register({id, title, subtitle, sections}) โดยไม่สร้างรายการ Privacy/Policy ซ้ำใน Start Menu']
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
      <div class="pp-review"><strong>ฉบับ staging สำหรับตรวจทาน</strong> · ข้อมูลผู้ควบคุมข้อมูล ช่องทางติดต่อ และระยะเก็บข้อมูลบางประเภทต้องได้รับการยืนยันก่อนใช้เป็นประกาศ production</div>
      <div class="pp-workspace"><nav data-policy-nav aria-label="หัวข้อ Privacy/Policy"></nav><main data-policy-content tabindex="0"></main></div>`;
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
