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
    return '<div data-calendar-root style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:14px;overflow:auto;color:var(--text);">' +
      '<style>[data-calendar-root] .cal-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}[data-calendar-root] .cal-toolbar button{background:rgba(255,140,45,.12);border:1px solid rgba(255,155,65,.35);color:var(--text);border-radius:9px;padding:8px 12px;cursor:pointer}[data-calendar-grid]{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;flex:none}[data-calendar-grid] .cal-weekday{text-align:center;font-size:12px;padding:5px;color:var(--text-dim)}[data-calendar-day]{min-width:0;min-height:64px;display:flex;flex-direction:column;gap:3px;text-align:left;border:1px solid rgba(160,175,190,.22);border-radius:8px;background:rgba(20,28,40,.6);color:var(--text);padding:6px;cursor:pointer;font:inherit}[data-calendar-day][data-outside]{opacity:.5}[data-calendar-day][aria-current=date]{border-color:#ff9b42}[data-calendar-day][aria-pressed=true]{background:rgba(255,140,45,.2);box-shadow:inset 0 0 0 1px #ff9b42}[data-calendar-day]:focus-visible{outline:2px solid #ffb36c;outline-offset:1px}[data-calendar-day] .cal-event{font-size:10px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#ffc38e}[data-calendar-day] .cal-count{font-size:10px;color:var(--text-dim)}@media(max-width:540px){[data-calendar-day]{min-height:50px;padding:4px}[data-calendar-day] .cal-event{display:none}[data-calendar-grid]{gap:3px}}</style>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span data-calendar-status role="status" aria-live="polite" style="flex:1;color:var(--text-dim);font-size:13px;">กำลังเชื่อมต่อคลาวด์…</span>' +
        '<button type="button" data-calendar-refresh style="border:1px solid rgba(0,255,204,.3);background:rgba(0,255,204,.08);color:var(--text);border-radius:9px;padding:7px 11px;cursor:pointer;">รีเฟรช</button>' +
      '</div>' +
      '<div class="cal-toolbar"><button type="button" data-calendar-prev aria-label="เดือนก่อนหน้า">‹</button><strong data-calendar-month aria-live="polite" style="flex:1;text-align:center;"></strong><button type="button" data-calendar-next aria-label="เดือนถัดไป">›</button><button type="button" data-calendar-today>วันนี้</button></div>' +
      '<div data-calendar-grid role="group" aria-label="ปฏิทินรายเดือน"></div>' +
      '<div data-calendar-zone style="font-size:12px;color:var(--text-dim);"></div>' +
      '<strong data-calendar-selected></strong>' +
      '<section data-calendar-events aria-label="นัดหมายของวันที่เลือก" style="display:grid;gap:8px;"></section>' +
      '<details data-calendar-editor><summary style="cursor:pointer;color:#ffb36c;padding:8px 0;">เพิ่มนัดหมายวันที่เลือก</summary>' +
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
      '</form></details>' +
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
    createWindow('calendar', '📅 ปฏิทิน', markup(), { width: 840, height: 740 });
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
    let selectedDate = localDate(now), month = new Date(now.getFullYear(), now.getMonth(), 1), memories = [], loadSequence = 0;
    const grid = root.querySelector('[data-calendar-grid]');
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    root.querySelector('[data-calendar-zone]').textContent = 'เวลาตามอุปกรณ์: ' + zone;

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

    function chooseDay(date, focus = false) {
      selectedDate = localDate(date); month = new Date(date.getFullYear(), date.getMonth(), 1);
      dateField.value = selectedDate;
      render();
      if (focus) grid.querySelector('[data-calendar-day="' + selectedDate + '"]')?.focus();
    }
    function render() {
      events.replaceChildren(); grid.replaceChildren();
      const all = memories.map(decode).filter(Boolean).sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
      const byDay = new Map();
      for (const entry of all) {
        const day = localDate(new Date(entry.startsAt));
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(entry);
      }
      root.querySelector('[data-calendar-month]').textContent = new Intl.DateTimeFormat('th-TH', { month:'long', year:'numeric' }).format(month);
      root.querySelector('[data-calendar-selected]').textContent = 'นัดหมาย ' + new Intl.DateTimeFormat('th-TH', { dateStyle:'full' }).format(new Date(selectedDate + 'T12:00:00'));
      for (const name of ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']) {
        const label = document.createElement('div'); label.className = 'cal-weekday'; label.textContent = name; grid.appendChild(label);
      }
      const first = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
      for (let i = 0; i < 42; i++) {
        const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
        const key = localDate(date), items = byDay.get(key) || [];
        const button = document.createElement('button'); button.type = 'button'; button.dataset.calendarDay = key;
        button.setAttribute('aria-pressed', String(key === selectedDate));
        button.setAttribute('aria-label', new Intl.DateTimeFormat('th-TH', {dateStyle:'full'}).format(date) + ' • ' + items.length + ' นัดหมาย');
        if (date.getMonth() !== month.getMonth()) button.dataset.outside = 'true';
        if (key === localDate(new Date())) button.setAttribute('aria-current', 'date');
        const number = document.createElement('span'); number.textContent = String(date.getDate()); button.appendChild(number);
        for (const entry of items.slice(0, 1)) {
          const preview = document.createElement('span'); preview.className = 'cal-event'; preview.textContent = localTime(new Date(entry.startsAt)) + ' ' + entry.title; button.appendChild(preview);
        }
        if (items.length) { const count = document.createElement('span'); count.className = 'cal-count'; count.textContent = items.length + ' นัด'; button.appendChild(count); }
        button.addEventListener('click', () => chooseDay(date));
        button.addEventListener('keydown', event => {
          const delta = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
          if (delta) { event.preventDefault(); chooseDay(new Date(date.getFullYear(),date.getMonth(),date.getDate()+delta), true); }
        });
        grid.appendChild(button);
      }
      const entries = byDay.get(selectedDate) || [];
      if (!entries.length) {
        const empty = document.createElement('p');
        empty.textContent = 'ยังไม่มีนัดหมายในวันนี้ • กดเพิ่มนัดหมายวันที่เลือกด้านล่าง';
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
      const owner = currentUserId(), sequence = ++loadSequence;
      if (!registered()) {
        memories = []; render();
        setStatus('ปฏิทินคลาวด์ใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้');
        return false;
      }
      setStatus('กำลังโหลดนัดหมายจากคลาวด์…');
      try {
        const result = await call('/api/agent/memory?kind=calendar-event&limit=100');
        if (!isCurrent(owner) || sequence !== loadSequence) return false;
        memories = Array.isArray(result.memories) ? result.memories : [];
        render();
        setStatus(memories.length >= 100 ? 'แสดงนัดหมายล่าสุดสูงสุด 100 รายการจากคลาวด์' : 'ข้อมูลปฏิทินซิงก์กับบัญชีของคุณบนคลาวด์แล้ว');
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
        chooseDay(localStart);
        timeField.value = localTime(localStart);
        await load();
        setStatus('บันทึกนัดหมายบนคลาวด์แล้ว');
      } catch (error) {
        if (isCurrent(owner)) setStatus(error.httpStatus === 401 ? 'เซสชันบัญชีหมดอายุ • รีเฟรชบัญชีแล้วลองอีกครั้ง' : 'บันทึกนัดหมายไม่สำเร็จ • ตรวจการเชื่อมต่อคลาวด์แล้วลองอีกครั้ง');
      } finally {
        saveButton.disabled = false;
      }
    });
    root.querySelector('[data-calendar-refresh]').addEventListener('click', load);
    root.querySelector('[data-calendar-prev]').addEventListener('click', () => chooseDay(new Date(month.getFullYear(), month.getMonth()-1, 1)));
    root.querySelector('[data-calendar-next]').addEventListener('click', () => chooseDay(new Date(month.getFullYear(), month.getMonth()+1, 1)));
    root.querySelector('[data-calendar-today]').addEventListener('click', () => chooseDay(new Date()));
    dateField.addEventListener('change', () => { const date = new Date(dateField.value + 'T12:00:00'); if (Number.isFinite(date.getTime())) chooseDay(date); });
    if (open.authChangedHandler) window.removeEventListener('panthorium:auth-changed', open.authChangedHandler);
    open.authChangedHandler = () => { if (root.isConnected) { ++loadSequence; memories = []; form.reset(); timeField.value = localTime(new Date()); chooseDay(new Date()); load(); } };
    window.addEventListener('panthorium:auth-changed', open.authChangedHandler);
    render();
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