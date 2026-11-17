'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('panthoriumDesktop',Object.freeze({
  isElectron:true,
  runtime:'electron-webview',
  version:process.versions.electron,
  bridgeVersion:'9',
  remoteStatus:()=>ipcRenderer.invoke('panthorium:remote-status'),
  connectRemote:options=>ipcRenderer.invoke('panthorium:remote-connect',options),
  pauseRemote:paused=>ipcRenderer.invoke('panthorium:remote-pause',{paused}),
  disconnectRemote:()=>ipcRenderer.invoke('panthorium:remote-disconnect'),
  openMailboxOAuth:url=>ipcRenderer.invoke('panthorium:mailbox-oauth',url),
  setBrowserAccount:accountId=>ipcRenderer.invoke('panthorium:browser-account',accountId),
  transcribeAudio:(audio,language,token)=>ipcRenderer.invoke('panthorium:transcribe',{audio,language,token}),
  controlWindow:action=>ipcRenderer.invoke('panthorium:window-control',action),
  getAppInfo:()=>ipcRenderer.invoke('panthorium:app-info'),
  getUpdateStatus:()=>ipcRenderer.invoke('panthorium:update-status'),
  checkForUpdates:()=>ipcRenderer.invoke('panthorium:check-updates'),
  setNotificationBackground:enabled=>ipcRenderer.invoke('panthorium:notification-background',enabled),
  showNotification:notice=>ipcRenderer.invoke('panthorium:notification-show',notice)
}));
ipcRenderer.on('panthorium:open-notifications',()=>window.dispatchEvent(new Event('panthorium:open-notifications')));
