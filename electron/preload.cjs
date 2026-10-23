'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('panthoriumDesktop',Object.freeze({
  isElectron:true,
  runtime:'electron-webview',
  version:process.versions.electron,
  bridgeVersion:'7',
  setBrowserAccount:accountId=>ipcRenderer.invoke('panthorium:browser-account',accountId),
  transcribeAudio:(audio,language,token)=>ipcRenderer.invoke('panthorium:transcribe',{audio,language,token}),
  controlWindow:action=>ipcRenderer.invoke('panthorium:window-control',action),
  getAppInfo:()=>ipcRenderer.invoke('panthorium:app-info'),
  getUpdateStatus:()=>ipcRenderer.invoke('panthorium:update-status'),
  checkForUpdates:()=>ipcRenderer.invoke('panthorium:check-updates')
}));
