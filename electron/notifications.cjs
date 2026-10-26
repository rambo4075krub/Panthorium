'use strict';

// Only the authenticated, trusted shell may opt into background operation.
// No credentials or notification contents are persisted by the native bridge.
function createDesktopNotifications({ app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, security, iconPath }) {
  const states = new Map();
  let tray, quitting = false;
  const reveal = win => { if (!win || win.isDestroyed()) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); };
  const clear = state => { for (const n of state.notices.values()) n.close(); state.notices.clear(); state.seen.clear(); state.enabled = false; };
  function ensureTray() {
    if (tray) return;
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw Error('notification_icon_unavailable');
    tray = new Tray(icon.resize({ width: 24, height: 24 }));
    tray.setToolTip('Panthorium · รับการแจ้งเตือนเบื้องหลัง');
    const open = () => { for (const state of states.values()) reveal(state.win); };
    tray.on('click', open);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'เปิด Panthorium', click: open },
      { label: 'ออกจากโปรแกรมและหยุดรับแจ้งเตือน', click: () => app.quit() }
    ]));
  }
  function get(event) {
    if (!security.isTrustedShellEvent(event)) throw Error('untrusted_origin');
    const state = states.get(event.sender.id);
    if (!state?.account || state.account.startsWith('guest:')) throw Error('notifications_requires_account');
    return state;
  }
  const handle = (name, fn) => ipcMain.handle(name, async (event, input) => {
    try { return await fn(get(event), input); } catch (error) { return { ok: false, error: error.message }; }
  });
  handle('panthorium:notification-background', (state, enabled) => {
    if (typeof enabled !== 'boolean') throw Error('invalid_notification_setting');
    if (enabled) {
      if (!Notification.isSupported()) throw Error('native_notifications_unavailable');
      ensureTray();
      state.enabled = true;
    } else { clear(state); if (!state.win.isVisible()) reveal(state.win); }
    return { ok: true, enabled: state.enabled };
  });
  handle('panthorium:notification-show', (state, input) => {
    if (!input || !/^notice_[a-f0-9]{64}$/.test(input.id || '') || typeof input.silent !== 'boolean'
      || Object.keys(input).some(k => !['id', 'silent'].includes(k))) throw Error('invalid_notification');
    if (!state.enabled) throw Error('device_notifications_disabled');
    if (state.seen.has(input.id)) return { ok: true, duplicate: true };
    const n = new Notification({ title: 'Panthorium', body: 'มีการแจ้งเตือนใหม่ เปิด Panthorium เพื่อดูรายละเอียด',
      silent: input.silent, icon: iconPath });
    state.seen.add(input.id);
    if (state.seen.size > 500) state.seen.delete(state.seen.values().next().value);
    state.notices.set(input.id, n);
    if(state.notices.size>20){const oldest=state.notices.values().next().value;oldest.close();}
    n.on('click', () => { if (state.enabled) { reveal(state.win); state.win.webContents.send('panthorium:open-notifications'); } });
    n.on('close', () => state.notices.delete(input.id));
    n.on('failed', () => { state.notices.delete(input.id); state.seen.delete(input.id); });
    n.show();
    // OS acceptance is not proof that a person saw a banner (e.g. Do Not Disturb).
    return { ok: true, state: 'submitted_to_os' };
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { for (const state of states.values()) clear(state); tray?.destroy(); });
  return {
    attach(win) {
      const id=win.webContents.id;
      const state = { win, account: '', enabled: false, notices: new Map(), seen: new Set() };
      states.set(win.webContents.id, state);
      win.on('close', event => { if (state.enabled && !quitting) { event.preventDefault(); win.hide(); } });
      win.webContents.on('render-process-gone', () => { clear(state); reveal(win); });
      win.on('closed', () => { clear(state); states.delete(id); });
    },
    setAccount(wc, account) {
      const state = states.get(wc.id);
      if (state && state.account !== account) { clear(state); state.account = account; }
    }
  };
}
module.exports = { createDesktopNotifications };
