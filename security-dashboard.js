(function () {
  'use strict';

  function getOS() { try { return (typeof OS !== 'undefined') ? OS : null; } catch (e) { return null; } }
  function getUser() { var system = getOS(); return system && system.state ? system.state.user : null; }
  function isAdmin() { var user = getUser(); return !!(user && Array.isArray(user.roles) && user.roles.indexOf('administrator') !== -1); }
  function notify(message) { try { if (typeof toast === 'function') toast(message); } catch (e) {} }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]; }); }
  function formatTime(value) { try { return new Date(value).toLocaleString('th-TH'); } catch (e) { return '-'; } }
  function securityApi(path, options) {
    options = options || {};
    var headers = options.headers || {};
    var system = getOS();
    if (system && system.config && system.config.accessToken) headers.Authorization = 'Bearer ' + system.config.accessToken;
    options.headers = headers; options.credentials = 'include';
    return fetch(path, options).then(function (response) { return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) throw new Error(data.error || ('HTTP_' + response.status)); return data; }); });
  }

  function dashboardMarkup() {
    return '<div class="app-content" data-p3-security style="overflow:auto;height:100%;">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;"><img src="/panthorium-logo.svg" alt="Panthorium" style="width:38px;height:38px;object-fit:contain;"><div><h3 style="margin:0;">Security Dashboard</h3><div style="font-size:12px;color:var(--text-dim);">Panthorium Administrator Security Center</div></div></div>' +
      '<button data-p3-refresh style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;margin-bottom:12px;">รีเฟรช Security Data</button>' +
      '<div data-p3-summary>กำลังโหลด...</div>' +
      '<h4 style="margin:16px 0 6px;">Security Alerts</h4><div data-p3-alerts></div>' +
      '<h4 style="margin:16px 0 6px;">Active Sessions</h4><div data-p3-sessions></div>' +
      '<h4 style="margin:18px 0 8px;">Audit Log</h4>' +
      '<div style="display:grid;grid-template-columns:2fr 1.3fr .8fr auto;gap:7px;margin-bottom:8px;">' +
        '<input data-p3-q placeholder="ค้นหา event / path / user / IP" style="min-width:0;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.2);color:inherit;">' +
        '<input data-p3-event placeholder="event เช่น auth.login_failed" style="min-width:0;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.2);color:inherit;">' +
        '<select data-p3-status style="min-width:0;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#151b27;color:inherit;"><option value="">ทุก Status</option><option>200</option><option>401</option><option>403</option><option>404</option><option>429</option><option>500</option></select>' +
        '<button data-p3-filter style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;">ค้นหา</button>' +
      '</div><div data-p3-audit style="max-height:380px;overflow:auto;"></div></div>';
  }

  function auditUrl(section) {
    var params = new URLSearchParams(); params.set('limit', '100');
    var q = section.querySelector('[data-p3-q]'), event = section.querySelector('[data-p3-event]'), status = section.querySelector('[data-p3-status]');
    if (q && q.value.trim()) params.set('q', q.value.trim());
    if (event && event.value.trim()) params.set('event', event.value.trim());
    if (status && status.value) params.set('status', status.value);
    return '/api/security/audit?' + params.toString();
  }

  function renderAudit(section) {
    var auditEl = section.querySelector('[data-p3-audit]'); if (!auditEl) return Promise.resolve();
    auditEl.innerHTML = '<div style="font-size:12px;color:var(--text-dim);">กำลังโหลด Audit Log...</div>';
    return securityApi(auditUrl(section)).then(function (audit) {
      var entries = audit.entries || [];
      auditEl.innerHTML = entries.length ? entries.map(function (entry) {
        var request = [entry.method, entry.path, entry.status].filter(function (x) { return x != null && x !== ''; }).join(' · ');
        var meta = [entry.actorUserId ? 'user ' + entry.actorUserId : '', entry.ip ? 'IP ' + entry.ip : '', entry.durationMs != null ? entry.durationMs + ' ms' : ''].filter(Boolean).join(' · ');
        return '<div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;line-height:1.5;"><div><strong>' + escapeHtml(entry.event) + '</strong> <span style="color:var(--text-dim);">' + escapeHtml(formatTime(entry.time)) + '</span></div>' + (request ? '<div style="color:#b9c8df;">' + escapeHtml(request) + '</div>' : '') + (meta ? '<div style="color:var(--text-dim);">' + escapeHtml(meta) + '</div>' : '') + '</div>';
      }).join('') : '<div style="font-size:12px;color:var(--text-dim);">ไม่พบ Audit events ตามเงื่อนไข</div>';
    });
  }

  function renderAlerts(section, alerts, status) {
    var el = section.querySelector('[data-p3-alerts]'); if (!el) return;
    var badge = status === 'critical' ? 'CRITICAL' : status === 'warning' ? 'WARNING' : 'NORMAL';
    var badgeColor = status === 'critical' ? '#ff637d' : status === 'warning' ? '#ffbf5f' : '#6effb5';
    if (!alerts || !alerts.length) { el.innerHTML = '<div style="padding:10px;border:1px solid rgba(110,255,181,.25);border-radius:9px;font-size:12px;"><strong style="color:' + badgeColor + ';">' + badge + '</strong> · ไม่พบความเสี่ยงที่เข้าเกณฑ์แจ้งเตือน</div>'; return; }
    el.innerHTML = alerts.map(function (alert) {
      var color = alert.level === 'critical' ? '#ff637d' : alert.level === 'warning' ? '#ffbf5f' : '#8cc8ff';
      return '<div style="padding:10px;border:1px solid ' + color + '55;border-radius:9px;margin-top:7px;background:rgba(0,0,0,.15);"><div style="display:flex;justify-content:space-between;gap:8px;"><strong>' + escapeHtml(alert.title) + '</strong><span style="color:' + color + ';font-size:11px;text-transform:uppercase;">' + escapeHtml(alert.level) + '</span></div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + escapeHtml(alert.detail) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:3px;">' + escapeHtml(alert.code) + '</div></div>';
    }).join('');
  }

  function renderDashboard(section) {
    var summaryEl = section.querySelector('[data-p3-summary]'), sessionsEl = section.querySelector('[data-p3-sessions]');
    if (!summaryEl || !sessionsEl) return;
    summaryEl.textContent = 'กำลังโหลด Security Data...';
    Promise.all([securityApi('/api/security/overview'), renderAudit(section)]).then(function (results) {
      var overview = results[0] || {}, s = overview.summary || {};
      var cards = [['Risk', String(s.riskStatus || 'normal').toUpperCase()], ['Alerts', s.alertCount], ['Active Sessions', s.activeSessions], ['Login OK 24h', s.loginSuccess24h], ['Login Failed 24h', s.loginFailed24h], ['Guest 24h', s.guestSessions24h], ['User Changes 24h', s.userChanges24h], ['Persistence', s.persistence]];
      summaryEl.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px;">' + cards.map(function (entry) { return '<div style="padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(0,0,0,.18);"><div style="font-size:11px;color:var(--text-dim);">' + escapeHtml(entry[0]) + '</div><div style="font-size:18px;font-weight:700;margin-top:4px;">' + escapeHtml(entry[1] == null ? 0 : entry[1]) + '</div></div>'; }).join('') + '</div>';
      renderAlerts(section, overview.alerts || [], s.riskStatus || 'normal');
      var sessions = overview.sessions || [];
      sessionsEl.innerHTML = sessions.length ? sessions.map(function (session) { return '<div style="padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:9px;margin-top:7px;display:flex;justify-content:space-between;gap:8px;align-items:center;"><div><strong>' + escapeHtml(session.username) + '</strong><div style="font-size:11px;color:var(--text-dim);">สร้าง ' + escapeHtml(formatTime(session.createdAt)) + ' · หมดอายุ ' + escapeHtml(formatTime(session.expiresAt)) + '</div></div><button data-p3-revoke="' + escapeHtml(session.id) + '" style="padding:6px 9px;border:0;border-radius:7px;cursor:pointer;">ยกเลิก Session</button></div>'; }).join('') : '<div style="font-size:12px;color:var(--text-dim);">ไม่มี Refresh Session ที่ active</div>';
      Array.prototype.forEach.call(sessionsEl.querySelectorAll('[data-p3-revoke]'), function (button) { button.onclick = function () { if (!confirm('ยกเลิก Session นี้หรือไม่?')) return; securityApi('/api/security/sessions/' + encodeURIComponent(button.getAttribute('data-p3-revoke')), { method: 'DELETE' }).then(function () { notify('ยกเลิก Session แล้ว'); renderDashboard(section); }).catch(function (error) { notify('ยกเลิกไม่สำเร็จ: ' + error.message); }); }; });
    }).catch(function (error) { summaryEl.innerHTML = '<div style="color:#ff8c8c;font-size:12px;">โหลด Security Dashboard ไม่สำเร็จ: ' + escapeHtml(error.message) + '</div>'; });
  }

  function openSecurityDashboard() {
    if (!isAdmin()) { notify('Security Dashboard สำหรับ Administrator เท่านั้น'); return; }
    if (typeof createWindow !== 'function') { console.error('[Phase3] createWindow is unavailable'); return; }
    var record = createWindow('security-dashboard', '🛡️ Security Dashboard', dashboardMarkup(), { width: Math.min(900, window.innerWidth - 28), height: Math.min(700, window.innerHeight - 70) });
    var el = record && record.el ? record.el : null, system = getOS();
    if (!el && system && system.windows && system.windows.get) { var stored = system.windows.get('security-dashboard'); el = stored && stored.el ? stored.el : null; }
    if (!el) return;
    var section = el.querySelector('[data-p3-security]'); if (!section) return;
    var refresh = section.querySelector('[data-p3-refresh]'), filter = section.querySelector('[data-p3-filter]'), q = section.querySelector('[data-p3-q]');
    if (refresh) refresh.onclick = function () { renderDashboard(section); };
    if (filter) filter.onclick = function () { renderAudit(section).catch(function (error) { notify(error.message); }); };
    if (q) q.onkeydown = function (e) { if (e.key === 'Enter' && filter) filter.click(); };
    renderDashboard(section);
  }

  function syncLauncher() {
    var desktopIcon = document.getElementById('phase3-security-desktop'); if (desktopIcon) desktopIcon.remove();
    var startIcon = document.getElementById('phase3-security-start');
    if (!isAdmin()) { if (startIcon) startIcon.remove(); return; }
    var startApps = document.getElementById('sm-apps');
    if (startApps && !startIcon) { startIcon = document.createElement('div'); startIcon.id = 'phase3-security-start'; startIcon.className = 'sm-app'; startIcon.innerHTML = '<div class="ico">🛡️</div><span>Security</span>'; startIcon.onclick = function () { openSecurityDashboard(); try { if (typeof closeStartMenu === 'function') closeStartMenu(); } catch (e) {} }; startApps.appendChild(startIcon); }
  }

  window.openSecurityDashboard = openSecurityDashboard;
  window.PanthoriumSecurityDashboard = { open: openSecurityDashboard, refresh: syncLauncher, isAdmin: isAdmin };
  window.addEventListener('panthorium:auth-changed', syncLauncher);
  setInterval(syncLauncher, 1000); setTimeout(syncLauncher, 0);
})();
