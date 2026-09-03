(() => {
  const P3 = window.PanthoriumPhase3Admin = window.PanthoriumPhase3Admin || {};
  const isAdmin = () => !!(OS && OS.state && OS.state.user && Array.isArray(OS.state.user.roles) && OS.state.user.roles.includes('administrator'));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const fmt = (v) => { try { return new Date(v).toLocaleString('th-TH'); } catch (_) { return '-'; } };

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (OS?.config?.accessToken) headers.Authorization = `Bearer ${OS.config.accessToken}`;
    const response = await fetch(path, { ...options, headers, credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP_${response.status}`);
    return data;
  }

  async function render(section) {
    const summary = section.querySelector('[data-p3-summary]');
    const sessionsEl = section.querySelector('[data-p3-sessions]');
    const auditEl = section.querySelector('[data-p3-audit]');
    summary.innerHTML = 'กำลังโหลด Security Data...';
    try {
      const [overview, audit] = await Promise.all([api('/api/security/overview'), api('/api/security/audit?limit=50')]);
      const s = overview.summary || {};
      const cards = [['Active Sessions',s.activeSessions],['Login OK 24h',s.loginSuccess24h],['Login Failed 24h',s.loginFailed24h],['Guest 24h',s.guestSessions24h],['User Changes 24h',s.userChanges24h],['Persistence',s.persistence]];
      summary.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;">${cards.map(([k,v]) => `<div style="padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(0,0,0,.18);"><div style="font-size:11px;color:var(--text-dim);">${esc(k)}</div><div style="font-size:20px;font-weight:700;margin-top:4px;">${esc(v ?? 0)}</div></div>`).join('')}</div>`;
      const sessions = overview.sessions || [];
      sessionsEl.innerHTML = sessions.length ? sessions.map(x => `<div style="padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:9px;margin-top:7px;display:flex;justify-content:space-between;gap:8px;align-items:center;"><div><strong>${esc(x.username)}</strong><div style="font-size:11px;color:var(--text-dim);">สร้าง ${esc(fmt(x.createdAt))} · หมดอายุ ${esc(fmt(x.expiresAt))}</div></div><button data-p3-revoke="${esc(x.id)}" style="padding:6px 9px;border:0;border-radius:7px;cursor:pointer;">ยกเลิก Session</button></div>`).join('') : '<div style="font-size:12px;color:var(--text-dim);">ไม่มี Refresh Session ที่ active</div>';
      sessionsEl.querySelectorAll('[data-p3-revoke]').forEach(btn => btn.onclick = async () => {
        if (!confirm('ยกเลิก Session นี้หรือไม่?')) return;
        try { await api(`/api/security/sessions/${encodeURIComponent(btn.dataset.p3Revoke)}`, { method:'DELETE' }); toast('ยกเลิก Session แล้ว'); render(section); }
        catch (e) { toast(`ยกเลิกไม่สำเร็จ: ${e.message}`); }
      });
      const entries = audit.entries || [];
      auditEl.innerHTML = entries.length ? entries.map(e => `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;"><strong>${esc(e.event)}</strong> <span style="color:var(--text-dim);">${esc(fmt(e.time))}</span><div style="color:var(--text-dim);margin-top:2px;word-break:break-word;">${esc(JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['event','time'].includes(k))))}</div></div>`).join('') : '<div style="font-size:12px;color:var(--text-dim);">ยังไม่มี Audit events</div>';
    } catch (e) {
      summary.innerHTML = `<div style="color:#ff8c8c;font-size:12px;">โหลด Security Dashboard ไม่สำเร็จ: ${esc(e.message)}</div>`;
    }
  }

  function open() {
    if (!isAdmin()) { toast('Security Dashboard สำหรับ Administrator เท่านั้น'); return; }
    const html = `<div class="app-content" data-p3-security style="overflow:auto;height:100%;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;"><img src="/panthorium-logo.svg" style="width:38px;height:38px;object-fit:contain;"><div><h3 style="margin:0;">Security Dashboard</h3><div style="font-size:12px;color:var(--text-dim);">Panthorium Administrator Security Center</div></div></div><button data-p3-refresh style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;margin-bottom:12px;">รีเฟรช Security Data</button><div data-p3-summary></div><h4 style="margin:16px 0 6px;">Active Sessions</h4><div data-p3-sessions></div><h4 style="margin:16px 0 6px;">Audit Log ล่าสุด</h4><div data-p3-audit style="max-height:360px;overflow:auto;"></div></div>`;
    const record = createWindow('security-dashboard','🛡️ Security Dashboard',html,{width:Math.min(780,window.innerWidth-40),height:Math.min(620,window.innerHeight-80)});
    const el = record?.el || OS?.windows?.get?.('security-dashboard')?.el;
    const section = el?.querySelector?.('[data-p3-security]');
    if (!section) return;
    section.querySelector('[data-p3-refresh]').onclick = () => render(section);
    render(section);
  }

  function sync() {
    const desktop = document.getElementById('desktop-icons');
    const startApps = document.getElementById('sm-apps');
    let d = document.getElementById('phase3-security-desktop-inline');
    let s = document.getElementById('phase3-security-start-inline');
    if (!isAdmin()) { d?.remove(); s?.remove(); return; }
    if (desktop && !d) {
      d = document.createElement('div'); d.id='phase3-security-desktop-inline'; d.className='desk-icon'; d.innerHTML='<div class="icon-img">🛡️</div><span>Security</span>'; d.onclick=open; desktop.appendChild(d);
    }
    if (startApps && !s) {
      s = document.createElement('div'); s.id='phase3-security-start-inline'; s.className='sm-app'; s.innerHTML='<div class="ico">🛡️</div><span>Security</span>'; s.onclick=()=>{open(); try{closeStartMenu();}catch(_){}}; startApps.appendChild(s);
    }
  }

  P3.open = open; P3.sync = sync;
  window.openSecurityDashboard = open;
  window.addEventListener('panthorium:auth-changed', () => setTimeout(sync,0));
  document.addEventListener('click', () => setTimeout(sync,0), true);
  setInterval(sync,1000);
  setTimeout(sync,0);
})();