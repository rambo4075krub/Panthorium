(() => {
  const allowedRoles = ['administrator', 'operator', 'guest'];
  const allowedPermissions = ['chat', 'core:command', 'settings', 'system:read'];

  function isAdmin() {
    return !!OS?.state?.user?.roles?.includes('administrator');
  }

  async function api(path, options = {}) {
    const token = OS?.config?.accessToken;
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers, credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP_${response.status}`);
    return data;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function parseList(raw, allowed) {
    return [...new Set(String(raw || '').split(',').map((v) => v.trim()).filter((v) => allowed.includes(v)))];
  }

  async function renderUsers(container) {
    container.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">กำลังโหลดบัญชี...</div>';
    try {
      const data = await api('/api/auth/users');
      if (!data.users?.length) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">ยังไม่มีบัญชี</div>';
        return;
      }
      container.innerHTML = data.users.map((user) => `
        <div data-user-id="${esc(user.id)}" style="padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:10px;margin-top:8px;background:rgba(0,0,0,.12);">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
            <div><strong>${esc(user.username)}</strong><div style="font-size:11px;color:var(--text-dim);">${esc((user.roles || []).join(', ') || 'no role')}</div></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
              <button class="um-access" style="padding:6px 9px;border:0;border-radius:7px;cursor:pointer;">สิทธิ์</button>
              <button class="um-password" style="padding:6px 9px;border:0;border-radius:7px;cursor:pointer;">รหัสผ่าน</button>
              <button class="um-delete" style="padding:6px 9px;border:0;border-radius:7px;cursor:pointer;">ลบ</button>
            </div>
          </div>
          <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">permissions: ${esc((user.permissions || []).join(', ') || '-')}</div>
        </div>`).join('');

      container.querySelectorAll('[data-user-id]').forEach((row) => {
        const id = row.dataset.userId;
        const user = data.users.find((item) => item.id === id);
        row.querySelector('.um-access').onclick = async () => {
          const rolesRaw = prompt(`Roles ที่อนุญาต: ${allowedRoles.join(', ')}`, (user.roles || []).join(','));
          if (rolesRaw === null) return;
          const permsRaw = prompt(`Permissions ที่อนุญาต: ${allowedPermissions.join(', ')}`, (user.permissions || []).join(','));
          if (permsRaw === null) return;
          try {
            await api(`/api/auth/users/${encodeURIComponent(id)}/access`, {
              method: 'PATCH',
              body: JSON.stringify({ roles: parseList(rolesRaw, allowedRoles), permissions: parseList(permsRaw, allowedPermissions) })
            });
            toast('อัปเดตสิทธิ์แล้ว');
            await renderUsers(container);
          } catch (error) { toast(`อัปเดตไม่สำเร็จ: ${error.message}`); }
        };

        row.querySelector('.um-password').onclick = async () => {
          const password = prompt(`ตั้งรหัสผ่านใหม่สำหรับ ${user.username} (อย่างน้อย 10 ตัวอักษร)`);
          if (!password) return;
          try {
            await api(`/api/auth/users/${encodeURIComponent(id)}/password`, { method: 'PATCH', body: JSON.stringify({ password }) });
            toast('เปลี่ยนรหัสผ่านแล้ว');
          } catch (error) { toast(`เปลี่ยนรหัสผ่านไม่สำเร็จ: ${error.message}`); }
        };

        row.querySelector('.um-delete').onclick = async () => {
          if (!confirm(`ลบบัญชี ${user.username} หรือไม่?`)) return;
          try {
            await api(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
            toast('ลบบัญชีแล้ว');
            await renderUsers(container);
          } catch (error) { toast(`ลบไม่สำเร็จ: ${error.message}`); }
        };
      });
    } catch (error) {
      container.innerHTML = `<div style="color:#ff8c8c;font-size:12px;">โหลดบัญชีไม่สำเร็จ: ${esc(error.message)}</div>`;
    }
  }

  function injectManager(settingsWindow) {
    if (!isAdmin() || settingsWindow.querySelector('[data-phase2-user-manager]')) return;
    const host = settingsWindow.querySelector('.window-body .app-content') || settingsWindow.querySelector('.window-body');
    if (!host) return;

    const section = document.createElement('div');
    section.dataset.phase2UserManager = '1';
    section.className = 'settings-section';
    section.style.marginTop = '18px';
    section.innerHTML = `
      <h3>👥 User & Permission Manager</h3>
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">จัดการบัญชี Roles และ Permissions จาก PostgreSQL</p>
      <div style="display:flex;gap:8px;margin-bottom:10px;">
        <button id="um-create" style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;">+ สร้างผู้ใช้</button>
        <button id="um-refresh" style="padding:8px 12px;border:0;border-radius:8px;cursor:pointer;">รีเฟรช</button>
      </div>
      <div id="um-users"></div>`;
    host.appendChild(section);

    const usersEl = section.querySelector('#um-users');
    section.querySelector('#um-refresh').onclick = () => renderUsers(usersEl);
    section.querySelector('#um-create').onclick = async () => {
      const username = prompt('ชื่อผู้ใช้ใหม่ (3-40 ตัว: a-z, 0-9, . _ -)');
      if (!username) return;
      const password = prompt('รหัสผ่าน (อย่างน้อย 10 ตัวอักษร)');
      if (!password) return;
      const rolesRaw = prompt(`Roles: ${allowedRoles.join(', ')}`, 'operator');
      if (rolesRaw === null) return;
      const permsRaw = prompt(`Permissions: ${allowedPermissions.join(', ')}`, 'chat,system:read');
      if (permsRaw === null) return;
      try {
        await api('/api/auth/users', {
          method: 'POST',
          body: JSON.stringify({ username, password, roles: parseList(rolesRaw, allowedRoles), permissions: parseList(permsRaw, allowedPermissions) })
        });
        toast('สร้างบัญชีแล้ว');
        await renderUsers(usersEl);
      } catch (error) { toast(`สร้างบัญชีไม่สำเร็จ: ${error.message}`); }
    };

    renderUsers(usersEl);
  }

  const observer = new MutationObserver(() => {
    document.querySelectorAll('.window[data-id="settings"]').forEach(injectManager);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.PanthoriumUserManager = { refresh() {
    document.querySelectorAll('.window[data-id="settings"]').forEach(injectManager);
  }};
})();
