(function () {
  'use strict';

  const selector = '.window[data-id="assistant-preferences"]';
  const defaults = Object.freeze({ version: 1, preferredName: '', style: 'natural', language: 'automatic' });
  const api = () => typeof OS !== 'undefined' ? OS : null;
  const accountId = () => String(api()?.state?.user?.sub || api()?.state?.user?.id || '');
  const registered = () => {
    const user = api()?.state?.user || {};
    return !!accountId() && !accountId().startsWith('guest:')
      && !(user.roles || []).includes('guest')
      && (user.permissions || []).includes('chat');
  };

  function markup() {
    const field = 'box-sizing:border-box;width:100%;padding:10px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;';
    return '<div data-preferences-root style="height:100%;display:flex;flex-direction:column;gap:14px;padding:16px;overflow:auto;color:var(--text);">' +
      '<p style="margin:0;color:var(--text-dim);font-size:13px;line-height:1.6;">ปรับวิธีที่ Sentinel เรียกชื่อและจัดรูปแบบคำตอบของคุณ ค่านี้ซิงก์กับบัญชีบนคลาวด์ และมีผลกับบัญชีนี้เท่านั้น</p>' +
      '<form data-preferences-form style="display:grid;gap:14px;">' +
        '<label style="display:grid;gap:6px;font-size:13px;">ชื่อที่อยากให้ Sentinel เรียก (ไม่บังคับ)<input data-preferences-name maxlength="48" autocomplete="nickname" placeholder="เช่น คุณปานเทพ" style="' + field + '"></label>' +
        '<label style="display:grid;gap:6px;font-size:13px;">รูปแบบคำตอบ<select data-preferences-style style="' + field + '">' +
          '<option value="natural">เป็นธรรมชาติ</option><option value="concise">กระชับ</option><option value="detailed">ละเอียด</option></select></label>' +
        '<label style="display:grid;gap:6px;font-size:13px;">ภาษาคำตอบ<select data-preferences-language style="' + field + '">' +
          '<option value="automatic">ตามภาษาที่ฉันใช้</option><option value="thai">ภาษาไทย</option><option value="english">ภาษาอังกฤษ</option></select></label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button data-preferences-save type="submit" style="border:1px solid rgba(0,255,204,.45);background:linear-gradient(120deg,rgba(0,255,204,.2),rgba(21,157,255,.18));color:var(--text);border-radius:10px;padding:9px 15px;font:inherit;cursor:pointer;">บันทึกบนคลาวด์</button>' +
          '<button data-preferences-reset type="button" style="border:1px solid rgba(151,190,216,.25);background:transparent;color:var(--text);border-radius:10px;padding:9px 15px;font:inherit;cursor:pointer;">ใช้ค่าเริ่มต้น</button>' +
          '<button data-preferences-refresh type="button" style="border:1px solid rgba(151,190,216,.25);background:transparent;color:var(--text);border-radius:10px;padding:9px 15px;font:inherit;cursor:pointer;">โหลดใหม่</button>' +
        '</div>' +
      '</form>' +
      '<div data-preferences-status role="status" aria-live="polite" style="min-height:1.5em;color:var(--text-dim);font-size:13px;"></div>' +
      '<small style="color:var(--text-dim);font-size:11px;line-height:1.5;">ความชอบนี้ใช้กำกับรูปแบบการตอบเท่านั้น และไม่แทนคำขอปัจจุบันหรือข้อกำหนดความปลอดภัย Sentinel จะไม่บันทึกไว้ในเครื่อง</small>' +
    '</div>';
  }

  function decode(item) {
    if (!item || item.title !== 'Sentinel response preferences' || !item.memoryId) return null;
    try {
      const data = JSON.parse(String(item.content || ''));
      if (data?.version !== 1) return null;
      const preferredName = String(data.preferredName || '').normalize('NFC').replace(/[\r\n\p{Cc}]/gu, ' ').trim();
      const validName = !preferredName || (preferredName.length <= 48 && /^[\p{L}\p{M}\p{N} .’'_\-]+$/u.test(preferredName));
      if (!validName) return null;
      return {
        memoryId: String(item.memoryId),
        preferences: {
          version: 1,
          preferredName,
          style: ['natural', 'concise', 'detailed'].includes(data.style) ? data.style : 'natural',
          language: ['automatic', 'thai', 'english'].includes(data.language) ? data.language : 'automatic'
        }
      };
    } catch (_) { return null; }
  }

  async function open() {
    const os = api();
    if (!os || typeof createWindow !== 'function' || !registered()) return false;
    if (os.windows.has('assistant-preferences')) { focusWindow('assistant-preferences'); return true; }
    createWindow('assistant-preferences', '⚙️ ความชอบ Sentinel', markup(), { width: 500, height: 520 });
    const win = document.querySelector(selector);
    const root = win?.querySelector('[data-preferences-root]');
    if (!root) return false;

    const form = root.querySelector('[data-preferences-form]');
    const nameField = root.querySelector('[data-preferences-name]');
    const styleField = root.querySelector('[data-preferences-style]');
    const languageField = root.querySelector('[data-preferences-language]');
    const status = root.querySelector('[data-preferences-status]');
    const controls = [...root.querySelectorAll('input,select,button')];
    let memoryId = '';
    let loaded = false;
    const setStatus = value => { if (root.isConnected) status.textContent = value; };
    const setDisabled = value => { for (const control of controls) control.disabled = value; };
    const clearForm = () => { nameField.value = ''; styleField.value = defaults.style; languageField.value = defaults.language; memoryId = ''; };
    const isCurrent = owner => root.isConnected && owner === accountId();

    async function call(path, options) {
      const base = String(api()?.config?.backendUrl || '').replace(/\/$/, '');
      if (!base || typeof authorizedFetch !== 'function') throw new Error('cloud_unavailable');
      const response = await authorizedFetch(base + path, { signal: AbortSignal.timeout(12000), ...(options || {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const error = new Error(data.error || 'preference_request_failed');
        error.httpStatus = response.status;
        throw error;
      }
      return data;
    }

    function show(preferences) {
      nameField.value = preferences.preferredName;
      styleField.value = preferences.style;
      languageField.value = preferences.language;
    }

    async function load() {
      if (!root.isConnected) return false;
      const owner = accountId();
      clearForm();
      loaded = false;
      setDisabled(true);
      if (!registered()) {
        setStatus('ความชอบส่วนตัวใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้');
        return false;
      }
      setStatus('กำลังโหลดความชอบจากคลาวด์…');
      try {
        const result = await call('/api/agent/memory?kind=assistant-preference&limit=10');
        if (!isCurrent(owner)) return false;
        const item = (Array.isArray(result.memories) ? result.memories : [])
          .find(entry => entry.kind === 'assistant-preference' && entry.title === 'Sentinel response preferences');
        const saved = decode(item);
        if (saved) { memoryId = saved.memoryId; show(saved.preferences); }
        loaded = true;
        setDisabled(false);
        setStatus(saved ? 'โหลดความชอบของบัญชีนี้แล้ว' : 'ยังไม่มีความชอบที่บันทึกไว้ • กำลังใช้ค่าเริ่มต้น');
        return true;
      } catch (error) {
        if (!isCurrent(owner)) return false;
        setStatus(error.httpStatus === 401 ? 'เซสชันหมดอายุ • ลงชื่อเข้าใช้อีกครั้งเพื่อโหลดความชอบ' : error.httpStatus === 403 ? 'บัญชีนี้ไม่มีสิทธิ์ใช้ความชอบส่วนตัว' : 'โหลดจากคลาวด์ไม่สำเร็จ • กดโหลดใหม่เพื่อลองอีกครั้ง');
        return false;
      }
    }

    async function save(preferences) {
      if (!registered() || !loaded) { setStatus('โหลดความชอบจากคลาวด์ให้เสร็จก่อนบันทึก'); return false; }
      const owner = accountId();
      const normalized = {
        version: 1,
        preferredName: String(preferences.preferredName || '').normalize('NFC').replace(/[\r\n\p{Cc}]/gu, ' ').trim(),
        style: ['natural', 'concise', 'detailed'].includes(preferences.style) ? preferences.style : defaults.style,
        language: ['automatic', 'thai', 'english'].includes(preferences.language) ? preferences.language : defaults.language
      };
      if (normalized.preferredName.length > 48 || (normalized.preferredName && !/^[\p{L}\p{M}\p{N} .’'_\-]+$/u.test(normalized.preferredName))) {
        setStatus('ชื่อมีอักขระที่ไม่รองรับ • ใช้ตัวอักษร ตัวเลข เว้นวรรค หรือจุดได้');
        return false;
      }
      setDisabled(true);
      setStatus('กำลังบันทึกความชอบบนคลาวด์…');
      try {
        const body = { content: JSON.stringify(normalized) };
        const result = memoryId
          ? await call('/api/agent/memory/' + encodeURIComponent(memoryId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          : await call('/api/agent/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'assistant-preference', title: 'Sentinel response preferences', ...body, tags: ['assistant-preference'], source: 'Panthorium Sentinel Preferences', importance: 60 }) });
        if (!isCurrent(owner)) return false;
        if (result.memory?.memoryId) memoryId = String(result.memory.memoryId);
        show(normalized);
        setDisabled(false);
        setStatus('บันทึกความชอบของบัญชีนี้บนคลาวด์แล้ว');
        return true;
      } catch (error) {
        if (isCurrent(owner)) {
          setDisabled(false);
          setStatus(error.httpStatus === 401 ? 'เซสชันหมดอายุ • ลงชื่อเข้าใช้อีกครั้งแล้วลองใหม่' : 'บันทึกไม่สำเร็จ • ตรวจการเชื่อมต่อคลาวด์แล้วลองอีกครั้ง');
        }
        return false;
      }
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      return save({ preferredName: nameField.value, style: styleField.value, language: languageField.value });
    });
    root.querySelector('[data-preferences-reset]').addEventListener('click', () => save(defaults));
    root.querySelector('[data-preferences-refresh]').addEventListener('click', load);
    if (open.authChangedHandler) window.removeEventListener('panthorium:auth-changed', open.authChangedHandler);
    open.authChangedHandler = () => {
      if (!root.isConnected) return;
      clearForm();
      loaded = false;
      setDisabled(true);
      load();
    };
    window.addEventListener('panthorium:auth-changed', open.authChangedHandler);
    await load();
    return true;
  }

  async function refresh() {
    const opened = await open();
    if (!opened) return false;
    document.querySelector(selector)?.querySelector('[data-preferences-refresh]')?.click();
    return true;
  }

  window.PanthoriumAssistantPreferences = { open, refresh };
})();
