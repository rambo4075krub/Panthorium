(function () {
  'use strict';

  const selector = '.window[data-id="goals"]';
  const api = () => typeof OS !== 'undefined' ? OS : null;
  const accountId = () => String(api()?.state?.user?.sub || api()?.state?.user?.id || '');
  const registered = () => {
    const user = api()?.state?.user || {};
    return !!accountId()
      && !accountId().startsWith('guest:')
      && !(user.roles || []).includes('guest')
      && (user.permissions || []).includes('chat');
  };

  function markup() {
    return '<div data-goals-root style="height:100%;display:flex;flex-direction:column;gap:12px;padding:14px;overflow:auto;color:var(--text);">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span data-goals-status role="status" aria-live="polite" style="flex:1;color:var(--text-dim);font-size:13px;">กำลังเชื่อมต่อคลาวด์…</span>' +
        '<button type="button" data-goals-refresh style="border:1px solid rgba(0,255,204,.3);background:rgba(0,255,204,.08);color:var(--text);border-radius:9px;padding:7px 11px;cursor:pointer;">รีเฟรช</button>' +
      '</div>' +
      '<form data-goals-form style="display:grid;gap:9px;padding:13px;border:1px solid rgba(0,255,204,.18);border-radius:14px;background:linear-gradient(145deg,rgba(13,42,62,.58),rgba(17,25,42,.76));">' +
        '<strong>ตั้งเป้าหมายใหม่</strong>' +
        '<label style="display:grid;gap:5px;font-size:13px;">เป้าหมาย<input data-goals-title required maxlength="240" autocomplete="off" placeholder="เช่น ฝึกภาษาอังกฤษให้ครบ 30 ชั่วโมง" style="box-sizing:border-box;width:100%;padding:10px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></label>' +
        '<label style="display:grid;gap:5px;font-size:13px;">กำหนดเสร็จ (ไม่บังคับ)<input data-goals-date type="date" style="box-sizing:border-box;width:100%;padding:9px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></label>' +
        '<label style="display:grid;gap:5px;font-size:13px;">รายละเอียด<textarea data-goals-description maxlength="3000" rows="2" placeholder="ทำไมเป้าหมายนี้สำคัญ หรือมีขั้นตอนใดบ้าง" style="box-sizing:border-box;width:100%;resize:vertical;padding:9px;border-radius:9px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;"></textarea></label>' +
        '<button data-goals-save type="submit" style="justify-self:start;border:1px solid rgba(0,255,204,.45);background:linear-gradient(120deg,rgba(0,255,204,.2),rgba(21,157,255,.18));color:var(--text);border-radius:10px;padding:9px 15px;font:inherit;cursor:pointer;">บันทึกเป้าหมายบนคลาวด์</button>' +
      '</form>' +
      '<section data-goals-list aria-label="เป้าหมายที่บันทึกบนคลาวด์" style="display:grid;gap:8px;"></section>' +
      '<small style="color:var(--text-dim);font-size:11px;line-height:1.5;">เป้าหมายและความคืบหน้าซิงก์กับบัญชีของคุณบนคลาวด์ และใช้ได้จากอุปกรณ์ที่ลงชื่อเข้าใช้</small>' +
    '</div>';
  }

  function decode(item) {
    try {
      const value = JSON.parse(String(item.content || ''));
      if (value?.version !== 1 || !item.memoryId || !item.title) return null;
      const progress = Number(value.progress);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) return null;
      if (!['active', 'paused', 'completed'].includes(value.status)) return null;
      if (value.targetDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(value.targetDate))) return null;
      return {
        memoryId: String(item.memoryId),
        title: String(item.title),
        description: String(value.description || ''),
        progressNote: String(value.progressNote || ''),
        targetDate: value.targetDate || '',
        progress,
        status: value.status,
        tags: Array.isArray(item.tags) ? item.tags : ['goal']
      };
    } catch (_) { return null; }
  }

  function encode(goal) {
    return JSON.stringify({
      version: 1,
      status: goal.status,
      progress: goal.progress,
      targetDate: goal.targetDate || null,
      description: goal.description || '',
      progressNote: goal.progressNote || ''
    });
  }

  async function open() {
    const os = api();
    if (!os || typeof createWindow !== 'function') return false;
    if (!registered()) return false;
    if (os.windows.has('goals')) { focusWindow('goals'); return true; }
    createWindow('goals', '🎯 เป้าหมาย', markup(), { width: 560, height: 640 });
    const win = document.querySelector(selector);
    const root = win?.querySelector('[data-goals-root]');
    if (!root) return false;

    const status = root.querySelector('[data-goals-status]');
    const form = root.querySelector('[data-goals-form]');
    const titleField = root.querySelector('[data-goals-title]');
    const dateField = root.querySelector('[data-goals-date]');
    const descriptionField = root.querySelector('[data-goals-description]');
    const saveButton = root.querySelector('[data-goals-save]');
    const list = root.querySelector('[data-goals-list]');
    const setStatus = message => { if (root.isConnected) status.textContent = message; };
    const isCurrent = owner => root.isConnected && owner === accountId();

    async function call(path, options) {
      const base = String(api()?.config?.backendUrl || '').replace(/\/$/, '');
      if (!base || typeof authorizedFetch !== 'function') throw new Error('cloud_unavailable');
      const response = await authorizedFetch(base + path, { signal: AbortSignal.timeout(12000), ...(options || {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const error = new Error(data.error || 'goal_request_failed');
        error.httpStatus = response.status;
        throw error;
      }
      return data;
    }

    function render(memories) {
      list.replaceChildren();
      const goals = (Array.isArray(memories) ? memories : []).map(decode).filter(Boolean);
      goals.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'completed' ? 1 : b.status === 'completed' ? -1 : 0;
        if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
        return a.targetDate ? -1 : b.targetDate ? 1 : a.title.localeCompare(b.title, 'th');
      });
      if (!goals.length) {
        const empty = document.createElement('p');
        empty.textContent = 'ยังไม่มีเป้าหมายที่บันทึกบนคลาวด์';
        empty.style.cssText = 'margin:4px 0;color:var(--text-dim);font-size:13px;';
        list.appendChild(empty);
        return;
      }

      for (const goal of goals) {
        const card = document.createElement('article');
        card.style.cssText = 'display:grid;gap:9px;padding:12px;border:1px solid rgba(102,178,220,.2);border-radius:12px;background:rgba(11,23,40,.62);';
        const heading = document.createElement('strong');
        heading.textContent = goal.title;
        heading.style.cssText = 'overflow-wrap:anywhere;';
        card.appendChild(heading);
        const progressTrack = document.createElement('div');
        progressTrack.setAttribute('role', 'progressbar');
        progressTrack.setAttribute('aria-label', 'ความคืบหน้า ' + goal.title);
        progressTrack.setAttribute('aria-valuemin', '0');
        progressTrack.setAttribute('aria-valuemax', '100');
        progressTrack.setAttribute('aria-valuenow', String(goal.progress));
        progressTrack.style.cssText = 'height:8px;border-radius:999px;background:rgba(151,190,216,.15);overflow:hidden;';
        const progressFill = document.createElement('span');
        progressFill.style.cssText = `display:block;height:100%;width:${goal.progress}%;background:linear-gradient(90deg,#00bfa5,#66f0d0);`;
        progressTrack.appendChild(progressFill);
        card.appendChild(progressTrack);
        if (goal.description) {
          const description = document.createElement('p');
          description.textContent = goal.description;
          description.style.cssText = 'margin:0;color:var(--text-dim);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;';
          card.appendChild(description);
        }

        const edit = document.createElement('form');
        edit.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
        const progressLabel = document.createElement('label');
        progressLabel.textContent = 'ความคืบหน้า (%)';
        progressLabel.style.cssText = 'display:grid;gap:4px;font-size:12px;';
        const progress = document.createElement('input');
        progress.type = 'number'; progress.min = '0'; progress.max = '100'; progress.step = '1'; progress.value = String(goal.progress); progress.required = true;
        progress.dataset.progress = '';
        progress.setAttribute('aria-label', 'ความคืบหน้าของ ' + goal.title);
        progress.style.cssText = 'box-sizing:border-box;width:100%;padding:8px;border-radius:8px;border:1px solid rgba(151,190,216,.25);background:rgba(3,10,21,.65);color:var(--text);font:inherit;';
        progressLabel.appendChild(progress);
        const dueLabel = document.createElement('label');
        dueLabel.textContent = 'กำหนดเสร็จ';
        dueLabel.style.cssText = 'display:grid;gap:4px;font-size:12px;';
        const due = document.createElement('input');
        due.type = 'date'; due.value = goal.targetDate; due.dataset.due = '';
        due.setAttribute('aria-label', 'กำหนดเสร็จของ ' + goal.title);
        due.style.cssText = progress.style.cssText;
        dueLabel.appendChild(due);
        const stateLabel = document.createElement('label');
        stateLabel.textContent = 'สถานะ';
        stateLabel.style.cssText = 'display:grid;gap:4px;font-size:12px;';
        const state = document.createElement('select');
        state.dataset.status = '';
        for (const [value, label] of [['active', 'กำลังทำ'], ['paused', 'พักไว้'], ['completed', 'เสร็จแล้ว']]) {
          const option = document.createElement('option'); option.value = value; option.textContent = label; state.appendChild(option);
        }
        state.value = goal.status;
        state.setAttribute('aria-label', 'สถานะของ ' + goal.title);
        state.style.cssText = progress.style.cssText;
        stateLabel.appendChild(state);
        const noteLabel = document.createElement('label');
        noteLabel.textContent = 'บันทึกความคืบหน้าล่าสุด';
        noteLabel.style.cssText = 'grid-column:1 / -1;display:grid;gap:4px;font-size:12px;';
        const note = document.createElement('input');
        note.type = 'text'; note.maxLength = 1000; note.value = goal.progressNote; note.dataset.note = '';
        note.setAttribute('aria-label', 'บันทึกความคืบหน้าของ ' + goal.title);
        note.style.cssText = progress.style.cssText;
        noteLabel.appendChild(note);
        const actions = document.createElement('div');
        actions.style.cssText = 'grid-column:1 / -1;display:flex;gap:8px;flex-wrap:wrap;';
        const update = document.createElement('button');
        update.type = 'submit'; update.textContent = 'บันทึกความคืบหน้า';
        update.style.cssText = 'border:1px solid rgba(0,255,204,.4);background:rgba(0,255,204,.1);color:var(--text);border-radius:8px;padding:8px 11px;cursor:pointer;';
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = 'ลบเป้าหมาย'; remove.dataset.delete = '';
        remove.style.cssText = 'border:1px solid rgba(255,120,140,.3);background:rgba(255,80,110,.08);color:var(--text);border-radius:8px;padding:8px 11px;cursor:pointer;';
        actions.append(update, remove);
        edit.append(progressLabel, dueLabel, stateLabel, noteLabel, actions);
        card.appendChild(edit);

        edit.addEventListener('submit', async event => {
          event.preventDefault();
          const amount = Number(progress.value);
          if (!Number.isInteger(amount) || amount < 0 || amount > 100) { setStatus('กรอกความคืบหน้าเป็นจำนวนเต็ม 0–100'); return; }
          const updated = { ...goal, progress: state.value === 'completed' ? 100 : amount, targetDate: due.value || '', status: state.value, progressNote: note.value.trim() };
          update.disabled = true;
          setStatus('กำลังบันทึกความคืบหน้าลงคลาวด์…');
          const owner = accountId();
          try {
            await call('/api/agent/memory/' + encodeURIComponent(goal.memoryId), {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: encode(updated) })
            });
            if (!isCurrent(owner)) return;
            await load();
            setStatus('บันทึกความคืบหน้าแล้ว');
          } catch (error) {
            if (isCurrent(owner)) setStatus(error.httpStatus === 401 ? 'เซสชันบัญชีหมดอายุ • รีเฟรชบัญชีแล้วลองอีกครั้ง' : 'บันทึกความคืบหน้าไม่สำเร็จ • ตรวจการเชื่อมต่อคลาวด์แล้วลองอีกครั้ง');
          } finally { update.disabled = false; }
        });

        async function deleteGoal() {
          remove.disabled = true;
          const owner = accountId();
          setStatus('กำลังลบเป้าหมายจากคลาวด์…');
          try {
            await call('/api/agent/memory/' + encodeURIComponent(goal.memoryId), { method: 'DELETE' });
            if (!isCurrent(owner)) return;
            await load();
            setStatus('ลบเป้าหมายจากคลาวด์แล้ว');
          } catch (_) {
            if (isCurrent(owner)) setStatus('ลบเป้าหมายไม่สำเร็จ • ตรวจการเชื่อมต่อคลาวด์แล้วลองอีกครั้ง');
            remove.disabled = false;
          }
        }
        remove.addEventListener('click', async () => {
          if (remove.dataset.confirm === '1') { await deleteGoal(); return; }
          remove.dataset.confirm = '1';
          remove.textContent = 'ยืนยันลบ';
          const cancel = document.createElement('button');
          cancel.type = 'button'; cancel.textContent = 'ยกเลิก'; cancel.dataset.cancelDelete = '';
          cancel.style.cssText = 'border:1px solid rgba(151,190,216,.25);background:transparent;color:var(--text);border-radius:8px;padding:8px 11px;cursor:pointer;';
          actions.appendChild(cancel);
          setStatus('กดยืนยันลบอีกครั้ง หรือกดยกเลิก');
          cancel.addEventListener('click', () => { remove.dataset.confirm = '0'; remove.textContent = 'ลบเป้าหมาย'; cancel.remove(); setStatus('ยกเลิกการลบแล้ว'); });
        });
        list.appendChild(card);
      }
    }

    async function load() {
      if (!root.isConnected) return false;
      const owner = accountId();
      if (!registered()) {
        list.replaceChildren();
        setStatus('เป้าหมายบนคลาวด์ใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้');
        return false;
      }
      setStatus('กำลังโหลดเป้าหมายจากคลาวด์…');
      try {
        const result = await call('/api/agent/memory?kind=goal&limit=100');
        if (!isCurrent(owner)) return false;
        render(result.memories);
        setStatus('เป้าหมายซิงก์กับบัญชีของคุณบนคลาวด์แล้ว');
        return true;
      } catch (error) {
        if (!isCurrent(owner)) return false;
        setStatus(error.httpStatus === 401 ? 'เซสชันบัญชีหมดอายุ • รีเฟรชบัญชีแล้วลองอีกครั้ง' : error.httpStatus === 403 ? 'บัญชีนี้ไม่มีสิทธิ์ใช้เป้าหมายบนคลาวด์' : 'เชื่อมต่อคลาวด์เพื่อโหลดเป้าหมายไม่ได้ • แตะรีเฟรชเพื่อลองอีกครั้ง');
        return false;
      }
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!registered()) { setStatus('เป้าหมายบนคลาวด์ใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้'); return; }
      const title = titleField.value.trim();
      if (!title) { setStatus('กรุณากรอกชื่อเป้าหมาย'); return; }
      const owner = accountId();
      saveButton.disabled = true;
      setStatus('กำลังบันทึกเป้าหมายลงคลาวด์…');
      try {
        await call('/api/agent/memory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'goal', title,
            content: encode({ version: 1, status: 'active', progress: 0, targetDate: dateField.value || '', description: descriptionField.value.trim(), progressNote: '' }),
            tags: ['goal'], source: 'Panthorium Goals', importance: 70
          })
        });
        if (!isCurrent(owner)) return;
        form.reset();
        await load();
        setStatus('บันทึกเป้าหมายบนคลาวด์แล้ว');
      } catch (error) {
        if (isCurrent(owner)) setStatus(error.httpStatus === 401 ? 'เซสชันบัญชีหมดอายุ • รีเฟรชบัญชีแล้วลองอีกครั้ง' : 'บันทึกเป้าหมายไม่สำเร็จ • ตรวจการเชื่อมต่อคลาวด์แล้วลองอีกครั้ง');
      } finally { saveButton.disabled = false; }
    });

    root.querySelector('[data-goals-refresh]').addEventListener('click', load);
    if (open.authChangedHandler) window.removeEventListener('panthorium:auth-changed', open.authChangedHandler);
    open.authChangedHandler = () => {
      if (!root.isConnected) return;
      // Clear the previous account's visible goals before the next account's
      // cloud request starts; never leave private data on screen during a swap.
      list.replaceChildren();
      if (!registered()) { setStatus('เป้าหมายบนคลาวด์ใช้ได้กับบัญชีผู้ใช้ที่ลงชื่อเข้าใช้'); return; }
      load();
    };
    window.addEventListener('panthorium:auth-changed', open.authChangedHandler);
    await load();
    return true;
  }

  async function refresh() {
    const opened = await open();
    if (!opened) return false;
    document.querySelector(selector)?.querySelector('[data-goals-refresh]')?.click();
    return true;
  }

  window.PanthoriumGoals = { open, refresh };
})();
