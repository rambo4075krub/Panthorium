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
    } catch (error) { summaryEl.innerHTML = `<div style="color:#ff8c8c;font-size:12px;">โหลด Security Dashboard ไม่สำเร็จ: ${esc(error.message)}</div>`; }
  }

  function inject(settingsWindow) {
    if (!settingsWindow || !isAdmin() || settingsWindow.querySelector('[data-phase3-security]')) return;
    const host = settingsWindow.querySelector('.window-body .app-content') || settingsWindow.querySelector('.window-body');
    if (!host) return;
    const section = document.createElement('div');
    section.dataset.phase3Security = '1';
    section.className = 'settings-section';
    section.style.marginTop = '18px';
    section.innerHTML = `<h3>🛡️ Security Dashboard</h3><p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Audit Log, login activity และ active sessions สำหรับ Administrator</p><button data-sec-refresh style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;margin-bottom:10px;">รีเฟรช Security Data</button><div data-sec-summary></div><h4 style="margin:14px 0 6px;">Active Sessions</h4><div data-sec-sessions></div><h4 style="margin:14px 0 6px;">Audit Log ล่าสุด</h4><div data-sec-audit style="max-height:320px;overflow:auto;"></div>`;
    host.appendChild(section);
    section.querySelector('[data-sec-refresh]').onclick = () => render(section);
    render(section);
  }

  function findSettingsWindows() {
    const found = new Set(document.querySelectorAll('.window[data-id="settings"]'));
    if (OS?.windows?.get) {
      const record = OS.windows.get('settings');
      if (record?.el) found.add(record.el);
    }
    return [...found];
  }
  function refresh() { findSettingsWindows().forEach(inject); }
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(refresh, 0), true);
  window.addEventListener('panthorium:auth-changed', refresh);
  window.PanthoriumSecurityDashboard = { refresh };
  setTimeout(refresh, 0);
})();