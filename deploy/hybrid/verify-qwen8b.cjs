'use strict';
// Post-deploy wiring/access verification. Does not claim inference quality or send messages.
const {createRequire}=require('node:module');
const req=createRequire(process.env.TEST_RELEASE+'/server.js');
const {Pool}=req('pg'),bcrypt=req('bcryptjs');
const {randomUUID,randomBytes}=require('node:crypto'),assert=require('node:assert/strict');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const base='http://127.0.0.1:8790',fixtures=[],results=[];
async function api(path,token,body){
 const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 return{status:r.status,data:await r.json()};
}
(async()=>{
 const health=await api('/api/health');assert.equal(health.status,200);assert.equal(health.data.deployment.sha,process.env.TEST_EXPECTED_SHA);
 for(const admin of [false,true]){
  const f={id:randomUUID(),order:randomUUID(),username:'qwen8b_test_'+randomBytes(8).toString('hex'),password:randomBytes(24).toString('hex')};fixtures.push(f);
  await pool.query('insert into panthorium_users(id,username,password_hash,roles,permissions) values($1,$2,$3,$4,$5)',[f.id,f.username,await bcrypt.hash(f.password,10),JSON.stringify(admin?['administrator']:[]),JSON.stringify(['chat','system:read'])]);
  await pool.query("insert into panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at) values($1,$2,'8b-test',$3,now(),now()+interval '10 minutes')",[f.order,f.id,JSON.stringify({category:'membership',quotas:{aiCredits:0}})]);
  const login=await api('/api/auth/login',null,{username:f.username,password:f.password});assert.equal(login.status,200);const token=login.data.accessToken;assert(token);
  const policy=await api('/api/hybrid/status',token);assert.equal(policy.status,200);assert.equal(policy.data.local.enabled,admin);
  if(admin){
   assert.equal(policy.data.local.model,'Qwen3-8B-Q4_K_M');assert.equal(policy.data.local.vision,false);
   assert.deepEqual(policy.data.local.capabilities,['text','thinking','tool-calling']);assert.equal(policy.data.primary,'local');
   results.push({test:'authorized 8B wiring',ready:policy.data.local.ready,reason:policy.data.local.reason,model:policy.data.local.model});
  }else{
   assert.equal(policy.data.primary,null);assert.equal(policy.data.local.model,undefined);
   for(const [path,body]of [['/api/local/chat',{message:'test'}],['/api/hybrid/speech',{text:'test'}],['/api/hybrid/transcribe',{audio:'data:audio/webm;base64,AQID'}]])assert.equal((await api(path,token,body)).status,403,path);
   results.push({test:'ordinary account denied for chat, speech and ASR',passed:true});
  }
  const used=(await pool.query('select used from panthorium_entitlement_grants where order_id=$1',[f.order])).rows[0].used;assert.deepEqual(used,{});
 }
 assert.equal((await api('/api/local/chat',null,{message:'test'})).status,401);
 console.log(JSON.stringify({passed:true,sha:process.env.TEST_EXPECTED_SHA,inferenceTested:false,results}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{
 for(const f of fixtures){
  await pool.query('delete from panthorium_conversation_messages where user_id=$1',[f.id]);
  await pool.query('delete from panthorium_entitlement_grants where order_id=$1 and user_id=$2',[f.order,f.id]);
  await pool.query('delete from panthorium_users where id=$1 and username=$2',[f.id,f.username]);
 }
 await pool.end();
});
