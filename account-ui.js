(function () {
  'use strict';
  const auth = () => window.PanthoriumAuth;
  const os = () => typeof OS !== 'undefined' ? OS : null;
  const signedIn = () => !!os()?.state?.user && !auth()?.isGuest?.();
  const windows = new Map();
  const messages = {
    invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', invalid_otp: 'OTP ไม่ถูกต้องหรือหมดอายุ',
    password_mismatch: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน', invalid_password: 'รหัสผ่านต้องมี 10–256 ตัวอักษร',
    email_delivery_not_configured: 'ระบบส่งอีเมลยังไม่พร้อม กรุณาติดต่อผู้ดูแล', email_delivery_failed: 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่',
    auth_unavailable: 'บริการเข้าสู่ระบบยังไม่พร้อม', valid_email_required: 'กรอกอีเมลให้ถูกต้อง'
  };
  const explain = error => messages[error?.message] || 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่';
  function close(id) {
    const root = windows.get(id);
    window.PanthoriumWindowManager?.close?.(id);
    root?.closest('.window')?.remove(); root?.closest('[data-account-window]')?.remove(); root?.remove();
    windows.delete(id);
  }
  function mount(id, title, body) {
    const existing = windows.get(id);
    if (existing?.isConnected) { window.PanthoriumWindowManager?.restore?.(id); return existing; }
    const html = `<section data-account-root>${style()}<div class="pa-wrap">${body}<p data-account-state role="status" aria-live="polite"></p></div></section>`;
    let root;
    if (typeof createWindow === 'function') {
      createWindow(id, title, html, { width: 560, height: 680 });
      root = document.querySelector('.window[data-id="' + id + '"] [data-account-root]');
    } else {
      const el = document.createElement('div'); el.dataset.accountWindow = id;
      el.style.cssText = 'position:fixed;inset:0;z-index:10060;background:#101b2b;color:#eef6ff;overflow:auto';
      el.innerHTML = '<header><h2>' + title + '</h2><button type="button" data-account-close>✕</button></header>' + html;
      document.body.appendChild(el); root = el.querySelector('[data-account-root]');
      el.querySelector('[data-account-close]').onclick = () => { el.remove(); windows.delete(id); };
      window.PanthoriumWindowManager?.registerExternalWindow?.(id, title, el, { menuAppId: id });
    }
    windows.set(id, root); return root;
  }
  function style() {
    return `<style>
      [data-account-root]{height:100%;overflow:auto;background:#101b2b;color:#eef6ff;font:14px/1.65 system-ui,sans-serif;box-sizing:border-box}
      [data-account-root] *{box-sizing:border-box}[data-account-root] .pa-wrap{max-width:520px;margin:auto;padding:clamp(20px,4vw,40px)}
      [data-account-root] h2{font-size:28px;line-height:1.3;margin:8px 0 18px}[data-account-root] p{color:#bbccdf}
      [data-account-root] label{display:block;margin:14px 0 6px}[data-account-root] input:not([type=checkbox]){display:block;width:100%;border:1px solid #3b5876;background:#0a1422;color:#fff;padding:12px;border-radius:10px;font:inherit;margin-top:6px;min-height:44px}
      [data-account-root] button{font:inherit;min-height:44px;cursor:pointer;border-radius:10px;border:1px solid #527896;background:transparent;color:#d9f3ff;padding:10px 16px;margin:12px 6px 0 0;touch-action:manipulation}
      [data-account-root] button[type=submit], [data-account-root] [data-logout-confirm]{background:#83e8da;border:0;color:#092d29;font-weight:700;width:100%}
      [data-account-root] :focus-visible{outline:3px solid #9ce8ff;outline-offset:3px}[data-account-root] button:disabled{opacity:.55;cursor:not-allowed}
      [data-account-root] [hidden]{display:none!important}[data-account-root] [data-account-state]{min-height:26px;white-space:pre-wrap}
    </style>`;
  }
  async function request(path, body) {
    const base = String(auth()?.getBackendUrl?.() || os()?.config?.backendUrl || '').replace(/\/$/, '');
    const response = await fetch(base + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'request_failed');
    return result;
  }
  function openLogin(forgot = false) {
    const root = mount('account-login', '🔐 เข้าสู่ระบบ / ลืมรหัสผ่าน', `
      <div data-login-panel><h2>เข้าสู่ระบบ</h2><p>ใช้บัญชี Panthorium เดียวกันบนเว็บและทุกอุปกรณ์</p>
      <form data-login-form><label>อีเมล<input data-login-email type="email" autocomplete="username" required maxlength="254"></label>
      <label>รหัสผ่าน<input data-login-password type="password" autocomplete="current-password" required maxlength="256"></label>
      <label><input data-login-remember type="checkbox"> จดจำรหัสผ่านและการเข้าสู่ระบบบนอุปกรณ์นี้</label>
      <button type="submit" data-login-submit>เข้าสู่ระบบ</button></form>
      <button type="button" data-forgot>ลืมรหัสผ่าน / เปลี่ยนรหัสผ่าน</button><button type="button" data-open-register>ลงทะเบียนบัญชี</button></div>
      <div data-reset-panel hidden><h2>ลืมรหัสผ่าน</h2><p>ยืนยันอีเมลด้วย OTP ก่อนตั้งรหัสผ่านใหม่</p>
      <form data-reset-request-form><label>อีเมล<input data-reset-email type="email" autocomplete="email" required maxlength="254"></label><button type="submit" data-reset-request>ส่ง OTP</button></form>
      <form data-reset-form><label>OTP 6 หลัก<input data-reset-code inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label>
      <label>รหัสผ่านใหม่<input data-reset-password type="password" autocomplete="new-password" minlength="10" maxlength="256" required></label>
      <label>ยืนยันรหัสผ่านใหม่<input data-reset-password-confirm type="password" autocomplete="new-password" minlength="10" maxlength="256" required></label>
      <button type="submit" data-reset-confirm>ตั้งรหัสผ่านใหม่</button></form><button type="button" data-back-login>กลับไปเข้าสู่ระบบ</button></div>`);
    if (!root) return false;
    const state = root.querySelector('[data-account-state]');
    const loginPanel = root.querySelector('[data-login-panel]'), resetPanel = root.querySelector('[data-reset-panel]');
    const email = root.querySelector('[data-login-email]');
    const resetEmail = root.querySelector('[data-reset-email]');
    function showReset() { loginPanel.hidden = true; resetPanel.hidden = false; resetEmail.value = email.value || os()?.state?.user?.email || ''; state.textContent = ''; resetEmail.focus(); }
    function showLogin() { resetPanel.hidden = true; loginPanel.hidden = false; state.textContent = signedIn() ? 'คุณเข้าสู่ระบบแล้ว สามารถเปลี่ยนรหัสผ่านได้จากปุ่มด้านล่าง' : ''; email.focus(); }
    root.querySelector('[data-forgot]').onclick = showReset;
    root.querySelector('[data-back-login]').onclick = showLogin;
    root.querySelector('[data-open-register]').onclick = openRegistration;
    root.querySelector('[data-login-submit]').disabled = signedIn();
    root.querySelector('[data-open-register]').hidden = signedIn();
    const protect = (form, action) => {
      form.onsubmit = async event => {
        event.preventDefault(); if (!form.checkValidity() || form.dataset.busy) return;
        form.dataset.busy = '1'; const submit = form.querySelector('[type=submit]'); submit.disabled = true; state.textContent = 'กำลังดำเนินการ…';
        try { await action(); } catch (error) { state.textContent = explain(error); }
        finally { delete form.dataset.busy; submit.disabled = form.hasAttribute('data-login-form') && signedIn(); }
      };
    };
    protect(root.querySelector('[data-login-form]'), async () => {
      if (signedIn()) return;
      const password = root.querySelector('[data-login-password]');
      const remember = root.querySelector('[data-login-remember]').checked;
      const value = password.value;
      try { await auth().login(email.value.trim(), value, remember); await auth().savePassword?.(email.value.trim(), value, remember); close('account-login'); }
      finally { password.value = ''; }
    });
    protect(root.querySelector('[data-reset-request-form]'), async () => {
      await request('/api/auth/password/forgot', { email: resetEmail.value.trim() });
      state.textContent = 'หากอีเมลนี้มีบัญชี ระบบจะส่ง OTP ให้ รหัสใช้ได้ 10 นาที';
    });
    protect(root.querySelector('[data-reset-form]'), async () => {
      if (!resetEmail.checkValidity()) throw new Error('valid_email_required');
      const password = root.querySelector('[data-reset-password]'), confirm = root.querySelector('[data-reset-password-confirm]'), code = root.querySelector('[data-reset-code]');
      if (password.value !== confirm.value) throw new Error('password_mismatch');
      await request('/api/auth/password/reset', { email: resetEmail.value.trim(), code: code.value.trim(), password: password.value, confirmPassword: confirm.value });
      password.value = ''; confirm.value = ''; code.value = '';
      state.textContent = 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่';
    });
    if (forgot) showReset(); else showLogin();
    return true;
  }
  function openRegistration() {
    if (signedIn()) return openLogin();
    return window.PanthoriumVoiceIdentity?.openRegistration?.();
  }
  function openLogout() {
    if (!signedIn()) return openLogin();
    const root = mount('account-logout', '🚪 ออกจากระบบ', '<h2>ออกจากระบบ</h2><p data-logout-account></p><p>คุณสามารถกลับมาเข้าสู่ระบบด้วยบัญชีเดิมได้</p><button type="button" data-logout-confirm>ออกจากระบบ</button><button type="button" data-logout-cancel>ยกเลิก</button>');
    root.querySelector('[data-logout-account]').textContent = os()?.state?.user?.email || os()?.state?.user?.username || 'บัญชีปัจจุบัน';
    root.querySelector('[data-logout-cancel]').onclick = () => close('account-logout');
    root.querySelector('[data-logout-confirm]').onclick = async () => {
      const submit = root.querySelector('[data-logout-confirm]'); if (submit.disabled) return; submit.disabled = true;
      try { await auth().logout(); close('account-logout'); }
      catch (error) { root.querySelector('[data-account-state]').textContent = explain(error); submit.disabled = false; }
    };
    return true;
  }
  window.PanthoriumAccounts = Object.freeze({ openLogin, openRegistration, openLogout, openForgot: () => openLogin(true) });
  window.addEventListener('panthorium:auth-changed', () => { for (const id of [...windows.keys()]) close(id); });
})();
