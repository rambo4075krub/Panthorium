(function () {
  'use strict';
  function getOS() { try { return typeof OS !== 'undefined' ? OS : null; } catch (_) { return null; } }
  function accountId() { const user = getOS()?.state?.user; return String(user?.sub || user?.id || ''); }
  function emit(type, detail) { try { window.dispatchEvent(new CustomEvent(`panthorium:ai-${type}`, { detail })); } catch (_) {} }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const VOICE_SPEECH_CHAR_LIMIT = 360;
  async function ensureToken() {
    const system = getOS(); if (system?.config?.accessToken) return system.config.accessToken;
    if (window.PanthoriumAuth?.refreshSession) {
      const ok = await window.PanthoriumAuth.refreshSession().catch(() => false);
      if (ok) return getOS()?.config?.accessToken || '';
    }
    return '';
  }
  async function revealBuffered(text, state, delay = 18) {
    if (!text) return;
    const chunks = String(text).match(/.{1,10}(?:\s+|$)|.{1,10}/gs) || [String(text)];
    for (const chunk of chunks) {
      state.text += chunk;
      emit('stream', { delta: chunk, text: state.text, simulated: true });
      await sleep(delay);
    }
  }
  async function streamCall(prompt, { voiceMode = false, signal } = {}) {
    const system = getOS();
    const requestAccountId = accountId();
    if (window.PanthoriumAuth?.hasPermission && !window.PanthoriumAuth.hasPermission('chat')) return { ok: false, text: 'บัญชีนี้ไม่มีสิทธิ์ใช้งาน Chat', provider: 'RBAC', via: 'rbac' };
    let token = await ensureToken(); if (!token) throw new Error('authentication_required');
    const base = (system?.config?.backendUrl || '').replace(/\/$/, '');
    const timeoutSignal = AbortSignal.timeout(45000);
    const requestId = window.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const requestSignal = signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeoutSignal]) : signal || timeoutSignal;
    if (document.body.dataset.aiMode === "gemini-live-only") voiceMode = false;
    const request = async () => fetch(base + '/api/chat/stream', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-session-id': system.config.sessionId, Accept: 'text/event-stream' }, body: JSON.stringify({ message: prompt, sessionId: system.config.sessionId, mode: 'default', voice: voiceMode, requestId }), signal: requestSignal });
    let res = await request();
    if (res.status === 401 && window.PanthoriumAuth?.refreshSession) { const ok = await window.PanthoriumAuth.refreshSession().catch(() => false); if (ok) { token = getOS()?.config?.accessToken || ''; res = await request(); } }
    if (!res.ok || !res.body) throw new Error(`stream_http_${res.status}`);
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; const state = { text: '', speechText: '' }; let meta = {}; let sawDelta = false;
    emit('status', { text: 'กำลังเชื่อมต่อ Sentinel...' });
    while (true) {
      const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
      for (const frame of frames) {
        let event = 'message'; let data = null;
        for (const line of frame.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); if (line.startsWith('data:')) { try { data = JSON.parse(line.slice(5).trim()); } catch (_) {} } }
        if (!data) continue;
        if (event === 'start') emit('status', { text: 'Sentinel กำลังประมวลผล...' });
        if (event === 'provider') { meta = { ...meta, ...data }; emit('provider', data); }
        if (event === 'delta') {
          const delta = data.delta || ''; if (!delta) continue; sawDelta = true;
          if (voiceMode) {
            state.text += delta;
            emit('stream', { delta, text: state.text, simulated: false });
            if (state.speechText.length < VOICE_SPEECH_CHAR_LIMIT) {
              const priorSpeech = state.speechText;
              const remaining = VOICE_SPEECH_CHAR_LIMIT - priorSpeech.length;
              let speechDelta = delta.slice(0, remaining);
              if (delta.length > remaining) {
                const candidate = priorSpeech + speechDelta;
                let cut = 0;
                const terminal = /[.!?。！？…\n]/gu;
                for (const match of candidate.matchAll(terminal)) cut = match.index + match[0].length;
                if (cut < VOICE_SPEECH_CHAR_LIMIT - 80) {
                  const space = candidate.lastIndexOf(' ', VOICE_SPEECH_CHAR_LIMIT - 1);
                  if (space > VOICE_SPEECH_CHAR_LIMIT - 80) cut = space;
                }
                if (!cut) cut = candidate.length;
                speechDelta = candidate.slice(priorSpeech.length, cut);
              }
              if (speechDelta) {
                state.speechText += speechDelta;
                emit('stream-delta', { text: speechDelta });
              }
            }
          } else if (delta.length > 24) await revealBuffered(delta, state, 14);
          else { state.text += delta; emit('stream', { delta, text: state.text, simulated: false }); }
        }
        if (event === 'done') { meta = { ...meta, ...data }; emit('done', { ...meta, text: state.text, accountId: requestAccountId }); }
        if (event === 'error') throw new Error(data.error || 'stream_failed');
      }
    }
    if (!sawDelta || !state.text) throw new Error('empty_stream');
    let streamSpeechOk = false;
    if (voiceMode) {
      emit('stream-end', {});
      streamSpeechOk = await window.PanthoriumVoiceStream?.finish?.() === true;
    }
    return { ok: true, text: state.text, provider: meta.provider ? `Sentinel · ${meta.provider}` : 'Sentinel', via: 'sentinel-stream', model: meta.model || null, usage: meta.usage || null, toolResults: meta.toolResults || [], latencyMs: meta.latencyMs || null, streaming: meta.streaming || 'unknown', streamSpoken: voiceMode, streamSpeechOk };
  }
  function installVisualStreaming() {
    if (window.__panthoriumStreamVisualInstalled) return; window.__panthoriumStreamVisualInstalled = true;
    window.addEventListener('panthorium:ai-status', (event) => {
      const loading = document.querySelector('#chat-messages .msg.loading'); if (loading && !loading.dataset.streaming) loading.textContent = event.detail?.text || 'กำลังคิด...';
    });
    window.addEventListener('panthorium:ai-stream', (event) => {
      const loading = document.querySelector('#chat-messages .msg.loading, #chat-messages .msg[data-streaming="1"]'); if (!loading) return;
      loading.classList.remove('loading'); loading.dataset.streaming = '1'; loading.textContent = event.detail?.text || '';
      const container = document.getElementById('chat-messages'); if (container) container.scrollTop = container.scrollHeight;
    });
  }
  function installCallAI() {
    if (typeof callAI !== 'function') return false;
    const previous = callAI; if (previous.__panthoriumStreaming) return true;
    const wrapped = async function (prompt, options = {}) {
      const requestAccountId = accountId();
      // Spoken conversations stream text and start TTS on the first short phrase.
      if (options?.conversationalVoice === true) {
        try { return await streamCall(prompt, { voiceMode: true, signal: options.signal }); }
        catch (error) {
          if (options?.signal?.aborted) return { ok: false, text: "ยกเลิกรอบเสียงแล้ว", error: "voice_cancelled", provider: "Sentinel", via: "sentinel-stream" };
          console.warn('[Phase4 Voice Stream]', error.message);
          const raw = String(error?.message || 'voice_stream_failed');
          const status = /^stream_http_(\d+)$/.exec(raw)?.[1];
          const code = raw === 'authentication_required' || status === '401' ? 'authentication_required'
            : status === '403' ? 'permission_denied'
            : status === '429' ? 'rate_limited'
            : /TimeoutError|AbortError/.test(error?.name || '') ? 'chat_timeout'
            : raw === 'empty_stream' ? 'empty_ai_response' : raw;
          const messages = { authentication_required: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', permission_denied: 'บัญชีนี้ไม่มีสิทธิ์ถามข้อมูล AI', rate_limited: 'เรียก AI เกินขีดจำกัด กรุณารอสักครู่', chat_timeout: 'รอคำตอบ AI เกินเวลา กรุณาลองใหม่' };
          return { ok: false, text: messages[code] || code, error: code, provider: 'Sentinel', via: 'sentinel-stream' };
        }
      }
      if (options?.voiceMode === true) return previous(prompt, options);
      try { const result = await streamCall(prompt); if (result.text) return result; }
      catch (error) {
        console.warn('[Phase4 Stream]', error.message);
        const fallback = await previous(prompt, options);
        if (fallback?.toolResults?.length) emit('done', { ...fallback, accountId: requestAccountId });
        if (fallback?.text) {
          const state = { text: '' };
          emit('status', { text: 'กำลังรับคำตอบจาก Sentinel...' });
          await revealBuffered(fallback.text, state, 16);
          return { ...fallback, text: state.text, streaming: 'client-progressive-fallback' };
        }
        return fallback;
      }
    };
    wrapped.__panthoriumStreaming = true; callAI = wrapped; return true;
  }
  // Notification mutations share the same durable exact-payload confirmation
  // boundary as Live voice. The model receives neither approvalHash nor a way
  // to approve its own proposal; only this authenticated user gesture submits it.
  const notificationApprovals = new Map();
  function clearNotificationApprovals() {
    for (const record of notificationApprovals.values()) { record.controller.abort(); record.card.remove(); }
    notificationApprovals.clear();
  }
  function reviewNotification(result, owner) {
    const confirmation = result?.confirmation, user = getOS()?.state?.user;
    if (!owner || owner !== accountId() || owner.startsWith('guest:') || user?.roles?.includes('guest') || !user?.permissions?.includes('chat') ||
        result?.toolId !== 'notifications.write' || confirmation?.toolId !== result.toolId || result.requiresConfirmation !== true ||
        !/^[a-f0-9-]{36}$/i.test(confirmation.actionId || '') || !/^[a-f0-9]{64}$/.test(confirmation.approvalHash || '') ||
        !Number.isFinite(Date.parse(confirmation.approvalExpiresAt)) || !confirmation.args || typeof confirmation.args !== 'object') return false;
    if (notificationApprovals.has(confirmation.actionId)) return false;
    const expiresAt = Date.parse(confirmation.approvalExpiresAt), controller = new AbortController();
    const make = (tag, value) => { const node = document.createElement(tag); if (value != null) node.textContent = value; return node; };
    const card = make('section'); card.dataset.notificationApproval = confirmation.actionId;
    card.style.cssText = 'padding:16px;border:1px solid var(--accent,#4ddac4);border-radius:12px;margin:10px 0;background:var(--bg-panel,#111c2a);color:var(--text,#f4f8fc);max-width:620px;overflow-wrap:anywhere';
    const actions = { send: 'ส่งการแจ้งเตือนถึงฉันตอนนี้', settings: 'เปลี่ยนตั้งค่าการแจ้งเตือน', mark_read: 'ทำเครื่องหมายอ่านแล้ว', delete: 'ลบการแจ้งเตือน' };
    const label = make('h3', actions[confirmation.args.action] || 'ตรวจสอบการแจ้งเตือน'); label.style.margin = '0 0 8px';
    card.append(label, make('p', confirmation.args.action === 'send' ? 'การส่งตอนนี้จะบันทึกในศูนย์แจ้งเตือน และแสดงตามสวิตช์กับช่วงเวลาเงียบที่ตั้งไว้' : 'ตรวจสอบรายละเอียดด้านล่าง การเปลี่ยนแปลงจะเกิดขึ้นหลังคุณยืนยัน'));
    const details = make('div');
    details.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;line-height:1.6';
    const categoryLabels = { system: 'ระบบ', security: 'ความปลอดภัยและบัญชี', operations: 'การดำเนินการ', reminders: 'การเตือนและกำหนดเวลา', calendar: 'ปฏิทิน', files: 'ไฟล์และเอกสาร', social: 'Social Media', billing: 'แพ็กเกจและชำระเงิน', ai: 'Sentinel AI' };
    const channelLabels = { inApp: 'ข้อความแจ้งเตือนในแอป', browser: 'การแจ้งเตือนของเบราว์เซอร์', sound: 'เสียงสัญญาณ', voice: 'อ่านการแจ้งเตือนด้วยเสียง' };
    const eventLabels = Object.fromEntries((window.PanthoriumNotificationCatalog?.entries || []).map(entry => [entry.id, entry.label]));
    const flagLabels = { enabled: 'การแจ้งเตือนทั้งหมด', privacyPreview: 'แสดงเนื้อหาในตัวอย่างแจ้งเตือน', askBeforeNotify: 'ให้ Sentinel ถามว่าจะส่งการแจ้งเตือนเพิ่มไหม' };
    const add = (name, value) => details.append(make('p', name + ': ' + value));
    const onOff = value => value === true ? 'เปิด' : 'ปิด';
    const args = confirmation.args;
    if (args.action === 'send') { add('หัวข้อ', args.title); if (args.body) add('ข้อความ', args.body); add('หมวด', categoryLabels[args.category || 'system'] || args.category); }
    if (args.action === 'settings') {
      for (const [key, value] of Object.entries(args.patch || {})) {
        if (Object.hasOwn(flagLabels, key)) add(flagLabels[key], onOff(value));
        else if (key === 'channels' || key === 'categories' || key === 'events') {
          const names = key === 'channels' ? channelLabels : key === 'events' ? eventLabels : categoryLabels;
          for (const [field, enabled] of Object.entries(value)) add(names[field] || field, onOff(enabled));
        } else if (key === 'quietHours') {
          const names = { enabled: 'ช่วงเวลาเงียบ', start: 'เริ่มเงียบ', end: 'สิ้นสุดเวลาเงียบ', timeZone: 'เขตเวลา' };
          for (const [field, setting] of Object.entries(value)) add(names[field] || field, field === 'enabled' ? onOff(setting) : setting);
        }
      }
      if (args.patch?.channels?.browser === true || args.patch?.channels?.voice === true || args.patch?.channels?.sound === true) details.append(make('small', 'อุปกรณ์อาจต้องอนุญาตการแจ้งเตือนหรือปลดล็อกเสียงในตั้งค่าการแจ้งเตือนก่อน'));
    }
    if (args.action === 'mark_read' || args.action === 'delete') {
      add('ขอบเขต', args.all === true ? 'รายการทั้งหมดในบัญชีนี้' : (args.ids?.length || 0) + ' รายการที่เลือก');
      if (args.ids?.length) { const exact = make('details'); exact.append(make('summary', 'รหัสรายการที่เลือก'), make('p', args.ids.join('\n'))); details.append(exact); }
    }
    const status = make('p', expiresAt <= Date.now() ? 'คำขอนี้หมดอายุแล้ว กรุณาสั่งใหม่' : 'รอคุณยืนยัน'); status.setAttribute('role', 'status');
    const controls = make('div'); controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
    const approve = make('button', 'ยืนยัน'), cancel = make('button', 'ยกเลิก'), check = make('button', 'ตรวจผลการดำเนินการ');
    for (const button of [approve, cancel, check]) { button.type = 'button'; button.style.cssText = 'font:inherit;padding:8px 12px;border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;cursor:pointer'; }
    approve.disabled = expiresAt <= Date.now(); check.hidden = true;
    controls.append(approve, cancel, check); card.append(details, status, controls);
    (document.getElementById('chat-messages') || document.body).append(card);
    const record = { card, controller, owner, busy: false, finished: false };
    notificationApprovals.set(confirmation.actionId, record);
    const current = () => !controller.signal.aborted && accountId() === owner && card.isConnected;
    const request = async (operation, method = 'POST') => {
      if (!current() || typeof authorizedFetch !== 'function') throw new Error('notification_approval_session_changed');
      const base = String(getOS()?.config?.backendUrl || '').replace(/\/$/, '');
      const response = await authorizedFetch(base + '/api/actions/' + encodeURIComponent(confirmation.actionId) + operation, {
        method, signal: controller.signal,
        ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation === '/confirm' ? { approvalHash: confirmation.approvalHash } : {}) } : {})
      });
      const data = await response.json();
      if (!current()) throw new Error('notification_approval_session_changed');
      return data;
    };
    const showResult = (data, cancelled = false) => {
      if (!current()) return;
      const stored = data.action;
      const outcome = stored ? stored.result : data;
      if (cancelled && data.cancellationEffective) { status.textContent = 'ยกเลิกคำขอแล้ว'; record.finished = true; }
      else if (outcome?.ok === true) {
        status.textContent = ({ send: 'บันทึกการแจ้งเตือนแล้ว', settings: 'บันทึกตั้งค่าการแจ้งเตือนแล้ว', mark_read: 'ทำเครื่องหมายอ่านแล้ว', delete: 'ลบการแจ้งเตือนแล้ว' })[confirmation.args.action] || 'ดำเนินการแล้ว';
        record.finished = true; window.PanthoriumNotifications?.refresh?.();
        window.dispatchEvent(new CustomEvent('panthorium:notifications-changed'));
      } else if (data.error === 'action_confirmation_expired') { status.textContent = 'คำขอนี้หมดอายุแล้ว กรุณาสั่งใหม่'; record.finished = true; }
      else if (outcome?.ok === false && !outcome.reconciliationRequired && outcome.error !== 'action_in_progress') {
        status.textContent = 'ดำเนินการไม่สำเร็จ กรุณาตรวจสอบการแจ้งเตือนและสั่งใหม่'; record.finished = true;
      } else { status.textContent = 'ยังยืนยันผลไม่ได้ กดตรวจผลการดำเนินการก่อนสั่งซ้ำ'; check.hidden = false; }
      if (record.finished) { controls.remove(); details.remove(); }
    };
    const act = async operation => {
      if (!current() || record.busy || record.finished) return;
      if (operation === '/confirm' && expiresAt <= Date.now()) { status.textContent = 'คำขอนี้หมดอายุแล้ว กรุณาสั่งใหม่'; approve.disabled = true; return; }
      record.busy = true; approve.disabled = cancel.disabled = check.disabled = true;
      try { showResult(await request(operation, operation ? 'POST' : 'GET'), operation === '/cancel'); }
      catch { if (current()) { status.textContent = 'การเชื่อมต่อขัดข้อง ยังยืนยันผลไม่ได้ กรุณาตรวจผลก่อนสั่งซ้ำ'; check.hidden = false; } }
      finally { record.busy = false; if (current()) check.disabled = false; }
    };
    approve.addEventListener('click', () => act('/confirm'), { signal: controller.signal });
    cancel.addEventListener('click', () => act('/cancel'), { signal: controller.signal });
    check.addEventListener('click', () => act(''), { signal: controller.signal });
    return true;
  }
  window.addEventListener('panthorium:ai-done', event => {
    for (const result of event.detail?.toolResults || []) {
      if (result.toolId !== 'notifications.write') continue;
      if (result.requiresConfirmation) reviewNotification(result, event.detail?.accountId);
      else if (result.ok && (!event.detail?.accountId || event.detail.accountId === accountId())) window.PanthoriumNotifications?.refresh?.();
    }
  });
  window.addEventListener('panthorium:auth-changed', clearNotificationApprovals);
  window.addEventListener('pagehide', clearNotificationApprovals);
  installVisualStreaming();
  let attempts = 0; const timer = setInterval(() => { attempts += 1; if (installCallAI() || attempts > 60) clearInterval(timer); }, 100);
  window.addEventListener('panthorium:auth-changed', () => setTimeout(installCallAI, 50));
  window.PanthoriumAIStream = { call: streamCall, install: installCallAI };
})();

