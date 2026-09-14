(function () {
  'use strict';
  const catalog = window.PanthoriumWindowCatalog;
  if (!catalog) return;
  const system = () => typeof OS !== 'undefined' ? OS : null;
  const identity = () => JSON.stringify([system()?.state?.user?.id, system()?.state?.user?.roles, system()?.state?.user?.permissions]);
  let lastIdentity = identity();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pending = null;
  let busy = false;
  const applied = new Map();
  const errors = {
    voice_action_permission_denied: 'บัญชีนี้ไม่มีสิทธิ์ใช้ฟังก์ชันนี้',
    voice_command_permission_denied: 'บัญชีนี้ไม่มีสิทธิ์ดำเนินคำสั่งนี้',
    tool_permission_denied: 'บัญชีนี้ไม่มีสิทธิ์ดำเนินคำสั่งนี้',
    authentication_required: 'กรุณาเข้าสู่ระบบก่อนสั่งงาน',
    invalid_or_expired_token: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
    voice_command_negated: 'รับทราบ ยังไม่ดำเนินการ',
    ambiguous_voice_command: 'กรุณาระบุว่าจะเปิด ปิด หรือรีเฟรชหน้าต่างใดทีละคำสั่ง',
    module_unavailable: 'โมดูลของหน้าต่างนี้ยังโหลดไม่สำเร็จ',
    window_not_created: 'เปิดหน้าต่างไม่สำเร็จ กรุณาตรวจข้อผิดพลาดของโมดูล',
    window_not_closed: 'ปิดหน้าต่างไม่สำเร็จ',
    refresh_unavailable: 'หน้าต่างนี้ไม่มีคำสั่งรีเฟรช',
    function_not_available: 'ฟังก์ชันนี้ยังไม่พร้อมใช้งานในหน้าต่าง',
    workflow_not_found: 'คำสั่งที่รอยืนยันหมดอายุหรือดำเนินการไปแล้ว กรุณาสั่งใหม่',
    workflow_permission_denied: 'ไม่สามารถยืนยันคำสั่งของบัญชีอื่นได้',
    unknown_ui_action: 'ยังไม่รองรับคำสั่งหน้าต่างนี้'
  };
  function failure(error) {
    return { ok: false, error, text: errors[error] || 'ดำเนินคำสั่งไม่สำเร็จ ตรวจรายละเอียดในผลคำสั่ง', provider: 'Sentinel', via: 'sentinel-command' };
  }
  function resolve(path) {
    const keys = String(path || '').split('.');
    const name = keys.pop();
    const owner = keys.reduce((object, key) => object?.[key], window);
    return typeof owner?.[name] === 'function' ? owner[name].bind(owner) : null;
  }
  function visible(node) {
    if (!node?.isConnected) return false;
    for (let el = node; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (el.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
  }
  function focus(app, root) {
    const os = system();
    const highest = Math.max(10050, os?.zCounter || 0, ...catalog.apps.map(item => Number.parseInt(getComputedStyle(document.querySelector(item.selector) || document.body).zIndex, 10) || 0));
    if (os) os.zCounter = highest + 1;
    if (app.windowId && typeof focusWindow === 'function') focusWindow(app.windowId);
    else root.style.zIndex = String(highest + 2);
    if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
    root.focus({ preventScroll: true });
  }
  function dismiss(app) {
    const root = document.querySelector(app.selector);
    if (!root) return;
    if (app.windowId && typeof closeWindow === 'function') closeWindow(app.windowId);
    else root.querySelector(app.closeButton)?.click();
  }
  async function windowAction(action) {
    const target = catalog.actionFor(action);
    if (!target) return failure('unknown_ui_action');
    const { app, operation } = target;
    if (!catalog.allowed(app, system()?.state?.user)) return failure('voice_action_permission_denied');
    let root = document.querySelector(app.selector);
    try {
      if (operation === 'close') {
        if (!visible(root)) return { ok: true, action, text: `ปิด ${app.label}`, alreadyClosed: true };
        dismiss(app);
        if (visible(document.querySelector(app.selector))) return failure('window_not_closed');
        return { ok: true, action, text: `ปิด ${app.label}` };
      }
      if (!visible(root)) {
        // A minimized desktop window needs its own restore lifecycle.
        if (root && app.windowId && typeof focusWindow === 'function') focusWindow(app.windowId);
        else {
          let opener = resolve(app.opener);
          for (let attempt = 0; !opener && attempt < 40; attempt++) { await wait(50); opener = resolve(app.opener); }
          if (!opener) return failure('module_unavailable');
          if (!catalog.allowed(app, system()?.state?.user)) return failure('voice_action_permission_denied');
          let openError = null;
          Promise.resolve(opener()).catch(error => { openError = error; });
          for (let attempt = 0; !visible(document.querySelector(app.selector)) && !openError && attempt < 40; attempt++) await wait(50);
          if (openError) throw openError;
        }
      }
      root = document.querySelector(app.selector);
      if (!visible(root)) return failure('window_not_created');
      if (!catalog.allowed(app, system()?.state?.user)) return failure('voice_action_permission_denied');
      focus(app, root);
      if (operation === 'refresh') {
        const refresh = resolve(app.refresher);
        const button = app.refreshButton && root.querySelector(app.refreshButton);
        if (refresh) await refresh();
        else if (button) button.click();
        else return failure('refresh_unavailable');
        return { ok: true, action, text: `รีเฟรช ${app.label}` };
      }
      return { ok: true, action, text: `เปิด ${app.label}` };
    } catch (error) {
      console.warn('[Sentinel window]', app.id, error);
      return failure(operation === 'close' ? 'window_not_closed' : 'window_not_created');
    }
  }
  async function functionAction(action) {
    const command = catalog.functionFor(action);
    if (!command) return failure('unknown_ui_action');
    const app = catalog.apps.find(item => item.id === command.appId);
    if (!catalog.allowed(app, system()?.state?.user)) return failure('voice_action_permission_denied');
    const opened = await windowAction(`open_${app.key}`);
    if (!opened.ok) return opened;
    let button = document.querySelector(app.selector)?.querySelector(command.button);
    for (let attempt = 0; !button && attempt < 40; attempt++) {
      await wait(50);
      button = document.querySelector(app.selector)?.querySelector(command.button);
    }
    if (!button) return failure('function_not_available');
    button.click();
    return { ok: true, action, text: `ดำเนินการ ${command.aliases[0]}` };
  }
  function showResult(text, data, confirmation) {
    // Use the existing top toast only. A second fixed panel at the bottom
    // overlaps the global microphone control and is not needed for voice use.
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = confirmation ? `${text} — พูด ยืนยัน หรือ ยกเลิก` : text;
      toast.classList.add('show');
      clearTimeout(toast.__voiceTimer);
      toast.__voiceTimer = setTimeout(() => toast.classList.remove('show'), confirmation ? 10000 : 3000);
    }
    document.getElementById('sentinel-command-result')?.remove();
  }
  async function consume(data, command) {
    const outcomes = [];
    const userId = system()?.state?.user?.id;
    const key = data.workflowId ? `${userId}:${data.workflowId}` : null;
    const seen = key ? (applied.get(key) || new Set()) : new Set();
    if (key) { applied.set(key, seen); if (applied.size > 100) applied.delete(applied.keys().next().value); }
    for (const [index, result] of (data.results || []).entries()) {
      if (!result.ok || result.output?.ok === false || seen.has(index)) continue;
      // Only trusted navigation tool outputs may invoke the client. A search
      // document, integration payload or planner answer is never executable.
      if (!['window.open', 'window.close', 'window.refresh', 'window.function', 'learning_lab.open'].includes(result.toolId)) continue;
      const action = result.output?.uiAction;
      const outcome = action?.startsWith('function_') ? await functionAction(action) : await windowAction(action);
      outcomes.push(outcome);
      if (outcome.ok) seen.add(index);
      else break;
    }
    const failed = outcomes.find(outcome => !outcome.ok);
    if (failed) { showResult(failed.text, failed); return failed; }
    if (data.confirmationRequired && data.pendingAction) {
      pending = { kind: 'direct', command: data.pendingAction.command, userId, expiresAt: Date.now() + 10 * 60 * 1000 };
      const text = `โปรดยืนยันการทำงาน: ${data.pendingAction.command}`;
      showResult(text, data, data.pendingAction);
      return { ok: true, text, confirmationRequired: true };
    }
    if (data.confirmationRequired && data.workflowId && data.pendingStep) {
      pending = { workflowId: data.workflowId, userId, expiresAt: Date.now() + 10 * 60 * 1000 };
      const text = `คำสั่ง ${data.pendingStep.toolId} ต้องยืนยันก่อนดำเนินการ ตรวจรายละเอียดแล้วพูด ยืนยัน หรือ ยกเลิก`;
      showResult(text, data, data.pendingStep);
      return { ok: true, text, confirmationRequired: true, workflowId: data.workflowId };
    }
    if (!data.ok) { const result = failure(data.error || 'command_failed'); showResult(result.text, data); return result; }
    let text = outcomes.map(item => item.text).join(' ');
    if (data.action === 'close_all_windows' && outcomes.length) text = 'ปิดทุกหน้าต่าง';
    if (!text && data.cancelled) text = 'ยกเลิกคำสั่ง';
    if (!text && data.results?.some(item => item.ok)) text = String(command || 'ยืนยันคำสั่ง').trim();
    // A planner answer alone is not evidence that a requested action happened.
    if (!text) text = 'ยังไม่มีการดำเนินการ กรุณาระบุชื่อหน้าต่างหรือคำสั่งที่รองรับ';
    showResult(text, data);
    return { ok: true, text, provider: 'Sentinel', via: 'sentinel-command', uiResults: outcomes, voiceAction: Boolean(data.voiceAction || data.confirmationRequired || data.workflowId) };
  }
  async function execute(commandInput) {
    if (busy) return { ok: false, text: 'กำลังดำเนินคำสั่งก่อนหน้า กรุณารอสักครู่' };
    busy = true;
    try {
      let command = commandInput;
      const normalized = catalog.normalize(command).replace(/ครับ$|ค่ะ$|คะ$|please$/g, '');
      if (/^(ปิดผลคำสั่ง|ปิดผลลัพธ์|closeresults)$/.test(normalized)) {
        document.getElementById('sentinel-command-result')?.remove();
        return { ok: true, text: 'ปิดผลคำสั่ง' };
      }
      const userId = system()?.state?.user?.id;
      if (!userId) return failure('authentication_required');
      if (/^(ปิด|ปิดหน้าต่าง|ปิดหน้าต่างนี้|ปิดอันนี้|closethiswindow)$/.test(normalized)) {
        const active = catalog.apps.filter(app => visible(document.querySelector(app.selector)) && catalog.allowed(app, system()?.state?.user))
          .sort((a, b) => (Number.parseInt(getComputedStyle(document.querySelector(b.selector)).zIndex, 10) || 0) - (Number.parseInt(getComputedStyle(document.querySelector(a.selector)).zIndex, 10) || 0))[0];
        if (!active) return { ok: true, text: 'ไม่มีหน้าต่างที่เปิดอยู่' };
        command = `ปิด ${active.aliases[0]}`;
      }
      const confirmation = /^(ยืนยัน|ยืนยันคำสั่ง|ยืนยันคำสั่งนี้|confirm)$/.test(normalized);
      const cancellation = /^(ยกเลิก|ยกเลิกคำสั่ง|ยกเลิกคำสั่งนี้|cancel)$/.test(normalized);
      let path = '/api/sentinel/command';
      let confirmed = false;
      if (confirmation || cancellation) {
        if (!pending || pending.userId !== userId || pending.expiresAt < Date.now()) { pending = null; return failure('workflow_not_found'); }
        if (pending.kind === 'direct') {
          if (cancellation) { pending = null; showResult('ยกเลิกคำสั่ง', { ok: true }); return { ok: true, text: 'ยกเลิกคำสั่ง' }; }
          command = pending.command; pending = null; confirmed = true;
        } else {
          path = `/api/agent/workflow/${encodeURIComponent(pending.workflowId)}/${confirmation ? 'confirm' : 'cancel'}`;
          // Never retry a mutation after a network error; its outcome is unknown.
          pending = null;
        }
      } else if (pending?.userId === userId && pending.expiresAt >= Date.now()) {
        return { ok: true, text: 'มีคำสั่งรอยืนยัน กรุณาพูด ยืนยัน หรือ ยกเลิก ก่อนสั่งงานถัดไป', confirmationRequired: true };
      }
      const base = (system()?.config?.backendUrl || '').replace(/\/$/, '');
      const response = await authorizedFetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, confirmed }), signal: AbortSignal.timeout(30000) });
      const data = await response.json();
      if (system()?.state?.user?.id !== userId) return failure('authentication_required');
      if (!response.ok && response.status !== 409) return await consume({ ...data, ok: false }, command);
      const result = await consume(data, command);
      if (confirmation) result.confirmedCommand = true;
      return result;
    } catch (error) {
      const result = { ok: false, error: 'command_connection_failed', text: 'ไม่ได้รับผลคำสั่งจากเซิร์ฟเวอร์ กรุณาตรวจสถานะก่อนสั่งซ้ำ' };
      showResult(result.text, result);
      return result;
    } finally { busy = false; }
  }
  window.addEventListener('panthorium:auth-changed', () => {
    const nextIdentity = identity();
    if (nextIdentity === lastIdentity) return;
    lastIdentity = nextIdentity;
    // Clear cached data on account/permission changes; a token refresh for the
    // same identity must not discard an explicit pending confirmation.
    catalog.apps.forEach(dismiss);
    pending = null; applied.clear(); document.getElementById('sentinel-command-result')?.remove();
  });
  window.PanthoriumVoiceCommands = { execute, windowAction, functionAction };
})();
