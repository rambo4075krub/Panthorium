const assert=require('assert'),fs=require('fs'),path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const main=read('electron/main.cjs'),preload=read('electron/preload.cjs'),external=read('external-apps-ui.js'),pkg=JSON.parse(read('package.json'));
assert.match(pkg.scripts.desktop,/electron@36\\.9\\.5/);
assert.match(main,/webviewTag:\s*true/); assert.match(main,/contextIsolation:\s*true/); assert.match(main,/nodeIntegration:\s*false/); assert.match(main,/sandbox:\s*true/); assert.match(main,/HOSTS/);
assert.match(preload,/panthoriumDesktop/); assert.match(external,/<webview/); assert.match(external,/isElectron/); assert.doesNotMatch(external,/<iframe/i);
console.log('Electron WebView tests passed');
