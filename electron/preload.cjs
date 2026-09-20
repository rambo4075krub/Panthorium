'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('panthoriumDesktop',Object.freeze({
  isElectron:true,
  runtime:'electron-webview',
  version:process.versions.electron,
  bridgeVersion:'5',
  transcribeAudio:(audio,language,token)=>ipcRenderer.invoke('panthorium:transcribe',{audio,language,token}),
  getAppInfo:()=>ipcRenderer.invoke('panthorium:app-info'),
  checkForUpdates:()=>ipcRenderer.invoke('panthorium:check-updates')
}));
