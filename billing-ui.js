(function () {
  'use strict';
  const ID = 'billing';
  const catalog = window.PanthoriumBillingCatalog;
  if (!catalog) return;
  const tabs = [['membership', 'สมาชิก'], ['voice', 'เสียงเพิ่ม'], ['text', 'ข้อความเพิ่ม'], ['storage', 'พื้นที่ / ดาวน์โหลด']];
  const os = () => typeof OS !== 'undefined' ? OS : null;
  const price = value => value.toLocaleString('th-TH') + ' บาท';
  const nativeAndroid = () => window.Capacitor?.isNativePlatform?.() === true || /\bPanthoriumAndroid\b/i.test(navigator.userAgent);

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, action, className) {
    const result = node('button', text, className);
    result.type = 'button';
    result.addEventListener('click', action);
    return result;
  }
  function open() {
    if (!os() || typeof createWindow !== 'function') return false;
    if (os().windows.has(ID)) { window.PanthoriumWindowManager?.restore?.(ID); return true; }
    createWindow(ID, '💳 แพ็กเกจและชำระเงิน', markup(), { width: 1040, height: 720 });
    const root = document.querySelector('.window[data-id="billing"] [data-billing-root]');
    if (!root) return false;
    let category = 'membership';
    const nav = root.querySelector('[data-tabs]');
    const main = root.querySelector('[data-content]');
    const announce = root.querySelector('[data-status]');
    function switchTab(next) { category = next; render(); }
    function render() {
      nav.hidden = false;
      nav.replaceChildren();
      tabs.forEach(([key, title]) => {
        const tab = button(title, () => switchTab(key), 'pb-tab');
        tab.setAttribute('aria-pressed', String(key === category));
        nav.appendChild(tab);
      });
      main.replaceChildren();
      const intro = node('div', null, 'pb-intro');
      intro.append(node('p', 'PANTHORIUM / PLANS', 'pb-eyebrow'), node('h2', category === 'membership' ? 'เลือกแพ็กเกจที่เหมาะกับคุณ' : tabs.find(tab => tab[0] === category)[1]), node('p', 'บัญชีเดียว ใช้โควต้าร่วมกันทุกอุปกรณ์ · ไม่มี Reserve', 'pb-muted'));
      main.appendChild(intro);
      if (nativeAndroid()) main.append(node('p', 'การซื้อภายในแอปยังไม่เปิดให้บริการ', 'pb-notice'));
      const grid = node('div', null, 'pb-grid');
      catalog.products.filter(item => item.category === category).forEach(product => {
        const card = node('article', null, 'pb-card' + (product.id === 'work' ? ' pb-featured' : ''));
        card.append(node('p', product.kind === 'subscription' ? 'รายเดือน' : product.kind === 'free' ? 'เริ่มใช้งาน' : 'ซื้อครั้งเดียว', 'pb-eyebrow'), node('h3', product.name), node('p', price(product.price), 'pb-price'), node('p', product.term, 'pb-muted'));
        const list = node('ul');
        product.details.forEach(detail => list.appendChild(node('li', detail)));
        card.appendChild(list);
        if (product.kind === 'free') card.appendChild(node('p', 'ไม่ต้องชำระเงิน · สิทธิ์จริงขึ้นกับบัญชี', 'pb-muted'));
        else {
          const select = button('ดูรายละเอียดและยอดชำระ', () => checkout(product), 'pb-primary');
          select.disabled = nativeAndroid();
          select.dataset.productId = product.id;
          card.appendChild(select);
        }
        grid.appendChild(card);
      });
      main.appendChild(grid);
      const conditions = node('section', null, 'pb-conditions');
      conditions.append(node('h3', 'เงื่อนไขการใช้งาน'), node('p', 'สมาชิกไม่ทบโควต้า เมื่อหมดให้ซื้อเพิ่มหรือรอรอบใหม่ เสียงเข้า/ออกและข้อความเข้า/ออกแยกโควต้ากัน งานอัตโนมัติและการลองใหม่ใช้วงเงินเดียวกัน'), node('p', 'Voice/Text เสริมไม่ต่ออายุและไม่เติมอัตโนมัติ ใช้แพ็กที่หมดอายุก่อน บัญชี Free ต้องยืนยันบัญชีก่อนซื้อ และยังดาวน์โหลดไม่ได้'), node('p', 'พื้นที่และดาวน์โหลดเสริมสำหรับ Life ขึ้นไป การยกเลิกพื้นที่มีผลเมื่อสิ้นรอบ หากเกินโควต้าจะหยุดอัปโหลดและแจ้งให้ลดไฟล์ภายใน 30 วันก่อนดำเนินการตามนโยบายที่ยอมรับไว้'), node('p', 'ราคาสุทธิสำหรับผู้ขายบุคคลธรรมดาที่ยังไม่จด VAT · เกณฑ์วันที่ 11 ตุลาคม 2569', 'pb-muted'));
      main.appendChild(conditions);
      announce.textContent = 'ระบบชำระเงินอยู่ระหว่างเตรียมเปิดใช้งาน ดูแพ็กเกจและยอดชำระได้ ยังไม่มีการเรียกเก็บเงิน';
    }
    function checkout(product) {
      if (nativeAndroid()) return;
      nav.hidden = true;
      main.replaceChildren();
      main.appendChild(button('← กลับไปเลือกแพ็กเกจ', render, 'pb-back'));
      const summary = node('section', null, 'pb-summary');
      summary.append(node('p', 'CHECKOUT / สรุปรายการ', 'pb-eyebrow'), node('h2', product.name), node('p', product.term, 'pb-muted'));
      const list = node('ul');
      product.details.forEach(detail => list.appendChild(node('li', detail)));
      summary.appendChild(list);
      const total = node('div', null, 'pb-total');
      total.append(node('strong', 'ยอดชำระ'), node('strong', price(product.price)));
      summary.appendChild(total);
      summary.append(node('p', 'ราคาสุทธิ ไม่บวก VAT ขายเพิ่มในสถานะผู้ขายปัจจุบัน', 'pb-muted'));
      const user = os()?.state?.user;
      const registered = !!user && !(user.roles || []).includes('guest');
      summary.append(node('p', registered ? 'รายการซื้อจะผูกกับบัญชีที่คุณเข้าสู่ระบบ' : 'ต้องเข้าสู่ระบบและยืนยันบัญชีก่อนซื้อแพ็กเกจ', 'pb-notice'));
      if (product.paidMembershipRequired) summary.append(node('p', 'ต้องมีสมาชิก Life ขึ้นไป ระบบจะตรวจสอบสิทธิ์ก่อนรับชำระ'));
      if (product.kind === 'subscription') summary.append(node('p', 'ก่อนเปิดรับชำระ ระบบจะแสดงวันเริ่มรอบ ยอดเรียกเก็บจริง และเงื่อนไขต่ออายุ/ยกเลิกให้ตรวจสอบ'));
      else summary.append(node('p', 'อายุ 30 วันนับจากชำระ · ไม่มีต่ออายุหรือเติมอัตโนมัติ'));
      const policy = button('ดู Privacy/Policy', () => window.PanthoriumPrivacyPolicy?.open?.(), 'pb-back');
      summary.appendChild(policy);
      const pay = button('ชำระเงินผ่าน Omise — ยังไม่เปิดใช้งาน', () => {}, 'pb-primary');
      pay.disabled = true;
      summary.appendChild(pay);
      summary.append(node('p', 'จะเปิดรับชำระเมื่อระบบ Omise พร้อม และแสดงนโยบายคืนเงินก่อนยืนยันรายการ ไม่ต้องกรอกข้อมูลบัตรในหน้านี้', 'pb-muted'));
      main.appendChild(summary);
      announce.textContent = 'นี่คือหน้าสรุปก่อนชำระ ยังไม่มีคำสั่งซื้อและยังไม่มีการตัดเงิน';
      main.scrollTop = 0;
      main.focus();
    }
    root.addEventListener('panthorium:billing-reset', render);
    render();
    return true;
  }
  function markup() {
    return `<section data-billing-root>
      <style>
      [data-billing-root]{height:100%;display:flex;flex-direction:column;background:#0d1622;color:#eef4ff;font:14px/1.65 system-ui,sans-serif;min-width:0}
      [data-billing-root] *{box-sizing:border-box}[data-billing-root] button{font:inherit;color:inherit;cursor:pointer;min-height:44px;border-radius:10px;touch-action:manipulation}
      [data-billing-root] button:focus-visible{outline:3px solid #a4efff;outline-offset:3px}[data-billing-root] button:disabled{opacity:.6;cursor:not-allowed}
      [data-billing-root] h2{font-size:clamp(23px,3vw,34px);line-height:1.3;margin:8px 0 12px}[data-billing-root] h3{font-size:21px;margin:8px 0}
      [data-billing-root] p{margin:8px 0}[data-billing-root] ul{padding-left:20px}[data-billing-root] li{margin:8px 0}
      [data-billing-root] [data-tabs]{display:flex;gap:8px;padding:14px 20px;border-bottom:1px solid #26364a;flex-wrap:wrap;flex-shrink:0}
      [data-billing-root] .pb-tab,[data-billing-root] .pb-back{padding:9px 16px;background:transparent;border:1px solid #38506b}
      [data-billing-root] .pb-tab[aria-pressed=true]{background:#193947;border-color:#58d5d0;color:#8ff4e7}
      [data-billing-root] [data-content]{flex:1;min-height:0;overflow:auto;padding:clamp(16px,3vw,32px);overscroll-behavior:contain}
      [data-billing-root] .pb-intro{margin-bottom:24px}[data-billing-root] .pb-eyebrow{font-size:11px;letter-spacing:.14em;color:#82e3db}
      [data-billing-root] .pb-muted{color:#adbed3;font-size:13px}[data-billing-root] .pb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:16px}
      [data-billing-root] .pb-card{padding:22px 18px;border:1px solid #30445d;border-radius:18px;background:linear-gradient(150deg,#18273b,#111e2e);display:flex;flex-direction:column}
      [data-billing-root] .pb-featured{border-color:#65dacf;box-shadow:0 0 0 1px #65dacf}[data-billing-root] .pb-price{font-size:30px;font-weight:700;letter-spacing:-.04em}
      [data-billing-root] .pb-card ul{flex:1;font-size:13px}[data-billing-root] .pb-primary{width:100%;padding:12px;background:#83e8da;color:#082c2b;border:0;font-weight:700}
      [data-billing-root] .pb-conditions{margin-top:24px;padding:20px;border:1px solid #30445d;border-radius:14px;color:#c7d4e5;font-size:13px}
      [data-billing-root] .pb-notice{background:#1e3445;border-left:3px solid #8ddad7;padding:12px 14px;border-radius:6px}
      [data-billing-root] .pb-summary{max-width:620px;margin:22px auto;padding:clamp(18px,4vw,32px);border:1px solid #35536c;border-radius:18px;background:#142336}
      [data-billing-root] .pb-summary .pb-primary{margin-top:18px}[data-billing-root] .pb-total{display:flex;gap:20px;justify-content:space-between;padding:18px 0;margin-top:18px;border-top:1px solid #38506b;font-size:21px}
      [data-billing-root] [data-status]{padding:12px 20px;background:#142332;color:#b9d9ec;font-size:12px;border-top:1px solid #30445d;flex-shrink:0}
      @media(max-width:480px){[data-billing-root] [data-tabs]{padding:10px;gap:6px}[data-billing-root] .pb-tab{flex:1 1 40%;padding:7px}[data-billing-root] .pb-grid{grid-template-columns:1fr}[data-billing-root] [data-status]{padding:10px 14px}}
      </style>
      <nav data-tabs aria-label="ประเภทแพ็กเกจ"></nav>
      <main data-content tabindex="-1"></main>
      <div data-status role="status" aria-live="polite"></div>
    </section>`;
  }
  window.PanthoriumBilling = Object.freeze({ open });
  window.addEventListener('panthorium:auth-changed', () => {
    document.querySelector('[data-billing-root]')?.dispatchEvent(new Event('panthorium:billing-reset'));
  });
})();
