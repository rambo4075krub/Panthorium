(function () {
  'use strict';
  const selector = '.window[data-id="reminders"]';
  const api = () => typeof OS !== 'undefined' ? OS : null;
  const accountId = () => String(api()?.state?.user?.sub || api()?.state?.user?.id || '');
  const registered = () => {
    const user = api()?.state?.user || {};
    return !!accountId() && !accountId().startsWith('guest:') && !(user.roles || []).includes('guest');
  };
  const localInputValue = date => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,16);
  };
  const statusLabel = value => ({ scheduled: 'รอส่ง', sending: 'กำลังส่ง', sent: 'ส่งแล้ว', failed: 'ส่งไม่สำเร็จ', cancelled: 'ยกเลิกแล้ว' }[value] || 'สถานะไม่ทราบ');

  function markup() {
    return '<div data-reminders-root style="height:100%;display:flex;flex-direction:column;gap:12px;padding:14px;overflow:auto;color:var(--text);">' +
      '<div style="display:flex;align-items:center;gap:8px;"><span data-reminders-status role="status" aria-live="polite" style="flex:1;color:var(--text-dim);font-size:13px;">กำลังเชื่อมต่อคลาวด์…</span>' +
      '<button data-reminders-refresh type="button" style="border:1px solid rgba(0,255,204,.3);background:rgba(0,255,204,.08);color:var(--text);border-radius:9px;padding:7px 11px;cursor:pointer;">รีเฟรช</button></div>' +
      '<form data-reminders-form style="display:grid;gap:9px;padding:13px;border:1px solid rgba(0,255,204,.18);border-radius:14px;background:linear-gradient(145deg,rgba(13,42,62,.58),rgba(17,25,42,.76));">' +
        '<label style="display:grid;gap:5px;font-size:13px;">ประเภทการเตือน<select data-reminders-kind style="padding:9px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"><option value="appointment">นัดหมาย</option><option value="medication">ทานยา</option></select></label>' +
        '<label style="display:grid;gap:5px;font-size:13px;">หัวข้อ<input data-reminders-title required maxlength="240" autocomplete="off" placeholder="เช่น นัดแพทย์ / ทานยาหลังอาหาร" style="box-sizing:border-box;width:100%;padding:10px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></label>' +
        '<label style="display:grid;gap:5px;font-size:13px;">วันและเวลา<input data-reminders-time type="datetime-local" required style="box-sizing:border-box;width:100%;padding:9px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></label>' +
        '<label style="display:grid;gap:5px;font-size:13px;">รายละเอียด<textarea data-reminders-details maxlength="1000" rows="2" placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)" style="box-sizing:border-box;width:100%;resize:vertical;padding:9px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></textarea></label>' +
        '<label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text-dim);"><input data-reminders-consent type="checkbox" required style="margin-top:2px;"><span>ยินยอมให้ส่งรายละเอียดการเตือนนี้ไปยังอีเมลที่ยืนยันกับบัญชี เพื่อรับแจ้งเตือนแม้ปิดแอป</span></label>' +
        '<button data-reminders-save type="submit" style="justify-self:start;border:1px solid rgba(0,255,204,.45);background:linear-gradient(120deg,rgba(0,255,204,.2),rgba(21,157,255,.18));color:var(--text);border-radius:10px;padding:9px 15px;font:inherit;cursor:pointer;">บันทึกและตั้งเตือน</button>' +
      '</form><section data-reminders-list aria-label="รายการเตือนจากคลาวด์" style="display:grid;gap:8px;"></section>' +
      '<small style="color:var(--text-dim);font-size:11px;line-height:1.5;">การเตือนรุ่นนี้ส่งทางอีเมลที่ยืนยันแล้ว • ตั้งได้ครั้งเดียว • ไม่มีการเปลี่ยนขนาดหรือรูปลูก Orb</small></div>';
  }

  async function open() {
    const os = api();
    if (!os || typeof createWindow !== 'function') return false;
    if (os.windows.has('reminders')) { focusWindow('reminders'); return true; }
    createWindow('reminders', '⏰ Reminders', markup(), { width: 560, height: 600 });
    const win = document.querySelector(selector);
    const root = win?.querySelector('[data-reminders-root]');
    if (!root) return false;
    const status = root.querySelector('[data-reminders-status]');
    const form = root.querySelector('[data-reminders-form]');
    const save = root.querySelector('[data-reminders-save]');
    save.disabled = true;
    const dateField = root.querySelector('[data-reminders-time]');
    const list = root.querySelector('[data-reminders-list]');
    dateField.value = localInputValue(new Date(Date.now() + 60 * 60 * 1000));
    const setStatus = text => { if (root.isConnected) status.textContent = text; };
    const isCurrent = owner => root.isConnected && owner === accountId();

    async function call(path, options) {
      const base = String(api()?.config?.backendUrl || '').replace(/\/$/, '');
      if (!base || typeof authorizedFetch !== 'function') throw new Error('cloud_unavailable');
      const response = await authorizedFetch(base + path, { signal: AbortSignal.timeout(12000), ...(options || {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const error = new Error(data.error || 'reminder_request_failed');
        error.httpStatus = response.status;
        throw error;
      }
      return data;
    }

    function render(items) {
      list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('p');
        empty.textContent = 'ยังไม่มีการเตือนในบัญชีคลาวด์นี้';
        empty.style.cssText = 'margin:4px 0;color:var(--text-dim);font-size:13px;';
        list.appendChild(empty);
        return;
      }
      for (const item of items) {
        const card = document.createElement('article');
        card.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;padding:11px;border:1px solid rgba(102,178,220,.2);border-radius:12px;background:rgba(11,23,40,.62);';
        const details = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = (item.kind === 'medication' ? '💊 ' : '📅 ') + item.title;
        title.style.cssText = 'display:block;overflow-wrap:anywhere;';
        const when = document.createElement('time');
        when.dateTime = item.dueAt;
        when.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.dueAt));
        when.style.cssText = 'display:block;margin-top:4px;color:#84d9ff;font-size:12px;';
        const state = document.createElement('span');
        state.textContent = statusLabel(item.status);
        state.style.cssText = 'display:inline-block;margin-top:4px;color:var(--text-dim);font-size:11px;';
        details.append(title, when, state);
        if (item.details) {
          const note = document.createElement('p');
          note.textContent = item.details;
          note.style.cssText = 'margin:6px 0 0;color:var(--text-dim);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;';
          details.appendChild(note);
        }
        card.appendChild(details);
        if (item.status === 'scheduled') {
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.textContent = 'ยกเลิก';
          cancel.setAttribute('aria-label', 'ยกเลิกการเตือน ' + item.title);
          cancel.style.cssText = 'border:1px solid rgba(255,120,140,.3);background:rgba(255,80,110,.08);color:var(--text);border-radius:8px;padding:6px 9px;cursor:pointer;';
          cancel.addEventListener('click', async () => {
            if (!window.confirm('ยกเลิกการเตือนนี้หรือไม่?')) return;
            cancel.disabled = true;
            try { await call('/api/reminders/' + encodeURIComponent(item.reminderId), { method: 'DELETE' }); await load(); }
            catch (_) { setStatus('ยกเลิกการเตือนไม่สำเร็จ • แตะรีเฟรชเพื่อตรวจสอบ'); cancel.disabled = false; }
          });
          card.appendChild(cancel);
        }
        list.appendChild(card);
      }
    }

    async function load() {
      if (!root.isConnected) return false;
      if (!registered()) { setStatus('การเตือนบนคลาวด์ใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้'); return false; }
      const owner = accountId();
      setStatus('กำลังโหลดรายการเตือนจากคลาวด์…');
      try {
        const result = await call('/api/reminders?limit=50');
        if (!isCurrent(owner)) return false;
        render(Array.isArray(result.reminders) ? result.reminders : []);
        save.disabled = !result.deliveryAvailable;
        setStatus(result.deliveryAvailable ? 'รายการแยกตามบัญชี • ส่งอีเมลเมื่อถึงเวลา' : 'เซิร์ฟเวอร์ยังไม่พร้อมส่งอีเมลเตือน • ยังไม่บันทึกรายการ');
        return true;
      } catch (error) {
        if (!isCurrent(owner)) return false;
        setStatus(error.httpStatus === 401 ? 'เซสชันหมดอายุ • รีเฟรชบัญชีแล้วลองอีกครั้ง' : 'โหลดรายการเตือนจากคลาวด์ไม่ได้ • แตะรีเฟรชเพื่อลองอีกครั้ง');
        return false;
      }
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!registered()) { setStatus('การเตือนบนคลาวด์ใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้'); return; }
      const localTime = new Date(dateField.value);
      if (!Number.isFinite(localTime.getTime())) { setStatus('กรุณากำหนดวันและเวลาให้ถูกต้อง'); return; }
      const owner = accountId();
      save.disabled = true;
      setStatus('กำลังบันทึกการเตือนลงคลาวด์…');
      const body = {
        kind: root.querySelector('[data-reminders-kind]').value,
        title: root.querySelector('[data-reminders-title]').value.trim(),
        details: root.querySelector('[data-reminders-details]').value.trim(),
        dueAt: localTime.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        emailConsent: root.querySelector('[data-reminders-consent]').checked
      };
      try {
        await call('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!isCurrent(owner)) return;
        form.reset();
        dateField.value = localInputValue(new Date(Date.now() + 60 * 60 * 1000));
        await load();
        setStatus('บันทึกการเตือนแล้ว • จะส่งอีเมลเมื่อถึงเวลา');
      } catch (error) {
        if (!isCurrent(owner)) return;
        const messages = {
          verified_email_required: 'บัญชีนี้ยังไม่มีอีเมลที่ยืนยันแล้ว • ไม่ได้สร้างการเตือน',
          reminder_email_consent_required: 'กรุณายินยอมการส่งอีเมลก่อนบันทึกการเตือน',
          reminder_email_unavailable: 'ระบบส่งอีเมลยังไม่พร้อม • ไม่ได้สร้างการเตือน',
          reminder_time_must_be_future: 'เวลาที่เลือกผ่านไปแล้วหรือใกล้เกินไป • เลือกเวลาในอนาคต',
          reminder_time_too_far: 'ตั้งการเตือนได้ไม่เกินหนึ่งปี'
        };
        setStatus(messages[error.message] || 'บันทึกการเตือนไม่สำเร็จ • ไม่ได้สร้างการเตือน');
        save.disabled = false;
      }
    });
    root.querySelector('[data-reminders-refresh]').addEventListener('click', load);
    if (open.authChangedHandler) window.removeEventListener('panthorium:auth-changed', open.authChangedHandler);
    open.authChangedHandler = () => { if (root.isConnected) load(); };
    window.addEventListener('panthorium:auth-changed', open.authChangedHandler);
    await load();
    return true;
  }

  async function refresh() {
    const ok = await open();
    if (!ok) return false;
    document.querySelector(selector)?.querySelector('[data-reminders-refresh]')?.click();
    return true;
  }
  window.PanthoriumReminders = { open, refresh };
})();