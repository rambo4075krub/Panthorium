'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http'),crypto=require('node:crypto'),{once}=require('node:events');
const {WebSocket,WebSocketServer}=require('ws'),express=require('express');
const {createEdge}=require('../ops/notebook/edge.cjs');
const {installNotebookControl}=require('../services/notebookControl');
const {DiskObjectClient}=require('../services/diskObjectClient');
const {DatabaseSync}=require('node:sqlite');
const listen=async(s)=>{s.listen(0,'127.0.0.1');await once(s,'listening');return s.address().port;};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'panthorium-notebook-'));
 let edge,up,other,controlServer,wss;
 const oldSecret=process.env.PANTHORIUM_DEPLOY_CONTROL_TOKEN;
 try{
  const db=new DatabaseSync(path.join(dir,'objects.sqlite3'));
  db.exec('CREATE TABLE objects(name TEXT PRIMARY KEY,content_type TEXT,created TEXT,updated TEXT,generation TEXT,sha256 TEXT,metadata TEXT,body BLOB)');
  db.close();
  const store=new DiskObjectClient(dir,'private-bucket'),body=Buffer.from([0,255,13,10,42]);
  const root='https://storage.googleapis.com/storage/v1/b/private-bucket/o';
  const name='users/test/a:b?*.bin';
  await store.request({method:'POST',url:'https://storage.googleapis.com/upload/storage/v1/b/private-bucket/o',params:{name,uploadType:'media'},data:body});
  assert.deepEqual((await store.request({method:'GET',url:root+'/'+encodeURIComponent(name),params:{alt:'media'}})).data,body);
  assert.equal((await store.request({method:'GET',url:root,params:{prefix:'users/test/'}})).data.items[0].name,name);
  await assert.rejects(store.request({method:'GET',url:'https://example.com/storage/v1/b/private-bucket/o'}),/unexpected_object_endpoint/);
  await store.request({method:'DELETE',url:root+'/'+encodeURIComponent(name)});
  await assert.rejects(store.request({method:'GET',url:root+'/'+encodeURIComponent(name),params:{alt:'media'}}),/object_not_found/);
  store.db.close();
  up=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   res.setHeader('content-type','application/json');res.end(JSON.stringify({method:req.method,ip:req.headers['x-forwarded-for'],digest:crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex')}));
  });});
  const port=await listen(up);
  wss=new WebSocketServer({server:up});wss.on('connection',s=>s.on('message',v=>s.send(v)));
  other=http.createServer((req,res)=>res.end('second-release'));const second=await listen(other);
  const file=path.join(dir,'active.json');fs.writeFileSync(file,JSON.stringify({port,maintenance:false}));
  edge=createEdge(file,[port,second]);const eport=await listen(edge),base='http://127.0.0.1:'+eport;
  const payload=crypto.randomBytes(256*1024),response=await fetch(base+'/stream',{method:'POST',headers:{'x-forwarded-for':'203.0.113.9'},body:payload});
  assert.equal(response.status,200);const value=await response.json();assert.equal(value.method,'POST');assert.equal(value.ip,'203.0.113.9');assert.equal(value.digest,crypto.createHash('sha256').update(payload).digest('hex'));
  for(const suffix of ['/__notebook/shutdown','/%5f%5fnotebook/shutdown'])assert.equal((await fetch(base+suffix,{method:'POST'})).status,404);
  const ws=new WebSocket('ws://127.0.0.1:'+eport+'/voice');await once(ws,'open');const received=once(ws,'message');ws.send('streaming-voice');assert.equal((await received)[0].toString(),'streaming-voice');ws.close();await once(ws,'close');
  fs.writeFileSync(file,JSON.stringify({port,maintenance:true}));assert.equal((await fetch(base+'/')).status,503);
  fs.writeFileSync(file,JSON.stringify({port:1,maintenance:false}));assert.equal((await fetch(base+'/')).status,503);
  fs.writeFileSync(file,JSON.stringify({port:second,maintenance:false}));assert.equal(await (await fetch(base+'/')).text(),'second-release');
  process.env.PANTHORIUM_DEPLOY_CONTROL_TOKEN=crypto.randomBytes(32).toString('hex');
  const app=express(),control=installNotebookControl(app);let calls=0;control.setShutdown(()=>{calls++;});
  controlServer=http.createServer(app);const cport=await listen(controlServer),url='http://127.0.0.1:'+cport+'/__notebook/shutdown';
  assert.equal((await fetch(url,{method:'POST'})).status,404);
  assert.equal((await fetch(url,{method:'POST',headers:{'x-panthorium-control':'x'.repeat(64)}})).status,404);
  assert.equal((await fetch(url,{method:'POST',headers:{'x-panthorium-control':process.env.PANTHORIUM_DEPLOY_CONTROL_TOKEN}})).status,202);
  await new Promise(r=>setTimeout(r,25));assert.equal(calls,1);
  console.log('PASS notebook object storage, HTTP streaming, WebSocket forwarding, maintenance, release switching and private shutdown');
 }finally{
  if(oldSecret===undefined)delete process.env.PANTHORIUM_DEPLOY_CONTROL_TOKEN;else process.env.PANTHORIUM_DEPLOY_CONTROL_TOKEN=oldSecret;
  edge?.shutdown();for(const s of [up,other,controlServer]){s?.closeAllConnections();s?.close();}
  wss?.close();fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
