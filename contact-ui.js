(function () {
  'use strict';
  const APP_ID = 'contact';
  const guest = () => typeof OS === 'undefined' || !OS.state.user || OS.state.user.roles?.includes('guest');
  function sync() {
    const root = document.querySelector('[data-panthorium-contact]');
    if (!root) return;
    root.querySelector('[data-contact-note]').textContent = guest()
      ? 'เข้าสู่ระบบเพื่อแชทกับแอดมินและติดตามคำตอบ หรือส่งอีเมลถึงเราได้ทันที'
      : 'ส่งข้อความถึงแอดมินโดยตรง และติดตามคำตอบได้ใน Talk';
  }
  function open() {
    const existing = document.querySelector('[data-panthorium-contact]');
    if (existing) { window.focusWindow?.(APP_ID); sync(); return existing; }
    window.createWindow(APP_ID, 'ศูนย์ช่วยเหลือ', `
      <section data-panthorium-contact>
        <style>
          [data-panthorium-contact]{box-sizing:border-box;height:100%;overflow:auto;padding:clamp(20px,5vw,48px);color:var(--text,#edf2f7);background:linear-gradient(145deg,#10151f,#221a15);font:15px/1.7 system-ui,sans-serif}
          [data-panthorium-contact] *{box-sizing:border-box}
          [data-panthorium-contact] h1{font-size:clamp(26px,5vw,38px);line-height:1.3;margin:8px 0 28px;color:#ffb26e}
          [data-panthorium-contact] article{max-width:780px;margin:14px 0;padding:20px;border:1px solid #514637;border-radius:14px;background:#111923}
          [data-panthorium-contact] h2{font-size:18px;margin:0 0 8px}
          [data-panthorium-contact] p{margin:6px 0;overflow-wrap:anywhere}
          [data-panthorium-contact] address{font-style:normal;overflow-wrap:anywhere}
          [data-panthorium-contact] a{color:#91d9ff}
          [data-panthorium-contact] button{font:inherit;cursor:pointer;min-height:44px;padding:10px 20px;border:1px solid #ffad64;border-radius:10px;background:#f78a30;color:#15110e;font-weight:600}
          [data-panthorium-contact] button:disabled{opacity:.6;cursor:wait}
          [data-panthorium-contact] :focus-visible{outline:2px solid #91d9ff;outline-offset:4px}
          [data-panthorium-contact] [role=status]{color:#ffb26e}
        </style>
        <small>PANTHORIUM / HELP CENTER</small><h1>ศูนย์ช่วยเหลือ</h1>
        <article><h2>สำนักงานใหญ่</h2><address>32 moo4 Pajod Kohkeaw Waritchaphum SakonNakhon 47150</address></article>
        <article><h2>อีเมล์</h2><a href="mailto:account@panthorium.net">account@panthorium.net</a></article>
        <article><h2>แชทกับเรา</h2><p data-contact-note></p><button type="button" data-contact-chat>แชทกับเรา</button><p role="status" aria-live="polite"></p></article>
      </section>`, { width: 780, height: 650 });
    const root = document.querySelector('[data-panthorium-contact]');
    if (!root) return null;
    const button = root.querySelector('[data-contact-chat]');
    button.addEventListener('click', async () => {
      if (guest()) { window.PanthoriumAccounts?.openLogin?.(); return; }
      button.disabled = true;
      const status = root.querySelector('[role=status]');
      status.textContent = '';
      try {
        if (!window.PanthoriumSocial?.open) throw Error('social_unavailable');
        await window.PanthoriumSocial.open('talk', { support: true });
      } catch (_) {
        status.textContent = 'เปิดแชทไม่สำเร็จ กรุณาลองอีกครั้ง หรือติดต่อ account@panthorium.net';
      } finally { button.disabled = false; }
    });
    sync();
    return root;
  }
  window.PanthoriumContact = Object.freeze({ open });
  window.addEventListener('panthorium:auth-changed', sync);
})();
