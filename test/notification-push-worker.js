'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
(async()=>{
  const handlers={},shown=[],opened=[];let binding='a'.repeat(32);
  const indexedDB={open(){const req={};queueMicrotask(()=>{
    req.result={close(){},transaction(){const tx={};tx.objectStore=()=>({get(){const op={result:binding};queueMicrotask(()=>tx.oncomplete());return op;},put(v){binding=v;const op={result:v};queueMicrotask(()=>tx.oncomplete());return op;}});return tx;}};req.onsuccess();
  });return req;}};
  const self={location:{origin:'https://panthorium.test'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(t,o)=>shown.push({t,o})},clients:{matchAll:async()=>[],openWindow:async u=>opened.push(u)}};
  vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{self,indexedDB,URL,Promise,Response});
  async function push(data){let result;handlers.push({data:{json:()=>data},waitUntil:p=>result=p});await result;}
  const notice={v:1,id:'notice_'+'1'.repeat(64),binding,title:'PRIVATE',body:'secret',url:'https://evil.test'};
  await push(notice);assert.equal(shown.length,1);assert.equal(shown[0].o.data.url,'/?notifications=1');assert(!JSON.stringify(shown).includes('PRIVATE'));assert(!JSON.stringify(shown).includes('secret'));
  await push({...notice,binding:'b'.repeat(32)});assert.equal(shown.length,1,'old-account binding cannot display');
  let clicked;handlers.notificationclick({notification:{close(){}},waitUntil:p=>clicked=p});await clicked;assert.deepEqual(opened,['/?notifications=1']);
  let revoked;handlers.message({source:{url:'https://panthorium.test/'},data:{type:'panthorium:push-binding',binding:null},waitUntil:p=>revoked=p});await revoked;await push(notice);assert.equal(shown.length,1);
  console.log('Push worker: receives without a page, generic privacy, account binding, revocation and same-origin click passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
