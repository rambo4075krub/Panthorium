(function () {
  'use strict';
  const validRelease = value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,160}$/.test(value);
  // The HTML identifies the version actually on screen. Never advance this
  // baseline merely because a hidden tab has discovered a newer deployment.
  let current = document.body?.dataset.panthoriumRelease || null;
  let latest = current, checking = null, applying = false, ok = false;
  const edits = new Map();
  const value = element => element.isContentEditable ? element.textContent : ['checkbox', 'radio'].includes(element.type) ? element.checked : element.value;
  const editable = element => element?.matches?.('input:not([type=button]):not([type=submit]),textarea,select,[contenteditable=true]');
  function remember(event) {
    if (editable(event.target) && !edits.has(event.target)) edits.set(event.target, value(event.target));
  }
  document.addEventListener('focusin', remember);
  document.addEventListener('beforeinput', remember);
  function canReload() {
    for (const [element, original] of edits) {
      if (!element.isConnected) { edits.delete(element); continue; }
      if (value(element) !== original) return false;
    }
    return true;
  }
  function state() { return { ok, current, latest, available: !!current && !!latest && current !== latest, applying, blocked: !canReload() }; }
  function publish() {
    const status = state();
    let banner = document.getElementById('panthorium-update-pending');
    if (status.available && status.blocked && !status.applying) {
      if (!banner) {
        banner = document.createElement('aside'); banner.id = 'panthorium-update-pending';
        banner.setAttribute('role', 'status');
        banner.style.cssText = 'position:fixed;right:16px;bottom:90px;z-index:2147483000;max-width:calc(100vw - 32px);padding:12px;border-radius:12px;background:#102923;color:#fff;border:1px solid #31cda8;font:14px sans-serif';
        const message = document.createElement('span'); message.textContent = 'มีเวอร์ชั่นใหม่ บันทึกงานแล้วกดอัพเดท ';
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'อัพเดท';
        button.onclick = () => apply({ manual: true });
        banner.append(message, button); document.body.appendChild(banner);
      }
    } else banner?.remove();
    window.dispatchEvent(new CustomEvent('panthorium:update-status', { detail: status }));
  }
  async function apply({ manual = false, repair = false } = {}) {
    if (applying || (!repair && !state().available)) return false;
    if (!canReload() && (!manual || !window.confirm('มีข้อความที่ยังแก้ไขอยู่ ต้องการโหลดเวอร์ชั่นใหม่และละทิ้งข้อความที่ยังไม่บันทึกหรือไม่?'))) return false;
    if (!manual && document.visibilityState === 'hidden') return false;
    // A stale intermediary or overlapping rollout must not create a reload loop.
    try {
      const previous = JSON.parse(sessionStorage.getItem('pt_update_attempt') || 'null');
      if (!manual && previous && Date.now() - previous.at < 60000) return false;
      sessionStorage.setItem('pt_update_attempt', JSON.stringify({ at: Date.now(), release: latest }));
    } catch (_) {}
    applying = true; publish();
    window.PanthoriumLiveVoice?.stop?.();
    window.PanthoriumVoice?.pause?.();
    // HTML/scripts are served no-store; keep login state and account data intact.
    window.location.reload();
    return true;
  }
  async function check({ manual = false } = {}) {
    if (checking) return checking;
    if (!manual && document.visibilityState === 'hidden') return state();
    checking = Promise.resolve().then(async () => {
      try {
        const response = await fetch('/app-release.json', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw Error('release_unavailable');
        const data = await response.json();
        if (!validRelease(data.release)) throw Error('invalid_release');
        if (!validRelease(current)) current = data.release;
        latest = data.release; ok = true; publish();
        if (state().available) {
          const notice = {platform:'web',version:latest};
          try { sessionStorage.setItem('pt_update_notice', JSON.stringify(notice)); } catch (_) {}
          await window.PanthoriumNotifications?.announceUpdate?.(notice);
        }
        if (!manual) await apply();
      } catch (_) { ok = false; publish(); }
      finally { checking = null; }
      return state();
    });
    return checking;
  }
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type !== 'panthorium:update-ready') return;
    event.ports?.[0]?.postMessage({ managed: true });
    check();
  });
  window.addEventListener('online', () => check());
  window.addEventListener('focus', () => check());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') check(); });
  document.addEventListener('input', () => { if (state().available && canReload()) apply(); });
  window.PanthoriumUpdates = Object.freeze({ check, apply, state, canReload, markSaved: element => {
    if (element) edits.delete(element); else edits.clear();
    if (state().available) apply();
  } });
  check();
  window.setInterval(() => check(), 15000);
})();
