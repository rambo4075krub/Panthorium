'use strict';
// Post-deploy wiring/access verification; optional real inference uses synthetic accounts.
const {createRequire}=require('node:module');
const req=createRequire(process.env.TEST_RELEASE+'/server.js');
const {Pool}=req('pg'),bcrypt=req('bcryptjs');
const {randomUUID,randomBytes}=require('node:crypto'),assert=require('node:assert/strict');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const profile=require('./model-profile.json');
const base=process.env.TEST_BASE||'http://127.0.0.1:8790',fixtures=[],results=[];
async function api(path,token,body){
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(process.env.TEST_INFERENCE==='1'?180000:15000)});
 return{status:r.status,data:await r.json()};
}
(async()=>{
 const health=await api('/api/health');assert.equal(health.status,200);assert.equal(health.data.deployment.sha,process.env.TEST_EXPECTED_SHA);
 const positiveOnly=process.env.TEST_POSITIVE_ONLY==='1';
 for(const admin of positiveOnly?[true]:[false,true]){
  const f={id:randomUUID(),order:randomUUID(),username:'qwen8b_test_'+randomBytes(8).toString('hex'),password:randomBytes(24).toString('hex')};fixtures.push(f);
  await pool.query('insert into panthorium_users(id,username,password_hash,roles,permissions) values($1,$2,$3,$4,$5)',[f.id,f.username,await bcrypt.hash(f.password,10),JSON.stringify(admin?['administrator']:[]),JSON.stringify(['chat','system:read'])]);
  await pool.query("insert into panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at) values($1,$2,'8b-test',$3,now(),now()+interval '10 minutes')",[f.order,f.id,JSON.stringify({category:'membership',quotas:{aiCredits:0}})]);
  const login=await api('/api/auth/login',null,{username:f.username,password:f.password});assert.equal(login.status,200);const token=login.data.accessToken;assert(token);
  const policy=await api('/api/hybrid/status',token);assert.equal(policy.status,200);assert.equal(policy.data.local.enabled,admin);
  if(admin){
   assert.equal(policy.data.local.model,profile.name);assert.equal(policy.data.local.vision,profile.vision);
   assert.deepEqual(policy.data.local.capabilities,profile.capabilities);assert.equal(policy.data.primary,'local');
   results.push({test:'authorized model wiring',ready:policy.data.local.ready,reason:policy.data.local.reason,model:policy.data.local.model});
   if(process.env.TEST_INFERENCE==='1'){
    for(const message of ['ตอบสั้น ๆ ว่า ทดสอบสำเร็จ','ของราคา 546.02 บาท ลด 10 บาท เหลือเท่าไร ตอบสั้น ๆ']){
     const start=Date.now();const answer=await api('/api/local/chat',token,{message,voice:true,requestId:randomUUID()});
     assert.equal(answer.status,200,JSON.stringify(answer.data));assert.equal(answer.data.provider,'local');
     assert.equal(answer.data.creditsCharged,0);assert.ok(answer.data.text?.trim());
     if(message.includes('546.02')){assert.match(answer.data.text,/536\.02/);assert.ok(answer.data.functionCallCount>0);}
     results.push({test:'authenticated real inference',text:answer.data.text,tools:answer.data.functionCallCount,ms:Date.now()-start});
    }
   }
   if(process.env.TEST_RESOURCE_DENIAL==='1'){
    assert.equal(policy.data.local.ready,false,'Resource denial probe requires a paused model');
    assert.ok(policy.data.local.resources.ramTotalBytes>0);
    const start=Date.now(),denied=await api('/api/local/chat',token,{message:'Reply only with the number 5.'});
    const elapsedMs=Date.now()-start;
    assert.equal(denied.status,503);assert.match(denied.data.error,/^local_resource_(ram_headroom|ram_pressure|vram_pressure|gpu_metrics_unavailable|resource_monitor_unavailable|model_not_installed)$/);
    assert.equal(denied.data.creditsCharged,0);assert.equal(denied.data.billable,false);
    assert.ok(elapsedMs<10000,'Resource refusal unexpectedly waited in the queue');
    results.push({test:'immediate resource refusal without billing',elapsedMs,error:denied.data.error,creditsCharged:denied.data.creditsCharged});
   }
  }else{
   assert.equal(policy.data.primary,null);assert.equal(policy.data.local.model,undefined);
   for(const [path,body]of [['/api/local/chat',{message:'test'}],['/api/hybrid/speech',{text:'test'}],['/api/hybrid/transcribe',{audio:'data:audio/webm;base64,AQID'}]])assert.equal((await api(path,token,body)).status,403,path);
   results.push({test:'ordinary account denied for chat, speech and ASR',passed:true});
  }
  const used=(await pool.query('select used from panthorium_entitlement_grants where order_id=$1',[f.order])).rows[0].used;assert.deepEqual(used,{});
 }
 if(!positiveOnly)assert.equal((await api('/api/local/chat',null,{message:'test'})).status,401);
 console.log(JSON.stringify({passed:true,sha:process.env.TEST_EXPECTED_SHA,inferenceTested:process.env.TEST_INFERENCE==='1',results}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{
 for(const f of fixtures){
  await pool.query('delete from panthorium_conversation_messages where user_id=$1',[f.id]);
  await pool.query('delete from panthorium_entitlement_grants where order_id=$1 and user_id=$2',[f.order,f.id]);
  await pool.query('delete from panthorium_users where id=$1 and username=$2',[f.id,f.username]);
 }
 await pool.end();
});
