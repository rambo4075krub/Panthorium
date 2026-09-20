'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('panthoriumDesktop',Object.freeze({isElectron:true,runtime:'electron-webview',version:process.versions.electron,transcribeAudio:(audio,language,token)=>ipcRenderer.invoke('panthorium:transcribe',{audio,language,token})}));
