(function () {
  'use strict';
  function getOS() { try { return typeof OS !== 'undefined' ? OS : null; } catch (_) { return null; } }
  async function refreshAuth() {
    const system = getOS();
    if (system?.config?.accessToken) return system.config.accessToken;
    if (window.PanthoriumAuth?.refreshSession) {
      const ok = await window.PanthoriumAuth.refreshSession().catch(() => false);
      if (ok && system?.config?.accessToken) return system.config.accessToken;
    }
    return '';
  }
  async function api(path, options = {}, retry = true) {
    const system = getOS();
    let token = system?.config?.accessToken || '';
    if (!token) token = await refreshAuth();
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...options, headers, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && retry && window.PanthoriumAuth?.refreshSession) {
      const ok = await window.PanthoriumAuth.refreshSession().catch(() => false);
      if (ok) return api(path, options, false);
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  function openDashboard() {
    if (document.getElementById('phase4-ai-dashboard')) return;
    const wrap = document.createElement('div'); wrap.id = 'phase4-ai-dashboard';
    wrap.style.cssText = 'position:fixed;inset:8%;z-index:9998;background:rgba(8,12,20,.97);border:1px solid #334155;border-radius:16px;color:#e2e8f0;padding:20px;overflow:auto;font-family:system-ui;box-shadow:0 24px 80px #000';
    wrap.innerHTML = '<button id="ai-close" style="float:right">✕</button><h2>🧠 AI Platform</h2><div style="display:flex;gap:8px;margin:8px 0 14px"><button id="ai-refresh">รีเฟรช</button></div><div id="ai-status">กำลังโหลด...</div><h3>Providers / Models</h3><div id="ai-providers"></div><h3>Conversations</h3><div id="ai-conversations"></div>';
    document.body.appendChild(wrap); document.getElementById('ai-close').onclick = () => wrap.remove(); document.getElementById('ai-refresh').onclick = refresh; refresh();
  }
  async function refresh() {
    const status = document.getElementById('ai-status'); if (!status) return;
    status.textContent = 'กำลังโหลด AI Platform...';
    try {
      const [providers, conversations] = await Promise.all([api('/api/ai/providers'), api('/api/conversations')]);
      status.textContent = `Configured ${providers.providers.filter(p => p.configured).length}/${providers.providers.length} providers · ${conversations.sessions.length} conversations`;
      document.getElementById('ai-providers').innerHTML = providers.providers.map(p => `<div style="padding:8px;border-bottom:1px solid #1e293b"><b>${p.provider}</b> · ${p.model || '-'} · ${p.configured ? 'READY' : 'NOT CONFIGURED'} · priority ${p.priority + 1}</div>`).join('');
      document.getElementById('ai-conversations').innerHTML = conversations.sessions.length ? conversations.sessions.map(s => `<div style="padding:8px;border-bottom:1px solid #1e293b"><b>${s.sessionId}</b> · ${s.messages || '?'} messages · ${s.updatedAt ? new Date(s.updatedAt).toLocaleString('th-TH') : ''}</div>`).join('') : '<div>ยังไม่มีบทสนทนา</div>';
    } catch (e) { status.textContent = e.message === 'authentication_required' ? 'กรุณาเข้าสู่ระบบใหม่เพื่อเปิด AI Platform' : `โหลดข้อมูลไม่สำเร็จ: ${e.message}`; }
  }
  function installLauncher() {
    const menu = document.querySelector('.start-menu, #start-menu'); if (!menu || document.getElementById('phase4-ai-launcher')) return;
    const btn = document.createElement('button'); btn.id = 'phase4-ai-launcher'; btn.textContent = '🧠 AI Platform'; btn.style.cssText = 'display:block;width:100%;padding:10px;text-align:left'; btn.onclick = openDashboard; menu.appendChild(btn);
  }
  window.PanthoriumAI = { open: openDashboard, refresh };
  window.addEventListener('panthorium:auth-changed', () => { if (document.getElementById('phase4-ai-dashboard')) refresh(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installLauncher); else installLauncher();
  setInterval(installLauncher, 2000);
})();
