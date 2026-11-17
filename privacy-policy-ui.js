(function () {
  'use strict';

  const APP_ID = 'privacy-policy';
  // Extend the central registry through PanthoriumPrivacyPolicy.register({id,title,sections}).
  const policies = new Map();
  const initialPolicies = window.PanthoriumPrivacyNotice?.policies || [];
  const currentUser = () => typeof OS !== 'undefined' ? OS.state?.user : null;
  const accountId = () => String(currentUser()?.sub || currentUser()?.id || '');
  const signedIn = () => !!accountId() && !/^guest[:_-]/i.test(accountId()) && !(currentUser()?.roles || []).includes('guest');
  const authIdentity = () => JSON.stringify([accountId(), [...(currentUser()?.roles || [])].sort()]);
  let lastAuthIdentity = authIdentity();

  async function requestApi(method, body, resource = 'account-deletion') {
    const owner = accountId();
    if (!signedIn()) throw new Error('authentication_required');
    const valid = () => signedIn() && accountId() === owner;
    const send = () => {
      if (!valid()) throw new Error('account_changed');
      const backend = typeof OS !== 'undefined' ? OS.config?.backendUrl || '' : '';
      const token = typeof OS !== 'undefined' ? OS.config?.accessToken || '' : '';
      return fetch(backend.replace(/\/$/, '') + '/api/privacy/' + resource, {
        method, credentials: 'include', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    };
    let response = await send();
    if (response.status === 401 && valid() && window.PanthoriumAuth?.refreshSession) {
      if (await window.PanthoriumAuth.refreshSession().catch(() => false)) response = await send();
    }
    const data = await response.json().catch(() => ({}));
    if (!valid()) throw new Error('account_changed');
    if (!response.ok || data.ok === false) throw new Error(data.error || 'request_unavailable');
    return data;
  }

  function renderReportForm(root, content, target) {
    const panel = document.createElement('section'); panel.className = 'pp-section'; panel.dataset.aiReport = ''; content.appendChild(panel);
    appendText(panel, 'h3', 'ส่งรายงานให้ผู้ดูแล');
    const status = appendText(panel, 'p', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.reportStatus = '';
    if (!signedIn()) {
      status.textContent = 'ลงชื่อเข้าใช้เพื่อส่งรายงานคำตอบ AI';
      const login = appendText(panel, 'button', 'เข้าสู่ระบบเพื่อรายงาน'); login.type = 'button'; login.onclick = () => window.PanthoriumAccounts?.openLogin?.(); return;
    }
    const owner = accountId();
    const source = target?.sourceType === 'cloud_app_run' && typeof target.sourceId === 'string' && target.sourceId ? { sourceType: 'cloud_app_run', sourceId: target.sourceId } : { sourceType: 'general' };
    const valid = () => root.isConnected && panel.isConnected && signedIn() && accountId() === owner;
    appendText(panel, 'p', source.sourceId ? 'รายงานผลลัพธ์ Cloud Apps เลขอ้างอิง ' + source.sourceId : 'รายงานคำตอบทั่วไปหรือคำตอบเสียง • ระบุข้อความหรือช่วงเวลาที่เกิดปัญหา');
    const form = document.createElement('form'); form.dataset.reportForm = ''; form.style.cssText = 'display:grid;gap:10px;margin-top:12px';
    const label = appendText(form, 'label', 'ประเภทปัญหา'); label.style.cssText = 'display:grid;gap:5px';
    const category = document.createElement('select'); category.dataset.reportCategory = ''; category.style.cssText = 'padding:10px;font:inherit';
    for (const [id, text] of [['inaccurate', 'ข้อมูลไม่ถูกต้อง'], ['harmful', 'เนื้อหาที่เป็นอันตราย'], ['privacy', 'ความเป็นส่วนตัว'], ['other', 'ปัญหาอื่น']]) { const option = appendText(category, 'option', text); option.value = id; }
    label.appendChild(category);
    const detailLabel = appendText(form, 'label', source.sourceId ? 'รายละเอียดเพิ่มเติม (ไม่บังคับ)' : 'รายละเอียดคำตอบที่ต้องการรายงาน'); detailLabel.style.cssText = 'display:grid;gap:5px';
    const details = appendText(detailLabel, 'textarea', ''); details.dataset.reportDetails = ''; details.rows = 4; details.maxLength = 2000; details.required = source.sourceType === 'general'; details.style.cssText = 'padding:10px;font:inherit;resize:vertical';
    appendText(form, 'small', 'ไม่ใส่รหัสผ่าน รหัส OTP หรือข้อมูลส่วนตัวที่ไม่จำเป็น รายงานนี้ส่งเข้าคิวภายในของผู้ดูแล Panthorium');
    const submit = appendText(form, 'button', 'ส่งรายงาน'); submit.type = 'submit'; submit.dataset.reportSubmit = ''; submit.style.cssText = 'justify-self:start;padding:10px 14px'; panel.appendChild(form);
    form.onsubmit = async event => {
      event.preventDefault(); if (!valid() || submit.disabled) return;
      if (source.sourceType === 'general' && !details.value.trim()) { status.textContent = 'กรอกรายละเอียดคำตอบที่มีปัญหาก่อนส่ง'; return; }
      submit.disabled = true; status.textContent = 'กำลังส่งรายงาน…';
      try {
        const data = await requestApi('POST', { ...source, category: category.value, details: details.value.trim() }, 'reports');
        if (!valid()) return; status.textContent = 'รับรายงานเข้าคิวผู้ดูแลแล้ว • เลขอ้างอิง ' + String(data.request?.id || '') + ' • ยังไม่ใช่ผลการตรวจสอบ';
        form.hidden = true; form.style.display = 'none';
      } catch (_) { if (valid()) status.textContent = 'ยังไม่ได้รับการยืนยันว่ารับรายงาน • ตรวจการเชื่อมต่อก่อนส่งอีกครั้ง'; }
      finally { if (valid()) submit.disabled = false; }
    };
  }

  function renderDeletionRequest(root, content) {
    const panel = document.createElement('section'); panel.className = 'pp-section'; panel.dataset.deletionRequest = '';
    content.appendChild(panel);
    appendText(panel, 'h3', 'คำขอลบบัญชีของฉัน');
    const status = appendText(panel, 'p', '', 'pp-request-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    if (!signedIn()) {
      status.textContent = 'ลงชื่อเข้าใช้บัญชีที่ต้องการลบเพื่อส่งและติดตามคำขอ';
      const login = appendText(panel, 'button', 'เข้าสู่ระบบเพื่อยื่นคำขอ'); login.type = 'button'; login.dataset.deletionLogin = '';
      login.onclick = () => window.PanthoriumAccounts?.openLogin?.();
      return;
    }
    const owner = accountId();
    const valid = () => root.isConnected && panel.isConnected && root.dataset.selectedPolicy === 'account-deletion' && signedIn() && accountId() === owner;
    const receipt = appendText(panel, 'div', ''); receipt.dataset.deletionReceipt = '';
    const form = document.createElement('form'); form.dataset.deletionForm = ''; form.style.cssText = 'display:grid;gap:10px;margin-top:15px';
    const reasonLabel = appendText(form, 'label', 'เหตุผลหรือรายละเอียดเพิ่มเติม (ไม่บังคับ)'); reasonLabel.style.cssText = 'display:grid;gap:5px';
    const reason = appendText(reasonLabel, 'textarea', ''); reason.rows = 3; reason.maxLength = 500; reason.dataset.deletionReason = ''; reason.setAttribute('aria-label', 'รายละเอียดคำขอลบบัญชี'); reason.style.cssText = 'padding:10px;resize:vertical;font:inherit';
    appendText(form, 'small', 'ไม่ต้องใส่รหัสผ่าน รหัส OTP หรือข้อมูลส่วนตัวที่ไม่จำเป็น');
    const acknowledgement = document.createElement('label'); acknowledgement.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
    const check = document.createElement('input'); check.type = 'checkbox'; check.required = true; check.dataset.deletionAcknowledge = '';
    acknowledgement.appendChild(check); appendText(acknowledgement, 'span', 'ฉันขอให้ผู้ดูแลลบบัญชีและข้อมูลที่เกี่ยวข้อง และเข้าใจว่าต้องรอตรวจสอบและดำเนินการก่อน ไม่ได้ลบทันที');
    form.appendChild(acknowledgement);
    const submit = appendText(form, 'button', 'ส่งคำขอลบบัญชีและข้อมูล'); submit.type = 'submit'; submit.style.cssText = 'justify-self:start;padding:10px 14px'; submit.dataset.deletionSubmit = '';
    panel.appendChild(form);
    const refresh = appendText(panel, 'button', 'ตรวจสถานะคำขอ'); refresh.type = 'button'; refresh.dataset.deletionRefresh = ''; refresh.style.cssText = 'margin-top:12px;padding:8px 12px';
    const renderRequest = request => {
      receipt.replaceChildren();
      if (!request) { form.hidden = false; form.style.display = 'grid'; status.textContent = 'ยังไม่มีคำขอลบบัญชี'; return; }
      const labels = { requested: 'รับคำขอแล้ว • รอผู้ดูแลตรวจสอบ', manual_processing: 'ผู้ดูแลกำลังดำเนินการตามคำขอ', completed: 'ผู้ดูแลปิดคำขอแล้ว • โปรดอ่านผลการดำเนินการ' };
      status.textContent = labels[request.status] || 'คำขออยู่ระหว่างตรวจสอบสถานะ';
      appendText(receipt, 'p', 'เลขอ้างอิง: ' + String(request.id || ''));
      const created = new Date(request.createdAt);
      if (Number.isFinite(created.getTime())) appendText(receipt, 'p', 'ส่งเมื่อ: ' + created.toLocaleString('th-TH'));
      if (request.resolution) appendText(receipt, 'p', String(request.resolution));
      appendText(receipt, 'p', 'การรับหรือปิดคำขอเพียงอย่างเดียวไม่ยืนยันว่าลบข้อมูลทุกประเภทแล้ว ให้ตรวจผลและข้อยกเว้นที่ผู้ดูแลแจ้ง');
      form.hidden = request.status === 'requested' || request.status === 'manual_processing';
      form.style.display = form.hidden ? 'none' : 'grid';
    };
    async function load() {
      status.textContent = 'กำลังตรวจสถานะบน Cloud…'; refresh.disabled = true;
      try { const data = await requestApi('GET'); if (valid()) renderRequest(data.request); }
      catch (_) { if (valid()) status.textContent = 'โหลดสถานะไม่ได้ • ตรวจการเชื่อมต่อแล้วกดตรวจสถานะอีกครั้ง'; }
      finally { if (valid()) refresh.disabled = false; }
    }
    refresh.onclick = load;
    form.onsubmit = async event => {
      event.preventDefault(); if (!valid() || submit.disabled || !check.checked) return;
      submit.disabled = true; status.textContent = 'กำลังส่งคำขอให้ผู้ดูแล…';
      try {
        const data = await requestApi('POST', { confirmation: 'DELETE_REQUEST', reason: reason.value.trim() });
        if (!valid()) return; renderRequest(data.request); reason.value = ''; check.checked = false;
      } catch (_) { if (valid()) status.textContent = 'ยังไม่ได้รับการยืนยันว่ารับคำขอ • ตรวจสถานะก่อนส่งอีกครั้ง'; }
      finally { if (valid()) submit.disabled = false; }
    };
    load();
  }

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
  function renderArticle(root, id, reportContext) {
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
    if (['privacy-notice', 'account-deletion'].includes(policy.id)) {
      const link = appendText(content, 'a', policy.id === 'account-deletion' ? 'เปิดหน้าขอลบบัญชีสาธารณะ / ติดต่อทางอีเมล' : 'เปิดนโยบายฉบับสาธารณะ');
      link.href = policy.id === 'account-deletion' ? '/account-deletion' : '/privacy';
      link.target = '_blank'; link.rel = 'noopener';
    }
    if (policy.id === 'account-deletion') renderDeletionRequest(root, content);
    if (policy.id === 'ai-report') renderReportForm(root, content, reportContext);
  }
  function createWindow(selectedPolicy, reportContext) {
    const root = document.createElement('section');
    root.id = 'panthorium-privacy-policy';
    root.tabIndex = -1;
    root.style.cssText = 'position:fixed;inset:0;z-index:10030;background:#10161d;color:#e7edf4;border:1px solid #33404a;border-radius:0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;font:14px/1.55 system-ui,sans-serif';
    root.innerHTML = `
      <style>
        #panthorium-privacy-policy *{box-sizing:border-box}#panthorium-privacy-policy [hidden]{display:none!important}#panthorium-privacy-policy button{font:inherit;color:inherit;touch-action:manipulation}
        #panthorium-privacy-policy header{min-height:66px;padding:env(safe-area-inset-top,0px) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));display:flex;align-items:center;gap:12px;background:#1c242b;border-bottom:1px solid #34404a}
        #panthorium-privacy-policy .pp-brand{min-width:0;flex:1}#panthorium-privacy-policy .pp-brand h1{margin:0;font-size:18px;line-height:1.2}#panthorium-privacy-policy .pp-brand p{margin:4px 0 0;color:#9eacb7;font-size:12px}
        #panthorium-privacy-policy [data-close],#panthorium-privacy-policy [data-minimize]{min-width:40px;min-height:40px;border:1px solid #46535e;border-radius:8px;background:#252e36;cursor:pointer}
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
      <div class="pp-workspace"><nav data-policy-nav aria-label="หัวข้อ Privacy/Policy"></nav><main data-policy-content tabindex="0"></main></div>`;
    root.querySelector('[data-close]').addEventListener('click', () => {
      if (window.PanthoriumWindowManager?.close?.(APP_ID)) return;
      root.remove();
    });
    renderArticle(root, selectedPolicy || root.dataset.selectedPolicy || policies.keys().next().value, reportContext);
    document.body.appendChild(root);
    window.PanthoriumWindowManager?.registerExternal?.(APP_ID, 'Privacy/Policy', root, { menuAppId: APP_ID });
    return root;
  }
  function open(selectedPolicy, reportContext) {
    const existing = window.PanthoriumWindowManager?.findByAppId?.(APP_ID)?.el || document.getElementById('panthorium-privacy-policy');
    if (existing) {
      if (window.PanthoriumWindowManager?.restore) window.PanthoriumWindowManager.restore(APP_ID);
      else existing.style.display = 'flex';
      renderArticle(existing, selectedPolicy || existing.dataset.selectedPolicy, reportContext);
      existing.focus?.();
      return existing;
    }
    return createWindow(selectedPolicy, reportContext);
  }

  const openDeletionRequest = () => open('account-deletion');
  const openAIReport = target => open('ai-report', target);
  window.PanthoriumPrivacyPolicy = Object.freeze({ open, list, register, openDeletionRequest, openAIReport });
  window.PanthoriumStartMenuUI?.pinLast?.(APP_ID);
  window.addEventListener('panthorium:policy-registry-changed', () => {
    const root = document.getElementById('panthorium-privacy-policy');
    if (root) renderArticle(root, root.dataset.selectedPolicy);
  });
  window.addEventListener('panthorium:auth-changed', () => {
    const next = authIdentity(); if (next === lastAuthIdentity) return; lastAuthIdentity = next;
    const root = document.getElementById('panthorium-privacy-policy');
    if (['account-deletion', 'ai-report'].includes(root?.dataset.selectedPolicy)) renderArticle(root, root.dataset.selectedPolicy);
  });
  let routeOpened = false;
  function openRequestedRoute() {
    if (routeOpened) return;
    if (/^\/account-deletion\/?$/.test(window.location.pathname) || new URLSearchParams(window.location.search).get('privacy') === 'account-deletion') {
      routeOpened = true; openDeletionRequest();
    }
  }
  window.addEventListener('panthorium:boot-complete', openRequestedRoute);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openRequestedRoute, { once: true }); else openRequestedRoute();
})();
