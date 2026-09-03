(function () {
  'use strict';

  function getOS() {
    try { return (typeof OS !== 'undefined') ? OS : null; } catch (e) { return null; }
  }

  function getUser() {
    var system = getOS();
    return system && system.state ? system.state.user : null;
  }

  function isAdmin() {
    var user = getUser();
    return !!(user && Array.isArray(user.roles) && user.roles.indexOf('administrator') !== -1);
  }

  function notify(message) {
    try { if (typeof toast === 'function') toast(message); } catch (e) {}
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  function formatTime(value) {
    try { return new Date(value).toLocaleString('th-TH'); }
    catch (e) { return '-'; }
  }

  function securityApi(path, options) {
    options = options || {};
    var headers = options.headers || {};
    var system = getOS();
    if (system && system.config && system.config.accessToken) headers.Authorization = 'Bearer ' + system.config.accessToken;
    options.headers = headers;
    options.credentials = 'include';
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || ('HTTP_' + response.status));
        return data;
      });
    });
  }

  function dashboardMarkup() {
    return '<div class="app-content" data-p3-security style="overflow:auto;height:100%;">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
      '<img src="/panthorium-logo.svg" alt="Panthorium" style="width:38px;height:38px;object-fit:contain;">' +
      '<div><h3 style="margin:0;">Security Dashboard</h3><div style="font-size:12px;color:var(--text-dim);">Panthorium Administrator Security Center</div></div></div>' +
      '<button data-p3-refresh style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;margin-bottom:12px;">รีเฟรช Security Data</button>' +
      '<div data-p3-summary>กำลังโหลด...</div>' +
      '<h4 style="margin:16px 0 6px;">Active Sessions</h4><div data-p3-sessions></div>' +
      '<h4 style="margin:16px 0 6px;">Audit Log ล่าสุด</h4><div data-p3-audit style="max-height:360px;overflow:auto;"></div></div>';
  }

  function renderDashboard(section) {
    var summaryEl = section.querySelector('[data-p3-summary]');
    var sessionsEl = section.querySelector('[data-p3-sessions]');
    var auditEl = section.querySelector('[data-p3-audit]');
    if (!summaryEl || !sessionsEl || !auditEl) return;
    summaryEl.textContent = 'กำลังโหลด Security Data...';

    Promise.all([
      securityApi('/api/security/overview'),
      securityApi('/api/security/audit?limit=50')
    ]).then(function (results) {
      var overview = results[0] || {};
      var audit = results[1] || {};
      var s = overview.summary || {};
      var cards = [
        ['Active Sessions', s.activeSessions],
        ['Login OK 24h', s.loginSuccess24h],
        ['Login Failed 24h', s.loginFailed24h],
        ['Guest 24h', s.guestSessions24h],
        ['User Changes 24h', s.userChanges24h],
        ['Persistence', s.persistence]
      ];
      summaryEl.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;">' + cards.map(function (entry) {
        return '<div style="padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(0,0,0,.18);"><div style="font-size:11px;color:var(--text-dim);">' + escapeHtml(entry[0]) + '</div><div style="font-size:20px;font-weight:700;margin-top:4px;">' + escapeHtml(entry[1] == null ? 0 : entry[1]) + '</div></div>';
      }).join('') + '</div>';

      var sessions = overview.sessions || [];
      sessionsEl.innerHTML = sessions.length ? sessions.map(function (session) {
        return '<div style="padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:9px;margin-top:7px;display:flex;justify-content:space-between;gap:8px;align-items:center;"><div><strong>' + escapeHtml(session.username) + '</strong><div style="font-size:11px;color:var(--text-dim);">สร้าง ' + escapeHtml(formatTime(session.createdAt)) + ' · หมดอายุ ' + escapeHtml(formatTime(session.expiresAt)) + '</div></div><button data-p3-revoke="' + escapeHtml(session.id) + '" style="padding:6px 9px;border:0;border-radius:7px;cursor:pointer;">ยกเลิก Session</button></div>';
      }).join('') : '<div style="font-size:12px;color:var(--text-dim);">ไม่มี Refresh Session ที่ active</div>';

      Array.prototype.forEach.call(sessionsEl.querySelectorAll('[data-p3-revoke]'), function (button) {
        button.onclick = function () {
          if (!confirm('ยกเลิก Session นี้หรือไม่?')) return;
          securityApi('/api/security/sessions/' + encodeURIComponent(button.getAttribute('data-p3-revoke')), { method: 'DELETE' })
            .then(function () { notify('ยกเลิก Session แล้ว'); renderDashboard(section); })
            .catch(function (error) { notify('ยกเลิกไม่สำเร็จ: ' + error.message); });
        };
      });

      var entries = audit.entries || [];
      auditEl.innerHTML = entries.length ? entries.map(function (entry) {
        return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;"><strong>' + escapeHtml(entry.event) + '</strong> <span style="color:var(--text-dim);">' + escapeHtml(formatTime(entry.time)) + '</span></div>';
      }).join('') : '<div style="font-size:12px;color:var(--text-dim);">ยังไม่มี Audit events</div>';
    }).catch(function (error) {
      summaryEl.innerHTML = '<div style="color:#ff8c8c;font-size:12px;">โหลด Security Dashboard ไม่สำเร็จ: ' + escapeHtml(error.message) + '</div>';
    });
  }

  function openSecurityDashboard() {
    if (!isAdmin()) {
      notify('Security Dashboard สำหรับ Administrator เท่านั้น');
      return;
    }
    if (typeof createWindow !== 'function') {
      console.error('[Phase3] createWindow is unavailable');
      return;
    }
    var record = createWindow('security-dashboard', '🛡️ Security Dashboard', dashboardMarkup(), {
      width: Math.min(780, window.innerWidth - 40),
      height: Math.min(620, window.innerHeight - 80)
    });
    var el = record && record.el ? record.el : null;
    var system = getOS();
    if (!el && system && system.windows && system.windows.get) {
      var stored = system.windows.get('security-dashboard');
      el = stored && stored.el ? stored.el : null;
    }
    if (!el) return;
    var section = el.querySelector('[data-p3-security]');
    if (!section) return;
    var refresh = section.querySelector('[data-p3-refresh]');
    if (refresh) refresh.onclick = function () { renderDashboard(section); };
    renderDashboard(section);
  }

  function syncLauncher() {
    var desktopIcon = document.getElementById('phase3-security-desktop');
    var startIcon = document.getElementById('phase3-security-start');
    if (!isAdmin()) {
      if (desktopIcon) desktopIcon.remove();
      if (startIcon) startIcon.remove();
      return;
    }

    var desktop = document.getElementById('desktop-icons');
    if (desktop && !desktopIcon) {
      desktopIcon = document.createElement('div');
      desktopIcon.id = 'phase3-security-desktop';
      desktopIcon.className = 'desk-icon';
      desktopIcon.innerHTML = '<div class="icon-img">🛡️</div><span>Security</span>';
      desktopIcon.onclick = openSecurityDashboard;
      desktop.appendChild(desktopIcon);
    }

    var startApps = document.getElementById('sm-apps');
    if (startApps && !startIcon) {
      startIcon = document.createElement('div');
      startIcon.id = 'phase3-security-start';
      startIcon.className = 'sm-app';
      startIcon.innerHTML = '<div class="ico">🛡️</div><span>Security</span>';
      startIcon.onclick = function () {
        openSecurityDashboard();
        try { if (typeof closeStartMenu === 'function') closeStartMenu(); } catch (e) {}
      };
      startApps.appendChild(startIcon);
    }
  }

  window.openSecurityDashboard = openSecurityDashboard;
  window.PanthoriumSecurityDashboard = { open: openSecurityDashboard, refresh: syncLauncher, isAdmin: isAdmin };
  window.addEventListener('panthorium:auth-changed', syncLauncher);
  document.addEventListener('click', function () { setTimeout(syncLauncher, 0); }, true);
  setInterval(syncLauncher, 500);
  setTimeout(syncLauncher, 0);
})();