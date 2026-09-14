'use strict';
const {contextBridge}=require('electron');
contextBridge.exposeInMainWorld('panthoriumDesktop',Object.freeze({isElectron:true,runtime:'electron-webview',version:process.versions.electron}));
