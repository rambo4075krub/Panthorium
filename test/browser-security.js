'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createBrowserSecurity,safeWebviewUrl}=require('../electron/browser-security.cjs');
const origin='https://panthorium.net';
class Session { constructor(){this.webRequest={onBeforeRequest:fn=>this.before=fn};} setPermissionCheckHandler(fn){this.check=fn;} setPermissionRequestHandler(fn){this.request=fn;} setDevicePermissionHandler(fn){this.device=fn;} setDisplayMediaRequestHandler(fn){this.display=fn;} }
class Contents extends EventEmitter { constructor(id,ses,url=origin+'/'){super();this.id=id;this.session=ses;this.url=url;this.mainFrame={url};this.destroyed=false;} getURL(){return this.url;} isDestroyed(){return this.destroyed;} setWindowOpenHandler(fn){this.popup=fn;} close(){this.destroyed=true;this.emit('destroyed');} }
const app=new EventEmitter(),defaultSession=new Session(),partitions=new Map();
const session={defaultSession,fromPartition:p=>{if(!partitions.has(p)){const ses=new Session();partitions.set(p,ses);app.emit('session-created',ses);}return partitions.get(p);}};
const trustedOrigin=url=>{try{return new URL(url).origin===origin;}catch{return false;}};
const policy=createBrowserSecurity({app,session,trustedOrigin,edition:'user'});
const shell=new Contents(1,defaultSession);app.emit('web-contents-created',{},shell);policy.registerShell(shell);
const main={isMainFrame:true,requestingUrl:origin+'/',mediaType:'audio',securityOrigin:origin};
assert(defaultSession.check(shell,'media',origin,main));
assert(!defaultSession.check(shell,'media','https://evil.example',main));
assert(!defaultSession.check(shell,'media',origin,{...main,isMainFrame:false}));
assert(!defaultSession.check(shell,'media',origin,{...main,requestingUrl:'https://evil.example'}));
assert(!defaultSession.check(null,'notifications',origin,main));
assert(!defaultSession.check(shell,'display-capture',origin,main));
for(const [details,allowed] of [[{...main,mediaTypes:['audio','video']},true],[{...main,isMainFrame:false,mediaTypes:['audio']},false],[{...main,requestingUrl:'https://evil.example',mediaTypes:['audio']},false],[{...main,mediaTypes:['screen']},false],[{...main},false]]) {
 let answer;defaultSession.request(shell,'media',value=>answer=value,details);assert.equal(answer,allowed);
}
assert(policy.isTrustedShellEvent({sender:shell,senderFrame:shell.mainFrame}));
assert(!policy.isTrustedShellEvent({sender:shell,senderFrame:{url:origin+'/'}}));
const a=policy.setAccount(shell,'account-A'),bSession=session.fromPartition(a.partitions.browser);
assert.notEqual(a.partitions.browser,a.partitions.external);
const guest=new Contents(2,bSession,'https://external.example/');app.emit('web-contents-created',{},guest);
assert(!bSession.check(guest,'media',origin,main));
let answer;bSession.request(guest,'media',v=>answer=v,{...main,mediaTypes:['audio']});assert.equal(answer,false);
assert.equal(bSession.device({origin}),false);
let streams;bSession.display({},v=>streams=v);assert.equal(streams,null);
function attach(params,prefs={}){let prevented=false;shell.emit('will-attach-webview',{preventDefault(){prevented=true;}},prefs,params);return {prevented,prefs};}
const secure=attach({partition:a.partitions.browser,src:'https://external.example/'},{preload:'/evil.cjs',preloadURL:'file:///evil.cjs',nodeIntegration:true,nodeIntegrationInSubFrames:true,sandbox:false,contextIsolation:false,webSecurity:false,additionalArguments:['--anything']});
assert(!secure.prevented);assert.equal(secure.prefs.preload,undefined);assert.equal(secure.prefs.preloadURL,undefined);assert.equal(secure.prefs.nodeIntegration,false);assert.equal(secure.prefs.nodeIntegrationInSubFrames,false);assert.equal(secure.prefs.sandbox,true);assert.equal(secure.prefs.contextIsolation,true);assert.equal(secure.prefs.webSecurity,true);assert.equal(secure.prefs.webviewTag,false);
assert(attach({partition:'persist:another-user',src:'https://external.example/'}).prevented);
assert(attach({partition:a.partitions.browser,src:'file:///etc/passwd'}).prevented);
for(const url of ['file:///etc/passwd','http://example.com','https://[::1]/']){let result;bSession.before({resourceType:'mainFrame',url},x=>result=x);assert.equal(result.cancel,true);}
shell.emit('did-attach-webview',{},guest);
assert.equal(guest.popup({url:'javascript:alert(1)'}).action,'deny');
const opened=guest.popup({url:'https://login.example/'});assert.equal(opened.action,'allow');assert.equal(opened.overrideBrowserWindowOptions.webPreferences.session,bSession);assert.equal(opened.overrideBrowserWindowOptions.webPreferences.webviewTag,false);assert.equal(opened.overrideBrowserWindowOptions.webPreferences.sandbox,true);
const popupContents=new Contents(3,bSession,'https://login.example/');const popup={webContents:popupContents,removeMenu(){},isDestroyed:()=>popupContents.isDestroyed(),destroy:()=>popupContents.close()};guest.emit('did-create-window',popup);
const b=policy.setAccount(shell,'account-B');assert.notEqual(a.partitions.external,b.partitions.external);assert(guest.isDestroyed());assert(popupContents.isDestroyed());
assert.equal(guest.popup({url:'https://external.example/'}).action,'deny');
assert(attach({partition:a.partitions.browser,src:'https://external.example/'}).prevented);
const lateGuest=new Contents(4,bSession,'https://external.example/');shell.emit('did-attach-webview',{},lateGuest);assert(lateGuest.isDestroyed());
assert.deepEqual(policy.setAccount(shell,'').partitions,{});
assert.equal(shell.popup({url:'https://external.example/'}).action,'deny');
assert(safeWebviewUrl('https://example.com/'));assert(!safeWebviewUrl('https://127.0.0.1/'));assert(!safeWebviewUrl('https://[::1]/'));assert(!safeWebviewUrl('https://example.local/'));
console.log('Browser security: all-session permissions, exact requesting frames, native webview preferences, safe popups and account teardown passed');
