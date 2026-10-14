'use strict';
const assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const founder=require('../services/founderAccount');
const {createAuthRouter}=require('../routes/auth');
const {AuthService}=require('../services/authService');
(async()=>{
 const original=founder.isFounderAccount,id='metadata-owner';founder.isFounderAccount=value=>value===id;
 const auth=new AuthService({config:{jwtSecret:'owner-metadata-fixture',accessTokenTtl:'1h'},audit:{record(){}}});auth.issueRefreshToken=async()=>null;
 let server,dom;
 try{
  const session=await auth.issueSession({id,username:'owner',roles:['administrator'],permissions:['settings']});assert.equal(session.principal.systemOwner,true,'login/refresh identity includes owner metadata even without database policy hook');assert.equal(session.principal.founderProtected,true);
  auth.verifyAccessToken=token=>token==='owner'?{sub:id,username:'owner',roles:['administrator'],permissions:['settings']}:{sub:'ordinary-admin',username:'admin',roles:['administrator'],permissions:['settings'],systemOwner:true};
  const app=express();app.use('/api/auth',createAuthRouter(auth,{}));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url='http://127.0.0.1:'+server.address().port+'/api/auth/me';
  const me=(await (await fetch(url,{headers:{Authorization:'Bearer owner'}})).json()).user;assert.equal(me.systemOwner,true,'page-load /me restores owner flag for existing token');assert.equal(me.founderProtected,true);assert.equal(me.id,id);
  const other=(await (await fetch(url,{headers:{Authorization:'Bearer other'}})).json()).user;assert.equal(other.systemOwner,false,'claimed owner flag cannot grant owner metadata to ordinary administrator');
  dom=new JSDOM('<div id="sm-apps"></div>',{url:'https://panthorium.test/admin',runScripts:'outside-only'});const w=dom.window;w.OS={state:{user:null},windows:new Map()};w.PanthoriumAuth={isAdministrator:()=>w.OS.state.user?.roles.includes('administrator')};w.eval(fs.readFileSync(require.resolve('../developer-studio-ui.js'),'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));assert.equal(w.document.querySelector('[data-app-id="developer-studio"]'),null);
  w.OS.state.user=me;w.dispatchEvent(new w.Event('panthorium:auth-changed'));assert(w.document.querySelector('[data-app-id="developer-studio"]'),'Studio appears after real /me response hydrates a reloaded page');w.OS.state.user=other;w.dispatchEvent(new w.Event('panthorium:auth-changed'));assert.equal(w.document.querySelector('[data-app-id="developer-studio"]'),null);
  console.log('PASS owner session metadata: login/refresh, existing-token /me reload, real response restores Studio launcher, ordinary admin spoof denied');
 }finally{founder.isFounderAccount=original;dom?.window.close();server?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
