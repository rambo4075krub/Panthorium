(() => {
  function isAdmin() { return !!OS?.state?.user?.roles?.includes('administrator'); }
  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (OS?.config?.accessToken) headers.Authorization = `Bearer ${OS.config.accessToken}`;
    const response = await fetch(path, { ...options, headers, credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP_${response.status}`);
    return data;
  }
  function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function fmtTime(value) { try { return new Date(value).toLocaleString('th-TH'); } catch (_) { return '-'; } }

  async function render(section) {
    const summaryEl = section.querySelector('[data-sec-summary]');
    const sessionsEl = section.querySelector('[data-sec-sessions]');
    const auditEl = section.querySelector('[data-sec-audit]');
    if (!summaryEl || !sessionsEl || !auditEl) return;
    summaryEl.innerHTML = 'กำลังโหลด...';
    try {
      const [overview, audit] = await Promise.all([api('/api/security/overview'), api('/api/security/audit?limit=50')]);
      const s = overview.summary || {};
      summaryEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">${[['Active Sessions',s.activeSessions],['Login OK 24h',s.loginSuccess24h],['Login Failed 24h',s.loginFailed24h],['Guest 24h',s.guestSessions24h],['User Changes 24h',s.userChanges24h],['Persistence',s.persistence]].map(([k,v]) => `<div style="padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(0,0,0,.12);"><div style="font-size:11px;color:var(--text-dim);">${esc(k)}</div><div style="font-size:18px;font-weight:700;margin-top:3px;">${esc(v ?? 0)}</div></div>`).join('')}</div>`;
      const sessions = overview.sessions || [];
      sessionsEl.innerHTML = sessions.length ? sessions.map(session => `<div style="padding:9px;border:1px solid rgba(255,255,255,.08);border-radius:9px;margin-top:7px;display:flex;justify-content:space-between;gap:8px;align-items:center;"><div><strong>${esc(session.username)}</strong><div style="font-size:11px;color:var(--text-dim);">สร้าง ${esc(fmtTime(session.createdAt))} · หมดอายุ ${esc(fmtTime(session.expiresAt))}</div></div><button data-revoke-session="${esc(session.id)}" style="padding:6px 9px;border:0;border-radius:7px;cursor:pointer;">ยกเลิก Session</button></div>`).join('') : '<div style="font-size:12px;color:var(--text-dim);">ไม่มี Refresh Session ที่ active</div>';
      sessionsEl.querySelectorAll('[data-revoke-session]').forEach(btn => { btn.onclick = async () => { if (!confirm('ยกเลิก Session นี้หรือไม่?')) return; try { await api(`/api/security/sessions/${encodeURIComponent(btn.dataset.revokeSession)}`, { method: 'DELETE' }); toast('ยกเลิก Session แล้ว'); await render(section); } catch (error) { toast(`ยกเลิกไม่สำเร็จ: ${error.message}`); } }; });
      const entries = audit.entries || [];
      auditEl.innerHTML = entries.length ? entries.map(entry => `<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;"><strong>${esc(entry.event)}</strong> <span style="color:var(--text-dim);">${esc(fmtTime(entry.time))}</span><div style="color:var(--text-dim);margin-top:2px;white-space:pre-wrap;word-break:break-word;">${esc(JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([k]) => !['event','time'].includes(k))))}</div></div>`).join('') : '<div style="font-size:12px;color:var(--text-dim);">ยังไม่มี Audit events</div>';
    } catch (error) {
      summaryEl.innerHTML = `<div style="color:#ff8c8c;font-size:12px;">โหลด Security Dashboard ไม่สำเร็จ: ${esc(error.message)}</div>`;
    }
  }

  function dashboardHTML() {
    return `<div class="app-content" data-phase3-security style="overflow:auto;height:100%;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><img src="/panthorium-logo.svg" alt="Panthorium" style="width:34px;height:34px;object-fit:contain;"><div><h3 style="margin:0;">Security Dashboard</h3><div style="font-size:12px;color:var(--text-dim);">Administrator Security Center</div></div></div><button data-sec-refresh style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;margin-bottom:10px;">รีเฟรช Security Data</button><div data-sec-summary></div><h4 style="margin:14px 0 6px;">Active Sessions</h4><div data-sec-sessions></div><h4 style="margin:14px 0 6px;">Audit Log ล่าสุด</h4><div data-sec-audit style="max-height:360px;overflow:auto;"></div></div>`;
  }

  function openDashboard() {
    if (!isAdmin()) { toast('Security Dashboard สำหรับ Administrator เท่านั้น'); return; }
    const record = createWindow('security-dashboard', '🛡️ Security Dashboard', dashboardHTML(), { width: Math.min(760, innerWidth - 40), height: Math.min(620, innerHeight - 80) });
    const el = record?.el || OS?.windows?.get?.('security-dashboard')?.el;
    const section = el?.querySelector?.('[data-phase3-security]');
    if (!section) return;
    section.querySelector('[data-sec-refresh]').onclick = () => render(section);
    render(section);
  }

  function injectIntoSettings() {
    if (!isAdmin()) return;
    const record = OS?.windows?.get?.('settings');
    const settingsWindow = record?.el || document.querySelector('.window[data-id="settings"]');
    if (!settingsWindow || settingsWindow.querySelector('[data-security-launcher]')) return;
    const host = settingsWindow.querySelector('.window-body .app-content') || settingsWindow.querySelector('.window-body');
    if (!host) return;
    const box = document.createElement('div');
    box.dataset.securityLauncher = '1';
    box.className = 'settings-section';
    box.style.marginTop = '18px';
    box.innerHTML = `<h3>🛡️ Security Center</h3><p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Audit Log และ Active Sessions สำหรับ Administrator</p><button data-open-security style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;">เปิด Security Dashboard</button>`;
    host.appendChild(box);
    box.querySelector('[data-open-security]').onclick = openDashboard;
  }

  function syncLauncher() {
    const desktop = document.getElementById('desktop-icons');
    const startApps = document.getElementById('sm-apps');
    const existingDesk = document.getElementById('phase3-security-desktop');
    const existingStart = document.getElementById('phase3-security-start');
    if (!isAdmin()) {
      existingDesk?.remove();
      existingStart?.remove();
      return;
    }
    if (desktop && !existingDesk) {
      const icon = document.createElement('div');
      icon.id = 'phase3-security-desktop';
      icon.className = 'desk-icon';
      icon.innerHTML = `<div class="icon-img">🛡️</div><span>Security</span>`;
      icon.onclick = openDashboard;
      desktop.appendChild(icon);
    }
    if (startApps && !existingStart) {
      const item = document.createElement('div');
      item.id = 'phase3-security-start';
      item.className = 'sm-app';
      item.innerHTML = `<div class="ico">🛡️</div><span>Security</span>`;
      item.onclick = () => { openDashboard(); if (typeof closeStartMenu === 'function') closeStartMenu(); };
      startApps.appendChild(item);
    }
    injectIntoSettings();
  }

  const observer = new MutationObserver(() => { syncLauncher(); injectIntoSettings(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(syncLauncher, 0), true);
  window.addEventListener('panthorium:auth-changed', syncLauncher);
  setInterval(syncLauncher, 1200);
  window.openSecurityDashboard = openDashboard;
  window.PanthoriumSecurityDashboard = { refresh: syncLauncher, open: openDashboard };
  setTimeout(syncLauncher, 0);
})();
