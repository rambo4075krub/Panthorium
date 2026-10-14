const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const admin = { roles: ['administrator'], permissions: ['chat', 'settings', 'system:read', 'sentinel:command'] };
const guest = { roles: ['guest'], permissions: ['chat', 'system:read'] };
const regularUser = { roles: [], permissions: ['chat', 'system:read', 'settings', 'sentinel:command'] };

async function scenario(role, desktop, legacy = false, adminEntry = role === 'admin') {
  let restarts = 0;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (error.message.includes('navigation')) restarts++; else throw error; });
  const dom = new JSDOM(source('sentinel.html'), { url: 'https://panthorium.net' + (adminEntry ? '/admin' : '/'), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  let manual = 0, logouts = 0, available = false, fail = false;
  w.OS = { state: { user: role === 'admin' ? admin : role === 'user' ? regularUser : guest }, windows: new Map() };
  w.PanthoriumAuth = { isGuest: () => w.OS.state.user.roles.includes('guest'), isAdministrator: () => w.OS.state.user.roles.includes('administrator'), logout: () => { logouts++; } };
  w.AbortSignal = AbortSignal;
  if (desktop) {
    w.panthoriumDesktop = {
      isElectron: true,
      getAppInfo: async () => ({ version: '15.0.3', edition: role === 'admin' ? 'admin' : 'user', platform: 'win32' }),
      checkForUpdates: async () => { manual++; return { ok: true, deferred: true, current: '15.0.3', remote: '15.0.4' }; }
    };
    if (!legacy) w.panthoriumDesktop.getUpdateStatus = async () => {
      if (fail) throw new Error('offline');
      return { ok: true, available, current: '15.0.3', remote: available ? '15.0.4' : '15.0.3' };
    };
    w.fetch = async () => {
      if (fail) throw new Error('offline');
      return Response.json({ assets: [
        { name: `Panthorium-Browser-${role === 'admin' ? 'admin' : 'user'}-${available ? '15.0.4' : '15.0.3'}-x64.exe` },
        { name: 'Panthorium-Browser-user-99.0.0-arm64.dmg' },
        { name: 'Panthorium-Browser-admin-update.json' }
      ] });
    };
  }
  w.document.getElementById('sm-apps').innerHTML = '<div class="sm-app">Sentinel AI</div><div class="sm-app">ตั้งค่า</div><button id="phase4-ai-launcher">AI Platform</button><button id="phase5-agent-launcher">Sentinel Agent</button>';
  if (role === 'user') {
    const apps = w.document.getElementById('sm-apps');
    for (const [id, label] of [['calculator', 'เครื่องคิดเลข'], ['notes', 'บันทึก'], ['files', 'ไฟล์']]) {
      const item = w.document.createElement('button'); item.className = 'sm-app'; item.dataset.appId = id; item.textContent = label; apps.appendChild(item);
    }
  }
  try {
    for (const file of ['voice-window-catalog.js', 'access-shell-ui.js', 'staging-admin-desktop.js', 'ui-layout.js']) w.eval(source(file));
    w.PanthoriumStagingAdminDesktop.sync();
    w.PanthoriumUILayout.sync();
    w.PanthoriumAccessShell.sync();
    if (desktop) await w.PanthoriumAccessShell.refreshUpdateStatus(true);
    if (role !== 'admin') {
      const lateLauncher = w.document.createElement('button'); lateLauncher.id = 'phase6-automation-launcher'; lateLauncher.textContent = 'Agent Automation';
      w.document.getElementById('sm-apps').appendChild(lateLauncher);
      await new Promise(resolve => w.setTimeout(resolve, 40));
      const expectedMenu = role === 'user' ? ['Sentinel AI', 'ลงทะเบียน', 'เครื่องคิดเลข', 'บันทึก', 'ไฟล์'] : ['Sentinel AI', 'ลงทะเบียน'];
      assert.deepEqual([...w.document.querySelectorAll('#sm-apps > *')].map(el => el.querySelector('span')?.textContent.trim() || el.textContent.trim()), expectedMenu, 'non-staff Start Menu keeps authorized apps and removes late privileged injection');
    }
    if (role === 'admin') {
      const icons = [...w.document.querySelectorAll('#desktop-icons [data-app-id]')];
      assert(icons.some(icon=>icon.dataset.appId==='admin-mailbox'),'mailbox icon must appear on the admin desktop');
      assert.equal(icons.length, 18, 'every admin icon is on the desktop on production hosts too');
      assert.equal(new Set(icons.map(icon => icon.dataset.appId)).size, 18);
      assert.notEqual(w.getComputedStyle(w.document.getElementById('desktop-icons')).display, 'none');
      assert.notEqual(w.getComputedStyle(w.document.getElementById('sm-apps')).display, 'none', 'administrator Start Menu exposes searchable launchers');
      assert(w.document.getElementById('start-search'));
      assert(w.document.getElementById('btn-restart'));
    }
    if (desktop) {
      {
        assert.equal(w.document.getElementById('panthorium-browser-download'), null, 'no installer hyperlink inside any installed browser');
        const update = w.document.getElementById('panthorium-browser-update');
        assert.equal(update.textContent, 'ปัจจุบันเป็นเวอร์ชันล่าสุดแล้ว');
        assert.equal(manual, 0, 'checking status must not invoke an installer');
        available = true;
        await w.PanthoriumAccessShell.refreshUpdateStatus(true);
        assert.equal(update.textContent, 'อัปเดต Panthorium Browser');
        await update.onclick();
        assert.equal(manual, 1);
        assert.equal(update.textContent, 'อัปเดต Panthorium Browser', 'deferring an update must not claim it is installed');
        fail = true;
        await w.PanthoriumAccessShell.refreshUpdateStatus(true);
        assert.equal(update.dataset.state, 'unknown', 'offline does not mean current');
        fail = false;
      }
      if (role === 'guest') {
        assert.notEqual(w.getComputedStyle(w.document.getElementById('sm-apps')).display, 'none', 'Guest Start Menu remains available');
        assert.equal(w.document.getElementById('btn-login'), null);
        assert.equal(w.document.getElementById('btn-logout').textContent, '🚪 ออกจากระบบ');
        assert.deepEqual([...w.document.querySelectorAll('#sm-apps > *')].map(el => el.querySelector('span')?.textContent.trim() || el.textContent.trim()), ['Sentinel AI', 'ลงทะเบียน']);
        assert.equal(w.document.getElementById('panthorium-browser-download'), null);
        w.document.getElementById('btn-logout').onclick();
        assert.equal(logouts, 1);
        assert(w.document.getElementById('panthorium-browser-update'));
      }
    } else {
      assert.equal(w.document.getElementById('panthorium-browser-update'), null);
      if (role === 'admin') {
        const download = w.document.getElementById('panthorium-browser-download');
        assert.equal(download.textContent, 'ดาวน์โหลด Panthorium Browser Admin');
        assert.equal(new URL(download.href).search, '?edition=admin');
      } else {
        assert.equal(w.document.getElementById('btn-logout').textContent, '🚪 ออกจากระบบ');
        assert.equal(w.document.getElementById('panthorium-browser-download').textContent, 'ดาวน์โหลด Panthorium Browser');
      }
    }
    const restart = w.document.getElementById('btn-restart');
    assert(restart, 'every role has a restart button');
    assert.notEqual(w.getComputedStyle(restart).display, 'none', 'restart is visible for every role');
    assert.equal(w.document.querySelectorAll('#btn-restart').length, 1);
    let stoppedVoice = 0;
    w.PanthoriumLiveVoice = { stop: () => { stoppedVoice++; } };
    w.document.getElementById('start-menu').classList.add('open');
    const previousLogouts = logouts;
    restart.click();
    assert.equal(stoppedVoice, 1, 'restart stops the active voice session');
    assert.equal(restarts, 1, 'restart reloads the shell once');
    assert.equal(logouts, previousLogouts, 'restart preserves the signed-in session');
    assert(!w.document.getElementById('start-menu').classList.contains('open'));
    const forbidden = w.document.createElement('div'); forbidden.id = 'phase4-ai-dashboard'; w.document.body.appendChild(forbidden);
    w.OS.state.user = guest;
    w.PanthoriumAccessShell.sync();
    assert.equal(w.document.getElementById('phase4-ai-dashboard'), null, 'close privileged panels on account change');
    if (role === 'guest' && adminEntry) {
      w.PanthoriumStagingAdminDesktop.sync();
      w.PanthoriumUILayout.sync();
      assert.equal(w.document.querySelectorAll('#desktop-icons [data-app-id]').length, 0, 'an /admin URL must not give Guest the administrator desktop');
      assert.equal(w.getComputedStyle(w.document.getElementById('desktop-icons')).display, 'none', 'Guest desktop stays hidden even on /admin');
    }
  } finally { await new Promise(resolve => w.setTimeout(resolve, 50)); w.close(); }
}
(async () => {
  for (const role of ['admin', 'guest', 'user']) for (const desktop of [true, false]) await scenario(role, desktop);
  await scenario('guest', true, true);
  await scenario('admin', true, true);
  await scenario('user', true, true);
  await scenario('guest', true, false, true);
  await scenario('guest', false, false, true);
  console.log('Access shell: Guest/Admin role checks at / and /admin; 18 admin icons; Guest Voice Identity Start Menu; current/new/offline update status; installed 15.0.3 compatibility');
})().catch(error => { console.error(error); process.exitCode = 1; });
