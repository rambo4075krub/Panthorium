'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const {CreativeStudioService}=require('../services/creativeStudioService');
const {MemoryCreativeStudioRepository}=require('../services/creativeStudioRepository');
const {OfficeArtifactService}=require('../services/officeArtifactService');
const {createCreativeStudioRouter}=require('../routes/creativeStudio');
(async()=>{
  const users={one:{sub:crypto.randomUUID(),roles:[],permissions:['chat']},two:{sub:crypto.randomUUID(),roles:[],permissions:['chat']},guest:{sub:crypto.randomUUID(),roles:['guest'],permissions:['chat']}};
  const auth={verifyAccessToken(token){if(!users[token])throw new Error('invalid');return users[token];},async validateAccountPrincipal(user){return user;}};
  const artifacts=new Map();let uploads=0;
  const files={bucket:'test-bucket',ensureConfigured(){},async upload(owner,name,contentType,body){uploads++;const file={id:crypto.randomUUID(),name,contentType,size:body.length};artifacts.set(file.id,{...file,owner,body});return file;},async findObject(owner,id){const item=artifacts.get(id);if(!item||item.owner!==owner)throw new Error('file_not_found');const {body,owner:unused,...file}=item;return file;},async download(owner,id){return {...await this.findObject(owner,id),body:artifacts.get(id).body};}};
  const gateway={async complete(){return {ok:true,text:JSON.stringify({title:'รายงาน',sections:[{heading:'สรุป',paragraphs:['ข้อมูลสำหรับเอกสารภาษาไทย']}]})};}};
  const service=new CreativeStudioService({repository:new MemoryCreativeStudioRepository(),files,gateway,office:new OfficeArtifactService({files,gateway}),resolveUser:async user=>user});await service.init();
  const app=express();app.use(express.json());app.use('/api/studio',createCreativeStudioRouter(auth,service));
  app.use((error,req,res,next)=>res.status(500).json({ok:false,error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port+'/api/studio';
  const request=async(path,{token='one',method='GET',body}={})=>{const result=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:result.status,body:await result.json()};};
  try{
    assert.equal((await request('/catalog',{token:null})).status,401);assert.equal((await request('/catalog',{token:'guest'})).status,403);
    const body={pluginId:'document',input:{prompt:'ทำเอกสารไทย',name:''},idempotencyKey:'http-request-01'};
    const first=await request('/jobs',{method:'POST',body});assert.equal(first.status,200);assert.equal(first.body.job.status,'completed');assert.equal(first.body.job.files.length,2);assert.equal(uploads,2);
    // Exercise the real Office ↔ Studio boundary with the same input the UI sends.
    assert.ok(first.body.job.files.some(file=>file.name.endsWith('.docx')));assert.ok(first.body.job.files.some(file=>file.name.endsWith('.print.html')));
    const replay=await request('/jobs',{method:'POST',body});assert.equal(replay.body.job.id,first.body.job.id);assert.equal(uploads,2);
    assert.equal((await request('/jobs/'+first.body.job.id,{token:'two'})).status,404);
    assert.deepEqual((await request('/jobs',{token:'two'})).body.jobs,[]);
    const docId=first.body.job.files.find(f=>f.name.endsWith('.docx')).id, draftPath='/editor/'+docId+'/draft';
    assert.equal((await request(draftPath)).body.version,0);
    const draftBody={version:0,revision:'a'.repeat(64),name:'ร่าง',operations:[{type:'format_text',index:0,style:{bold:true}}]};
    assert.equal((await request(draftPath,{method:'PUT',body:draftBody})).status,200);
    assert.equal((await request(draftPath)).body.data.operations[0].type,'format_text');
    assert.equal((await request(draftPath,{method:'PUT',body:draftBody})).status,409);
    assert.equal((await request(draftPath,{token:'guest'})).status,403);
    assert.equal((await request(draftPath,{token:null})).status,401);
    assert.equal((await request(draftPath,{method:'PUT',body:{...draftBody,version:1,operations:[]}})).body.data,null);
    const denied=await request('/plugins/document/mode',{method:'PUT',body:{mode:'never'}});assert.equal(denied.status,200);
    assert.equal((await request('/jobs',{method:'POST',body:{...body,idempotencyKey:'http-request-disabled'}})).status,403);
    await request('/plugins/document/mode',{method:'PUT',body:{mode:'auto'}});
    assert.equal((await request('/jobs',{method:'POST',body:{...body,idempotencyKey:'http-request-unknown',organizationId:'foreign'}})).status,400);
    const flow=await request('/jobs',{method:'POST',body:{idempotencyKey:'http-workflow-01',steps:[{pluginId:'document',input:{prompt:'รายงานแรก',name:'แรก'}},{pluginId:'document',input:{prompt:'สรุปรายงาน'},usePrevious:true}]}});assert.equal(flow.status,202);assert.equal(flow.body.job.status,'queued');const before=uploads;
    const read=await request('/jobs/'+flow.body.job.id);assert.equal(read.body.job.status,'queued');assert.equal(uploads,before);
    const advance=await request('/jobs/'+flow.body.job.id+'/advance',{method:'POST'});assert.equal(advance.body.job.status,'completed');assert.equal(uploads,before+2);
    assert.equal((await request('/jobs/'+flow.body.job.id+'/advance',{token:'two',method:'POST'})).status,404);
    console.log('creative studio HTTP: auth, owner isolation, policy, idempotency, read-only GET and real Office boundary passed');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
