(function () {
  'use strict';

  const selector = '.window[data-id="calendar"]';
  const api = () => (typeof OS !== 'undefined' ? OS : null);
  const currentUserId = () => {
    const user = api()?.state?.user || {};
    return String(user.sub || user.id || '');
  };
  const registered = () => {
    const user = api()?.state?.user || {};
    const id = currentUserId();
    return !!id && !id.startsWith('guest:') && !(user.roles || []).includes('guest');
  };
  const localDate = date => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  };
  const localTime = date => String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');

  function markup() {
    return '<div data-calendar-root style="height:100%;display:flex;flex-direction:column;gap:12px;padding:14px;overflow:auto;color:var(--text);">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span data-calendar-status role="status" aria-live="polite" style="flex:1;color:var(--text-dim);font-size:13px;">กำลังเชื่อมต่อคลาวด์…</span>' +
        '<button type="button" data-calendar-refresh style="border:1px solid rgba(0,255,204,.3);background:rgba(0,255,204,.08);color:var(--text);border-radius:9px;padding:7px 11px;cursor:pointer;">รีเฟรช</button>' +
      '</div>' +
      '<form data-calendar-form style="display:grid;gap:9px;padding:13px;border:1px solid rgba(0,255,204,.18);border-radius:14px;background:linear-gradient(145deg,rgba(13,42,62,.58),rgba(17,25,42,.76));">' +
        '<label style="display:grid;gap:5px;font-size:13px;">หัวข้อนัดหมาย' +
          '<input data-calendar-title required maxlength="240" autocomplete="off" placeholder="เช่น นัดแพทย์" style="box-sizing:border-box;width:100%;padding:10px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;">' +
        '</label>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;">' +
          '<label style="display:grid;gap:5px;font-size:13px;">วันที่<input data-calendar-date type="date" required style="box-sizing:border-box;width:100%;padding:9px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></label>' +
          '<label style="display:grid;gap:5px;font-size:13px;">เวลา<input data-calendar-time type="time" required style="box-sizing:border-box;width:100%;padding:9px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></label>' +
        '</div>' +
        '<label style="display:grid;gap:5px;font-size:13px;">รายละเอียด<textarea data-calendar-description maxlength="3000" rows="2" placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)" style="box-sizing:border-box;width:100%;resize:vertical;padding:9px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></textarea></label>' +
        '<button data-calendar-save type="submit" style="justify-self:start;border:1px solid rgba(0,255,204,.45);background:linear-gradient(120deg,rgba(0,255,204,.2),rgba(21,157,255,.18));color:var(--text);border-radius:10px;padding:9px 15px;font:inherit;cursor:pointer;">บันทึกนัดหมายบนคลาวด์</button>' +
      '</form>' +
      '<section data-calendar-events aria-label="นัดหมายที่บันทึกบนคลาวด์" style="display:grid;gap:8px;"></section>' +
    '</div>';
  }

  function decode(item) {
    try {
      const value = JSON.parse(String(item.content || ''));
      if (value?.version !== 1 || typeof value.startsAt !== 'string' || !Number.isFinite(Date.parse(value.startsAt))) return null;
      return { memoryId: String(item.memoryId || ''), title: String(item.title || ''), startsAt: value.startsAt, timeZone: String(value.timeZone || ''), description: String(value.description || '') };
    } catch (_) { return null; }
  }

  async function open() {
    const os = api();
    if (!os || typeof createWindow !== 'function') return false;
    if (os.windows.has('calendar')) { focusWindow('calendar'); return true; }
    createWindow('calendar', '📅 Calendar', markup(), { width: 560, height: 580 });
    const win = document.querySelector(selector);
    const root = win?.querySelector('[data-calendar-root]');
    if (!root) return false;
    const status = root.querySelector('[data-calendar-status]');
    const form = root.querySelector('[data-calendar-form]');
    const titleField = root.querySelector('[data-calendar-title]');
    const dateField = root.querySelector('[data-calendar-date]');
    const timeField = root.querySelector('[data-calendar-time]');
    const descriptionField = root.querySelector('[data-calendar-description]');
    const saveButton = root.querySelector('[data-calendar-save]');
    const events = root.querySelector('[data-calendar-events]');
    const now = new Date();
    dateField.value = localDate(now);
    timeField.value = localTime(now);

    const setStatus = message => { if (root.isConnected) status.textContent = message; };
    const isCurrent = owner => root.isConnected && owner === currentUserId();
    async function call(path, options) {
      const base = String(api()?.config?.backendUrl || '').replace(/\/$/, '');
      if (!base || typeof authorizedFetch !== 'function') throw new Error('cloud_unavailable');
      const response = await authorizedFetch(base + path, { signal: AbortSignal.timeout(10000), ...(options || {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const error = new Error(data.error || 'cloud_request_failed');
        error.httpStatus = response.status;
        throw error;
      }
      return data;
    }

    function render(memories) {
      events.replaceChildren();
      const entries = (Array.isArray(memories) ? memories : []).map(decode).filter(Boolean);
      entries.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      if (!entries.length) {
        const empty = document.createElement('p');
        empty.textContent = 'ยังไม่มีนัดหมายที่บันทึกบนคลาวด์';
        empty.style.cssText = 'margin:4px 0;color:var(--text-dim);font-size:13px;';
        events.appendChild(empty);
        return;
      }
      for (const entry of entries) {
        const card = document.createElement('article');
        card.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;padding:11px;border:1px solid rgba(102,178,220,.2);border-radius:12px;background:rgba(11,23,40,.62);';
        const details = document.createElement('div');
        const heading = document.createElement('strong');
        heading.textContent = entry.title;
        heading.style.cssText = 'display:block;overflow-wrap:anywhere;';
        const when = document.createElement('time');
        when.dateTime = entry.startsAt;
        when.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.startsAt));
        when.style.cssText = 'display:block;margin-top:4px;color:#84d9ff;font-size:12px;';
        details.append(heading, when);
        if (entry.description) {
          const description = document.createElement('p');
          description.textContent = entry.description;
          description.style.cssText = 'margin:6px 0 0;color:var(--text-dim);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;';
          details.appendChild(description);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.delete = entry.memoryId;
        remove.textContent = 'ลบ';
        remove.setAttribute('aria-label', 'ลบนัดหมาย ' + entry.title);
        remove.style.cssText = 'border:1px solid rgba(255,120,140,.3);background:rgba(255,80,110,.08);color:var(--text);border-radius:8px;padding:6px 9px;cursor:pointer;';
        remove.addEventListener('click', async () => {
          if (!window.confirm('ลบนัดหมายนี้จากคลาวด์หรือไม่?')) return;
          remove.disabled = true;
          try {
            await call('/api/agent/memory/' + encodeURIComponent(entry.memoryId), { method: 'DELETE' });
            await load();
            setStatus('ลบนัดหมายจากคลาวด์แล้ว');
          } catch (error) {
            setStatus(error.httpStatus === 401 ? 'เซสชันบัญชีหมดอายุ • รีเฟรชบัญชีแล้วลองอีกครั้ง' : 'ลบนัดหมายไม่สำเร็จ • ตรวจการเชื่อมต่อคลาวด์แล้วลองอีกครั้ง');
            remove.disabled = false;
          }
        });
        card.append(details, remove);
        events.appendChild(card);
      }
    }

    async function load() {
      if (!root.isConnected) return false;
      const owner = currentUserId();
      if (!registered()) {
        events.replaceChildren();
        setStatus('ปฏิทินคลาวด์ใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้');
        return false;
      }
      setStatus('กำลังโหลดนัดหมายจากคลาวด์…');
      try {
        const result = await call('/api/agent/memory?kind=calendar-event&limit=100');
        if (!isCurrent(owner)) return false;
        render(result.memories);
        setStatus('ข้อมูลปฏิทินซิงก์กับบัญชีของคุณบนคลาวด์แล้ว');
        return true;
      } catch (error) {
        if (!isCurrent(owner)) return false;
        setStatus(error.httpStatus === 401 ? 'เซสชันบัญชีหมดอายุ • รีเฟรชบัญชีแล้วลองอีกครั้ง' : error.httpStatus === 403 ? 'บัญชีนี้ไม่มีสิทธิ์อ่านปฏิทินบนคลาวด์' : 'เชื่อมต่อคลาวด์เพื่อโหลดนัดหมายไม่ได้ • แตะรีเฟรชเพื่อลองอีกครั้ง');
        return false;
      }
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!registered()) { setStatus('ปฏิทินคลาวด์ใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้'); return; }
      const title = titleField.value.trim();
      const localStart = dateField.value && timeField.value ? new Date(dateField.value + 'T' + timeField.value) : null;
      if (!title || !localStart || !Number.isFinite(localStart.getTime())) {
        setStatus('กรุณากรอกหัวข้อ วันที่ และเวลาให้ครบ');
        return;
      }
      const owner = currentUserId();
      saveButton.disabled = true;
      setStatus('กำลังบันทึกนัดหมายลงคลาวด์…');
      try {
        await call('/api/agent/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'calendar-event',
            title,
            content: JSON.stringify({ version: 1, startsAt: localStart.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', description: descriptionField.value.trim() }),
            tags: ['calendar'],
            source: 'Panthorium Calendar',
            importance: 50
          })
        });
        if (!isCurrent(owner)) return;
        form.reset();
        const next = new Date();
        dateField.value = localDate(next);
        timeField.value = localTime(next);
        await load();
        setStatus('บันทึกนัดหมายบนคลาวด์แล้ว');
      } catch (error) {
        if (isCurrent(owner)) setStatus(error.httpStatus === 401 ? 'เซสชันบัญชีหมดอายุ • รีเฟรชบัญชีแล้วลองอีกครั้ง' : 'บันทึกนัดหมายไม่สำเร็จ • ตรวจการเชื่อมต่อคลาวด์แล้วลองอีกครั้ง');
      } finally {
        saveButton.disabled = false;
      }
    });
    root.querySelector('[data-calendar-refresh]').addEventListener('click', load);
    if (open.authChangedHandler) window.removeEventListener('panthorium:auth-changed', open.authChangedHandler);
    open.authChangedHandler = () => { if (root.isConnected) load(); };
    window.addEventListener('panthorium:auth-changed', open.authChangedHandler);
    await load();
    return true;
  }

  async function refresh() {
    const result = await open();
    if (!result) return false;
    document.querySelector(selector)?.querySelector('[data-calendar-refresh]')?.click();
    return true;
  }

  window.PanthoriumCalendar = { open, refresh };
})();