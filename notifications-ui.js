(function () {
  'use strict';
  const CATEGORIES = {
    system: ['ระบบ', 'สถานะและเหตุการณ์ของระบบ'],
    security: ['ความปลอดภัยและบัญชี', 'เหตุการณ์ความปลอดภัยของบัญชีคุณ'],
    operations: ['การดำเนินการ', 'เริ่มงาน รออนุมัติ สำเร็จ ล้มเหลว และยกเลิก'],
    reminders: ['การเตือนตามเวลา', 'การตั้งเตือนและสถานะการส่ง'],
    calendar: ['ปฏิทิน', 'การสร้างหรือเปลี่ยนแปลงนัดหมาย'],
    files: ['ไฟล์และเอกสาร', 'เหตุการณ์เกี่ยวกับไฟล์และงานสร้างสรรค์'],
    social: ['Social Media', 'กิจกรรมและข้อความที่เกี่ยวข้องกับคุณ'],
    billing: ['แพ็กเกจและชำระเงิน', 'สถานะแพ็กเกจและรายการชำระเงิน'],
    ai: ['Sentinel AI', 'สถานะงานและข้อผิดพลาดของ AI']
  };
  const roots = new Map();
  const eventCatalog = () => window.PanthoriumNotificationCatalog;
  const eventEntries = () => eventCatalog()?.entries || [];
  let session = null, generation = 0, audioContext = null, ownSpeech = null, aiSpeaking = false;
  const os = () => typeof OS !== 'undefined' ? OS : null;
  const owner = () => String(os()?.state?.user?.sub || os()?.state?.user?.id || '');
  const registered = () => {
    const u = os()?.state?.user;
    return !!owner() && !owner().startsWith('guest:') && !(u?.roles || []).includes('guest') && (u?.permissions || []).includes('chat');
  };
  const current = s => !!s && s === session && s.generation === generation && s.uid === owner() && registered();
  const node = (tag, text, attrs = {}) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
    return n;
  };
  const button = (text, action, attrs = {}) => {
    const b = node('button', text, { type: 'button', ...attrs }); b.addEventListener('click', action); return b;
  };
  function styles() {
    if (document.getElementById('panthorium-notifications-style')) return;
    const style = node('style', `
      [data-notifications-root]{display:grid;gap:14px;color:var(--text,#e4f5ff);font:13px/1.5 system-ui;min-width:0}
      [data-notifications-root] h2{font-size:18px;margin:0}[data-notifications-root] h3{font-size:14px;margin:0 0 9px}
      .pn-card{padding:14px;border:1px solid rgba(132,197,231,.23);border-radius:14px;background:rgba(8,25,40,.54);min-width:0}
      .pn-muted{color:var(--text-dim,#adc1d2);font-size:12px}.pn-row{display:grid;grid-template-columns:minmax(0,1fr) 44px;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid rgba(132,197,231,.1)}
      .pn-row:last-child{border-bottom:0}.pn-row>div{min-width:0;overflow-wrap:anywhere}.pn-row strong{display:block;font-size:13px;font-weight:600;text-align:left}
      .pn-event-group+.pn-event-group{margin-top:20px}.pn-event-group h4{margin:0;padding:0 0 6px;color:var(--text-dim,#adc1d2);font-size:12px;letter-spacing:.02em}
      .pn-event-row{min-height:42px}.pn-event-list>p{margin:0 0 18px}.pn-event-list h3{margin-bottom:4px}
      .pn-event-columns{display:grid;grid-template-columns:minmax(0,1fr) 44px;align-items:center;gap:14px}.pn-event-columns>span{text-align:center;color:var(--text-dim,#adc1d2);font-size:11px;white-space:nowrap}
      [data-notifications-root] details>summary{cursor:pointer;font-weight:600;padding:4px 0;overflow-wrap:anywhere}
      [data-notifications-root] details>summary:focus-visible{outline:2px solid #80e4ff;outline-offset:4px;border-radius:5px}
      [data-notifications-root] details[open]>summary{margin-bottom:14px}.pn-advanced-content{display:grid;gap:12px;padding-top:4px}
      .pn-global-state{margin:7px 0 0;color:#ffcf8e;font-size:12px;overflow-wrap:anywhere}
      [data-notifications-root] button{border:1px solid rgba(132,197,231,.3);background:rgba(64,147,184,.1);border-radius:9px;padding:7px 10px;color:inherit;font:inherit;cursor:pointer}
      [data-notifications-root] button:focus-visible{outline:2px solid #80e4ff;outline-offset:3px}
      [data-notifications-root] button:disabled{opacity:.5;cursor:wait}
      [data-notifications-root] button[role=switch]{position:relative;flex:none;width:44px;height:26px;padding:0;border-radius:20px;background:#324250}
      [data-notifications-root] button[role=switch]::after{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:#eaf6ff;transition:transform .15s}
      [data-notifications-root] button[role=switch][aria-checked=true]{background:#078677;border-color:#54d8c2}
      [data-notifications-root] button[role=switch][aria-checked=true]::after{transform:translateX(18px)}
      .pn-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.pn-quiet{display:flex;gap:9px;flex-wrap:wrap;margin-top:10px}.pn-quiet label{display:grid;gap:4px;flex:1;min-width:110px}
      .pn-quiet input{box-sizing:border-box;min-width:0;width:100%;padding:7px;border:1px solid rgba(132,197,231,.3);border-radius:8px;background:#102130;color:inherit;font:inherit}
      .pn-item{padding:11px;margin-top:8px;border-radius:10px;border:1px solid rgba(132,197,231,.15);overflow-wrap:anywhere}.pn-item[data-unread=true]{border-left:3px solid #52dcc8;background:rgba(25,113,111,.1)}
      .pn-item p{margin:4px 0;white-space:pre-wrap}.pn-item time{font-size:11px;color:var(--text-dim,#adc1d2)}
      [data-notification-toast]{position:fixed;right:16px;bottom:88px;max-width:min(340px,calc(100vw - 32px));box-sizing:border-box;padding:14px 16px;border:1px solid #3aa89e;border-radius:13px;background:#102536;color:#eaf9ff;box-shadow:0 8px 35px #0006;z-index:2147482000;font:13px/1.5 system-ui;overflow-wrap:anywhere}
    `, { id: 'panthorium-notifications-style' });
    document.head.append(style);
  }
  function message(text) {
    for (const [root, view] of roots) if (root.isConnected) view.status.textContent = text;
  }
  async function request(s, path = '', options = {}) {
    if (!current(s) || s.controller.signal.aborted) throw new Error('notification_session_changed');
    const base = String(os()?.config?.backendUrl || '').replace(/\/$/, '');
    if (!base || typeof authorizedFetch !== 'function') throw new Error('notifications_unavailable');
    const controller = new AbortController();
    const stop = () => controller.abort();
    s.controller.signal.addEventListener('abort', stop, { once: true });
    const timeout = setTimeout(stop, 12000);
    try {
      const response = await authorizedFetch(base + '/api/notifications' + path, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
      const data = await response.json();
      if (!current(s)) throw new Error('notification_session_changed');
      if (!response.ok || data.ok !== true) throw new Error(data.error || 'notifications_unavailable');
      return data;
    } finally { clearTimeout(timeout); s.controller.signal.removeEventListener('abort', stop); }
  }
  function quietNow(settings, date = new Date()) {
    if (!settings?.quietHours?.enabled) return false;
    const q = settings.quietHours;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: q.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      const time = parts.find(p => p.type === 'hour').value + ':' + parts.find(p => p.type === 'minute').value;
      if (!/^\d{2}:\d{2}$/.test(q.start) || !/^\d{2}:\d{2}$/.test(q.end)) return true;
      return q.start === q.end || (q.start < q.end ? time >= q.start && time < q.end : time >= q.start || time < q.end);
    } catch (_) { return true; }
  }
  function busy() {
    return aiSpeaking || !!window.PanthoriumLiveVoice?.isBusy?.() || !!window.PanthoriumLiveVoice?.isActive?.() ||
      !!window.PanthoriumSocialRTC?.isActive?.() ||
      (!!window.PanthoriumVoice?.state?.() && window.PanthoriumVoice.state() !== 'idle') ||
      !!document.querySelector('#desktop-voice.listening,#desktop-voice.processing,.chat-mic.listening,[data-action-approval]') ||
      !!window.speechSynthesis?.speaking;
  }
  function stopSpeaking() {
    if (!ownSpeech) return;
    ownSpeech.onend = ownSpeech.onerror = null; ownSpeech = null;
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    window.dispatchEvent(new CustomEvent('panthorium:notification-speech-end'));
  }
  function speak(s, text) {
    if (!current(s) || busy()) return { ok: false, error: 'notification_voice_busy' };
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return { ok: false, error: 'notification_voice_unavailable' };
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1400));
    utterance.lang = 'th-TH'; utterance.rate = 1;
    ownSpeech = utterance;
    const finish = () => { if (ownSpeech === utterance) { ownSpeech = null; window.dispatchEvent(new CustomEvent('panthorium:notification-speech-end')); } };
    utterance.onend = utterance.onerror = finish;
    window.dispatchEvent(new CustomEvent('panthorium:notification-speech-start'));
    window.speechSynthesis.speak(utterance);
    return { ok: true, text };
  }
  function preview(item, settings) {
    if (settings.privacyPreview !== true) return 'มีการแจ้งเตือนใหม่ใน Panthorium เปิดศูนย์แจ้งเตือนเพื่อดูรายละเอียด';
    return [item.title, item.body].filter(Boolean).join(' — ').slice(0, 500);
  }
  function beep() {
    if (!audioContext || audioContext.state !== 'running') return;
    try {
      const o = audioContext.createOscillator(), g = audioContext.createGain(), now = audioContext.currentTime;
      o.frequency.value = 660; g.gain.setValueAtTime(0.045, now); g.gain.exponentialRampToValueAtTime(0.001, now + .18);
      o.connect(g); g.connect(audioContext.destination); o.start(now); o.stop(now + .2);
    } catch (_) {}
  }
  function deliver(s, items) {
    const settings = s.settings;
    if (!current(s) || !settings?.enabled || quietNow(settings)) return;
    const eligible = items.filter(item => !item.readAt && eventCatalog()?.enabled(settings, item) === true);
    if (!eligible.length) return;
    const latest = eligible[0];
    const text = eligible.length > 1 ? `มี ${eligible.length} การแจ้งเตือนใหม่ใน Panthorium` : preview(latest, settings);
    if (settings.channels?.inApp && document.visibilityState !== 'hidden') {
      document.querySelector('[data-notification-toast]')?.remove();
      const toast = node('div', null, { 'data-notification-toast': '', role: 'status', 'aria-live': 'polite' });
      toast.append(node('div', text), button('เปิดการแจ้งเตือน', () => { toast.remove(); open(); }));
      document.body.append(toast); setTimeout(() => toast.remove(), 7000);
    }
    if (settings.channels?.browser && !window.PanthoriumPush?.active() && window.Notification?.permission === 'granted') {
      try {
        const n = new Notification('Panthorium', { body: text, tag: 'panthorium-' + s.uid, silent: true });
        s.browserNotices.add(n); n.onclose = () => s.browserNotices.delete(n);
        n.onclick = () => { n.close(); if (current(s)) { window.focus(); open(); } };
        setTimeout(() => { n.close(); s.browserNotices.delete(n); }, 15000);
      } catch (_) { message('อุปกรณ์นี้แสดงป๊อปอัปเบราว์เซอร์ไม่ได้ • เปิดศูนย์แจ้งเตือนเพื่อดูรายการ'); }
    }
    if (!busy()) {
      if (settings.channels?.sound) beep();
      if (settings.channels?.voice) speak(s, text);
    }
  }
  async function refresh() {
    sync();
    const s = session; if (!current(s)) return false;
    if (s.inFlight) return s.inFlight;
    clearTimeout(s.timer);
    s.inFlight = (async () => {
      try {
        const revision = s.settingsRevision;
        const data = await request(s, '?limit=50');
        if (!current(s)) return false;
        if (revision === s.settingsRevision) {
          if (s.settings && JSON.stringify(s.settings) !== JSON.stringify(data.settings)) stopSpeaking();
          s.settings = data.settings;
        }
        s.items = Array.isArray(data.items) ? data.items : [];
        s.unreadCount = data.unreadCount; s.nextCursor = data.nextCursor || null; s.error = false;
        const fresh = s.items.filter(item => !s.seen.has(item.id));
        s.items.forEach(item => s.seen.add(item.id));
        if (s.seen.size > 1000) s.seen = new Set(s.items.map(item => item.id));
        if (s.loaded) deliver(s, fresh);
        s.loaded = true; render();
        return true;
      } catch (_) {
        if (current(s)) { s.error = true; message('โหลดการแจ้งเตือนไม่สำเร็จ • แตะรีเฟรชเพื่อลองอีกครั้ง'); }
        return false;
      } finally {
        s.inFlight = null;
        if (current(s)) s.timer = setTimeout(refresh, s.error || document.visibilityState === 'hidden' ? 30000 : 10000);
      }
    })();
    return s.inFlight;
  }
  async function saveSettings(patch) {
    const s = session; if (!current(s) || s.saving) return false;
    s.saving = true; s.settingsRevision++; render();
    try {
      const data = await request(s, '/settings', { method: 'PATCH', body: JSON.stringify(patch) });
      if (!current(s)) return false;
      s.settings = data.settings; message('บันทึกการตั้งค่าแล้ว');
      stopSpeaking();
      return true;
    } catch (_) {
      if (current(s)) message('บันทึกไม่สำเร็จ • สวิตช์ยังคงค่าที่บันทึกไว้ก่อนหน้า');
      return false;
    } finally { s.saving = false; if (current(s)) render(); }
  }
  function switchRow(label, description, value, onChange, key) {
    const row = node('div', null, { class: 'pn-row' }), copy = node('div');
    copy.append(node('strong', label), node('div', description, { class: 'pn-muted' }));
    const control = button('', () => onChange(!value), { role: 'switch', 'aria-checked': String(value === true), 'aria-label': label, 'data-notification-setting': key });
    control.disabled = !!session?.saving; row.append(copy, control); return row;
  }
  function eventPreference(settings, entry) {
    return settings.categories?.[entry.category] === true && settings.events?.[entry.id] !== false;
  }
  function changeEvent(entry, enabled) {
    const s = session;
    if (!current(s) || !s.settings) return;
    const events = { [entry.id]: enabled };
    // Enabling one row under a muted category must not enable its siblings.
    if (enabled && s.settings.categories?.[entry.category] !== true) {
      for (const sibling of eventEntries()) if (sibling.category === entry.category) events[sibling.id] = false;
      events[entry.id] = true;
      return saveSettings({ categories: { [entry.category]: true }, events });
    }
    return saveSettings({ events });
  }
  async function channel(key, value) {
    const s = session;
    if (!current(s)) return;
    if (key === 'browser' && value && window.PanthoriumPush?.native()) {
      try { await window.PanthoriumPush.enable(); } catch(e) { message(e.message); return; }
    } else if (key === 'browser' && value) {
      if (!window.Notification) { message('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนบนอุปกรณ์'); return; }
      try {
        const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
        if (!current(s)) return;
        if (permission !== 'granted') { message('ยังไม่ได้รับอนุญาตการแจ้งเตือนจากเบราว์เซอร์ • เปิดสิทธิ์ในการตั้งค่าอุปกรณ์ได้'); return; }
      } catch (_) { message('ขอสิทธิ์แจ้งเตือนบนอุปกรณ์ไม่ได้ • ใช้การแจ้งเตือนในแอปได้'); return; }
    }
    if (key === 'voice' && value && (!window.speechSynthesis || !window.SpeechSynthesisUtterance)) { message('อุปกรณ์นี้ยังไม่รองรับเสียงอ่านการแจ้งเตือน'); return; }
    if (key === 'sound' && value) {
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) { message('อุปกรณ์นี้ยังไม่รองรับเสียงสัญญาณแจ้งเตือน'); return; }
        audioContext ||= new Audio(); await audioContext.resume();
      } catch (_) { message('เปิดเสียงสัญญาณไม่สำเร็จ • แตะสวิตช์เพื่อลองอีกครั้ง'); return; }
    }
    if (current(s)) await saveSettings({ channels: { [key]: value } });
  }
  async function unlockDeviceAudio() {
    const s = session;
    if (!current(s)) return;
    if (busy()) { message('กำลังสนทนาหรือใช้ไมโครโฟนอยู่ • ทดสอบเสียงเมื่อจบการสนทนา'); return; }
    let resume;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) { audioContext ||= new Audio(); resume = audioContext.resume(); }
      const spoken = speak(s, 'ทดสอบเสียงการแจ้งเตือนของ Panthorium');
      if (resume) await resume;
      if (!current(s)) return;
      if (audioContext?.state === 'running') beep();
      for (const view of roots.values()) view.signature = '';
      render();
      message(spoken.ok || audioContext?.state === 'running' ? 'ส่งเสียงทดสอบแล้ว • หากไม่ได้ยิน ตรวจระดับเสียงและสิทธิ์เสียงของอุปกรณ์' : 'อุปกรณ์นี้ไม่รองรับเสียงแจ้งเตือน');
    } catch (_) { if (current(s)) message('เปิดเสียงบนอุปกรณ์ไม่สำเร็จ • ตรวจสิทธิ์เสียงแล้วลองอีกครั้ง'); }
  }
  function renderSettings(view, s) {
    const settings = s.settings, signature = JSON.stringify([settings, !!s.saving, quietNow(settings)]);
    if (view.signature === signature) return;
    const focused = document.activeElement?.dataset?.notificationSetting;
    if (focused && view.settings.contains(document.activeElement)) view.focusKey = focused;
    const previousAdvanced = view.settings.querySelector('[data-notification-advanced]');
    if (previousAdvanced) view.advancedOpen = previousAdvanced.open;
    view.signature = signature; const host = view.settings; host.replaceChildren();
    const master = node('section', null, { class: 'pn-card' });
    master.append(switchRow('เปิดการแจ้งเตือน', 'ควบคุมป๊อปอัปและเสียงของระบบ การตั้งเตือนอีเมลแยกอยู่ด้านล่าง', settings.enabled, value => saveSettings({ enabled: value }), 'enabled'));
    if (!settings.enabled) master.append(node('p', 'ปิดการแจ้งเตือนทั้งหมดอยู่ การเลือกรายการด้านล่างจะบันทึกไว้และใช้เมื่อเปิดสวิตช์หลัก', { class: 'pn-global-state', 'data-notification-global-state': '' }));
    else if (quietNow(settings)) master.append(node('p', 'อยู่ในช่วงห้ามรบกวน รายการที่เปิดไว้จะบันทึกในประวัติ แต่พักป๊อปอัปและเสียง', { class: 'pn-global-state', 'data-notification-global-state': '' }));
    host.append(master);
    const eventList = node('section', null, { class: 'pn-card pn-event-list', 'data-notification-event-list': '', 'aria-label': 'เลือกรายการที่ต้องการแจ้งเตือน' });
    const columns = node('div', null, { class: 'pn-event-columns' });
    columns.append(node('h3', 'รายการแจ้งเตือน'), node('span', 'ปิด-เปิด'));
    eventList.append(columns, node('p', 'เลือกรายการที่ต้องการรับแจ้งเตือน • บันทึกอัตโนมัติ', { class: 'pn-muted' }));
    let group, lastCategory;
    for (const entry of eventEntries()) {
      if (entry.category !== lastCategory) {
        group = node('section', null, { class: 'pn-event-group', 'data-notification-event-group': entry.category });
        group.append(node('h4', CATEGORIES[entry.category]?.[0] || entry.category)); eventList.append(group); lastCategory = entry.category;
      }
      const row = switchRow(entry.label, entry.description, eventPreference(settings, entry), value => changeEvent(entry, value), 'events.' + entry.id);
      row.classList.add('pn-event-row'); row.dataset.notificationEvent = entry.id;
      row.querySelector('strong').setAttribute('data-notification-event-label', '');
      group.append(row);
    }
    if (!eventEntries().length) eventList.append(node('p', 'โหลดรายการตั้งค่าไม่สำเร็จ กรุณารีเฟรชหน้า', { class: 'pn-muted' }));
    host.append(eventList);
    const advanced = node('details', null, { class: 'pn-card', 'data-notification-advanced': '' });
    advanced.open = view.advancedOpen === true;
    advanced.append(node('summary', 'ช่องทางและตัวเลือกเพิ่มเติม'));
    const advancedContent = node('div', null, { class: 'pn-advanced-content' }); advanced.append(advancedContent); host.append(advanced);
    const channels = node('section', null, { class: 'pn-card' }); channels.append(node('h3', 'ช่องทางรับการแจ้งเตือน'));
    const defs = { inApp: ['ในแอป', 'แสดงข้อความเมื่อเปิด Panthorium'], browser: ['บนอุปกรณ์', 'ควบคุมป๊อปอัป • เปิดแจ้งเตือนแม้ปิดแอปบนอุปกรณ์นี้เพิ่มได้'], sound: ['เสียงสัญญาณ', 'เล่นเสียงสั้นเมื่อไม่มีการสนทนาหรือโทรอยู่'], voice: ['อ่านการแจ้งเตือนด้วยเสียง', 'อ่านเมื่อว่างจากการสนทนา ใช้เสียงที่อุปกรณ์รองรับ'] };
    for (const [key, [title, desc]] of Object.entries(defs)) channels.append(switchRow(title, desc, settings.channels?.[key], value => channel(key, value), 'channels.' + key));
    const pushActive=window.PanthoriumPush?.active()===true;
    channels.append(switchRow('แจ้งเตือนแม้ปิดแอปบนอุปกรณ์นี้', pushActive?'ลงทะเบียนอุปกรณ์แล้ว • ต้องเปิดช่องทางบนอุปกรณ์และรายการที่ต้องการด้วย':'อนุญาต Push Notification เพื่อรับแจ้งเตือนเมื่อไม่ได้เปิด Panthorium',pushActive,async value=>{
      try { if(!window.PanthoriumPush)throw Error('กรุณารีเฟรชเพื่อโหลดระบบแจ้งเตือน');
        if(value){await window.PanthoriumPush.enable();if(current(s))await saveSettings({channels:{browser:true}});}
        else await window.PanthoriumPush.disconnect();
        for(const view of roots.values())view.signature='';render();
      }catch(e){message(e.message);}
    },'device.push'));
    channels.append(button('เปิด/ทดสอบเสียงบนอุปกรณ์นี้', unlockDeviceAudio, { 'data-notification-audio-unlock': '' }));
    channels.append(node('p', audioContext?.state === 'running' ? 'เสียงสัญญาณพร้อมในหน้านี้ • เสียงอ่านขึ้นกับเสียงและสิทธิ์ของอุปกรณ์' : 'หลังเปิดหน้าใหม่ แตะทดสอบเสียงเพื่อเปิดเสียงบนอุปกรณ์นี้ สวิตช์เสียงเพียงอย่างเดียวไม่ได้ปลดล็อกเสียงของเบราว์เซอร์', { class: 'pn-muted' }));
    channels.append(node('p', 'Push ช่วยรับแจ้งเตือนเมื่อปิดแอป แต่การบังคับหยุดแอป ปิดสิทธิ์ ออฟไลน์ หรือโหมดประหยัดแบตเตอรี่อาจทำให้ล่าช้า เสียงตอนปิดแอปขึ้นกับระบบของอุปกรณ์', { class: 'pn-muted' })); advancedContent.append(channels);
    const types = node('section', null, { class: 'pn-card' }); types.append(node('h3', 'ปิด-เปิดทั้งหมวด'));
    for (const [key, [title, desc]] of Object.entries(CATEGORIES)) types.append(switchRow(title, desc, settings.categories?.[key], value => saveSettings({ categories: { [key]: value } }), 'categories.' + key));
    advancedContent.append(types);
    const privacy = node('section', null, { class: 'pn-card' }); privacy.append(node('h3', 'ความเป็นส่วนตัวและการขอแจ้งเตือน'));
    privacy.append(switchRow('แสดงและอ่านรายละเอียด', 'เมื่อปิด ป๊อปอัปและเสียงบอกเพียงว่ามีการแจ้งเตือนใหม่ รายละเอียดยังอ่านได้ในศูนย์นี้', settings.privacyPreview, value => saveSettings({ privacyPreview: value }), 'privacyPreview'));
    privacy.append(switchRow('ให้ Sentinel ถามก่อนเสนอส่งแจ้งเตือน', 'เช่น “ให้ส่งแจ้งเตือนไหม” ต้องตอบรับก่อนสร้างรายการที่เสนอ', settings.askBeforeNotify, value => saveSettings({ askBeforeNotify: value }), 'askBeforeNotify')); advancedContent.append(privacy);
    const quiet = node('section', null, { class: 'pn-card' }); quiet.append(node('h3', 'ช่วงห้ามรบกวน'));
    quiet.append(switchRow('เปิดช่วงห้ามรบกวน', 'พักป๊อปอัปและเสียง รายการยังอยู่ในศูนย์แจ้งเตือน', settings.quietHours?.enabled, value => saveSettings({ quietHours: { enabled: value } }), 'quietHours.enabled'));
    const form = node('form', null, { class: 'pn-quiet' });
    for (const [key, title, type] of [['start', 'เริ่ม', 'time'], ['end', 'สิ้นสุด', 'time'], ['timeZone', 'เขตเวลา', 'text']]) {
      const label = node('label', title), field = node('input', null, { type, name: key, 'aria-label': title, required: '', maxlength: '64' }); field.value = settings.quietHours?.[key] || ''; label.append(field); form.append(label);
    }
    const save = node('button', 'บันทึกช่วงเวลา', { type: 'submit' }); save.disabled = !!s.saving; form.append(save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const patch = Object.fromEntries(['start', 'end', 'timeZone'].map(key => [key, form.elements.namedItem(key).value.trim()]));
      try { new Intl.DateTimeFormat('th', { timeZone: patch.timeZone }).format(); } catch (_) { message('เขตเวลาไม่ถูกต้อง เช่น Asia/Bangkok'); return; }
      saveSettings({ quietHours: patch });
    }); quiet.append(form, node('p', 'ถ้าเวลาเริ่มและสิ้นสุดเท่ากัน จะพักการแจ้งเตือนตลอดวัน', { class: 'pn-muted' })); advancedContent.append(quiet);
    if (!s.saving && view.focusKey) {
      [...host.querySelectorAll('[data-notification-setting]')].find(control => control.dataset.notificationSetting === view.focusKey)?.focus({ preventScroll: true });
      view.focusKey = null;
    }
  }
  async function changeItems(action, ids) {
    const s = session; if (!current(s)) return;
    try {
      await request(s, action === 'read' ? '/read' : '', { method: action === 'read' ? 'POST' : 'DELETE', body: JSON.stringify({ ids }) });
      if (current(s)) {
        for (const view of roots.values()) view.older = action === 'read'
          ? view.older.map(item => ids.includes(item.id) ? { ...item, readAt: new Date().toISOString() } : item)
          : view.older.filter(item => !ids.includes(item.id));
        if (s.inFlight) await s.inFlight;
        await refresh(); message(action === 'read' ? 'ทำเครื่องหมายว่าอ่านแล้ว' : 'ลบการแจ้งเตือนแล้ว');
      }
    } catch (_) { if (current(s)) message('แก้ไขรายการไม่สำเร็จ • กรุณาลองอีกครั้ง'); }
  }
  function renderHistory(view, s) {
    const focused = document.activeElement?.dataset?.notificationFocus;
    view.history.replaceChildren();
    const items = [...s.items, ...view.older.filter(item => !s.items.some(latest => latest.id === item.id))];
    const unread = items.filter(item => !item.readAt).slice(0, 100).map(item => item.id);
    view.historySummary.textContent = `ประวัติการแจ้งเตือน • ยังไม่อ่าน ${Math.max(0, Number(s.unreadCount) || 0)}`;
    const actions = node('div', null, { class: 'pn-actions' });
    actions.append(button('รีเฟรช', refresh), button('อ่านให้ฟัง', readAloud), button('หยุดอ่าน', stopSpeaking));
    if (unread.length) actions.append(button(unread.length < 100 ? 'อ่านแล้วทั้งหน้านี้' : 'อ่านแล้ว 100 รายการในหน้านี้', () => changeItems('read', unread))); view.history.append(actions);
    if (view.pageLoaded) view.history.append(button('กลับรายการล่าสุด', () => { view.older = []; view.pageLoaded = false; view.nextCursor = null; renderHistory(view, s); }));
    if (!items.length) view.history.append(node('p', 'ยังไม่มีการแจ้งเตือนในบัญชีนี้', { class: 'pn-muted' }));
    for (const item of items) {
      const article = node('article', null, { class: 'pn-item', 'data-notification-id': item.id, 'data-unread': String(!item.readAt) });
      article.append(node('strong', item.title || 'การแจ้งเตือน'), node('p', item.body || ''));
      const stamp = new Date(item.createdAt);
      article.append(node('time', (CATEGORIES[item.category]?.[0] || 'ระบบ') + ' • ' + (Number.isFinite(stamp.getTime()) ? stamp.toLocaleString('th-TH') : ''), { datetime: Number.isFinite(stamp.getTime()) ? stamp.toISOString() : '' }));
      const row = node('div', null, { class: 'pn-actions' });
      if (!item.readAt) row.append(button('อ่านแล้ว', () => changeItems('read', [item.id]), { 'data-notification-focus': item.id + '-read' }));
      row.append(button('ลบ', () => changeItems('delete', [item.id]), { 'aria-label': 'ลบการแจ้งเตือน ' + (item.title || ''), 'data-notification-focus': item.id + '-delete' }));
      article.append(row); view.history.append(article);
    }
    const cursor = view.pageLoaded ? view.nextCursor : s.nextCursor;
    if (cursor && view.older.length < 200) view.history.append(button('โหลดรายการก่อนหน้า', async () => {
      try {
        const data = await request(s, '?limit=50&before=' + encodeURIComponent(cursor));
        if (!current(s)) return;
        view.older = [...view.older, ...(data.items || [])].filter((item, i, all) => all.findIndex(v => v.id === item.id) === i).slice(0, 200);
        view.nextCursor = data.nextCursor; view.pageLoaded = true; s.unreadCount = data.unreadCount;
        renderHistory(view, s);
      } catch (_) { if (current(s)) message('โหลดรายการก่อนหน้าไม่สำเร็จ'); }
    }));
    if (focused) [...view.history.querySelectorAll('[data-notification-focus]')].find(n => n.dataset.notificationFocus === focused)?.focus({ preventScroll: true });
  }
  function render() {
    for (const [root, view] of roots) {
      if (!root.isConnected) { roots.delete(root); continue; }
      if (!current(session)) {
        root.removeAttribute('data-notification-ready');
        view.signature = ''; view.settings.replaceChildren(); view.history.replaceChildren(); view.historySummary.textContent = 'ประวัติการแจ้งเตือน'; view.historyDetails.open = false;
        view.status.textContent = 'ลงชื่อเข้าใช้บัญชีเพื่อดูและตั้งค่าการแจ้งเตือน'; continue;
      }
      if (!session.settings) { view.status.textContent = 'กำลังโหลดการแจ้งเตือน…'; continue; }
      root.setAttribute('data-notification-ready', 'true');
      if (!view.signature) view.status.textContent = 'ตั้งค่าแยกตามบัญชี • บันทึกสวิตช์อัตโนมัติ';
      renderSettings(view, session); renderHistory(view, session);
    }
  }
  function mount(root) {
    if (!root || roots.has(root)) return;
    styles(); root.setAttribute('data-notifications-root', '');
    const status = node('div', 'กำลังโหลดการแจ้งเตือน…', { role: 'status', 'aria-live': 'polite', class: 'pn-muted' });
    const settings = node('div', null, { style: 'display:grid;gap:12px;', 'data-notification-settings-list': '' });
    const historyDetails = node('details', null, { class: 'pn-card', 'data-notification-history': '' });
    const historySummary = node('summary', 'ประวัติการแจ้งเตือน');
    const history = node('section', null, { 'aria-label': 'ศูนย์แจ้งเตือน' });
    historyDetails.append(historySummary, history);
    root.replaceChildren(node('h2', 'ตั้งค่าการแจ้งเตือน'), status, settings, historyDetails);
    roots.set(root, { status, settings, history, historyDetails, historySummary, signature: '', older: [], pageLoaded: false, nextCursor: null, advancedOpen: false });
    sync(); render(); refresh();
  }
  async function readAloud() {
    const s = session;
    if (!current(s)) return { ok: false, error: 'notification_requires_account' };
    if (!s.loaded && !await refresh()) return { ok: false, error: 'notifications_unavailable' };
    if (!current(s)) return { ok: false, error: 'notification_session_changed' };
    const items = s.items.filter(item => !item.readAt).slice(0, 5);
    const text = !items.length ? 'ไม่มีการแจ้งเตือนที่ยังไม่อ่านในหน้านี้' : s.settings?.privacyPreview
      ? 'การแจ้งเตือนที่ยังไม่อ่าน ' + items.map(item => [item.title, item.body].filter(Boolean).join(' ')).join(' ถัดไป ') : `คุณมี ${s.unreadCount || items.length} การแจ้งเตือนที่ยังไม่อ่าน เปิดแสดงและอ่านรายละเอียดในการตั้งค่าหากต้องการให้อ่านเนื้อหา`;
    const result = speak(s, text);
    if (!result.ok) message(result.error === 'notification_voice_busy' ? 'กำลังสนทนาหรือใช้ไมโครโฟนอยู่ • ถาม Sentinel ว่า “อ่านการแจ้งเตือนให้ฟัง” ได้' : 'อุปกรณ์นี้ไม่รองรับการอ่านด้วยเสียง');
    return result;
  }
  async function open() { return window.PanthoriumReminders?.open?.() || false; }
  function sync(force = false) {
    if (!force && current(session)) return;
    generation++;
    if (session) {
      session.controller.abort(); clearTimeout(session.timer);
      for (const notice of session.browserNotices) try { notice.close(); } catch (_) {}
    }
    session = null; stopSpeaking();
    if (audioContext) { audioContext.close?.().catch?.(() => {}); audioContext = null; }
    document.querySelector('[data-notification-toast]')?.remove();
    for (const view of roots.values()) { view.signature = ''; view.older = []; view.pageLoaded = false; view.nextCursor = null; view.advancedOpen = false; view.settings.replaceChildren(); view.history.replaceChildren(); view.historySummary.textContent = 'ประวัติการแจ้งเตือน'; view.historyDetails.open = false; }
    if (registered()) session = { uid: owner(), generation, controller: new AbortController(), items: [], unreadCount: 0, settings: null, settingsRevision: 0, seen: new Set(), loaded: false, browserNotices: new Set() };
    render();
  }
  window.PanthoriumNotifications = { mount, open, refresh, readAloud, stopSpeaking, getState: () => current(session) ? { loaded: session.loaded, unreadCount: session.unreadCount, settings: session.settings ? JSON.parse(JSON.stringify(session.settings)) : null } : null };
  window.addEventListener('panthorium:auth-changed', () => { sync(true); refresh(); });
  window.addEventListener('panthorium:boot-complete', refresh);
  window.addEventListener('panthorium:push-changed', () => { for(const view of roots.values())view.signature='';render(); });
  window.addEventListener('online', refresh);
  window.addEventListener('offline', () => { stopSpeaking(); message('ออฟไลน์ • รายการจะอัปเดตเมื่อเชื่อมต่ออีกครั้ง'); });
  window.addEventListener('panthorium:notifications-changed', async () => {
    const s = session; if (!current(s)) return;
    s.settingsRevision++;
    if (s.inFlight) await s.inFlight;
    if (current(s)) await refresh();
  });
  window.addEventListener('panthorium:live-start', stopSpeaking);
  window.addEventListener('panthorium:voice-user-start', stopSpeaking);
  window.addEventListener('panthorium:ai-speaking', event => { aiSpeaking = !!(event.detail?.speaking ?? event.detail); if (aiSpeaking) stopSpeaking(); });
  window.addEventListener('pagehide', () => {
    stopSpeaking(); session?.controller.abort(); clearTimeout(session?.timer);
    for (const notice of session?.browserNotices || []) try { notice.close(); } catch (_) {}
    session = null; generation++;
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { sync(true); refresh(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  document.addEventListener('click', event => { if (event.target?.closest?.('#desktop-voice,#global-voice,.chat-mic')) stopSpeaking(); }, true);
  const boot = () => { styles(); sync(); refresh(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
