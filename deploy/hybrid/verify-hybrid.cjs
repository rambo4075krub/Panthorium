'use strict';
const {createRequire}=require('node:module');
const req=createRequire(process.env.TEST_RELEASE+'/server.js');
const {Pool}=req('pg'),bcrypt=req('bcryptjs');
const {randomUUID,randomBytes}=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chunks}=req('./speech-buffer.js');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:false});
const base=process.env.TEST_BASE;const id=randomUUID(),order=randomUUID(),username='hybrid_test_'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
let token;const results=[];let healthTimer;const health=[];
async function api(path,body){const t=performance.now();const r=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(170000)});const data=r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer());return{status:r.status,data,ms:Math.round(performance.now()-t)};}
(async()=>{
 await pool.query("insert into panthorium_users(id,username,password_hash,roles,permissions) values($1,$2,$3,'[]','[\"chat\",\"system:read\"]')",[id,username,await bcrypt.hash(password,10)]);
 await pool.query("insert into panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at) values($1,$2,'hybrid-test',$3,now(),now()+interval '20 minutes')",[order,id,JSON.stringify({category:'membership',quotas:{aiCredits:0}})]);
 const login=await api('/api/auth/login',{username,password});token=login.data.accessToken;assert(token,'fixture login');
 healthTimer=setInterval(async()=>{const t=performance.now();try{const r=await fetch('http://127.0.0.1:8790/api/health',{signal:AbortSignal.timeout(3000)});health.push({ok:r.ok,ms:Math.round(performance.now()-t)});}catch{health.push({ok:false});}},1000);
 const policy=await api('/api/hybrid/status');assert.equal(policy.data.geminiAllowed,false);assert.equal(policy.data.primary,'local');results.push({test:'zero-credit policy',...policy});
 for(const [name,message,tool] of [
 ['Thai greeting','สวัสดี แนะนำตัวสั้น ๆ หนึ่งประโยค',false],
 ['decimal answer','ของราคา 546.02 บาท ลด 10 บาท เหลือเท่าไร ตอบสั้น ๆ',false],
 ['API tool','เรียกเครื่องมือ panthorium_system_status เพื่ออ่านสถานะระบบจริง แล้วสรุปสั้น ๆ ห้ามเดา',true],
 ['MCP tools','เรียก panthorium_mcp_list เพื่อดูเครื่องมือ MCP ที่ฉันมีสิทธิ์ แล้วบอกชื่อมาสามรายการ',true],
 ['long voice','อธิบายวิธีดูแลโน้ตบุ๊กที่ใช้เป็นเซิร์ฟเวอร์เป็นภาษาไทย 5 ประโยค ไม่ต้องเรียกเครื่องมือ',false]]){
  const r=await api('/api/local/chat',{message,voice:true,requestId:randomUUID()});results.push({test:name,...r});
  fs.writeFileSync(process.env.TEST_RESULT,JSON.stringify({results,health},null,2));
  assert.equal(r.status,200,name+': '+JSON.stringify(r.data));assert.equal(r.data.provider,'local');assert.equal(r.data.creditsCharged,0);if(name==='decimal answer'){assert.match(r.data.text,/536\.02/,'decimal arithmetic must be correct');assert(r.data.functionCallCount>0,'calculator must execute for arithmetic');}if(tool)assert(r.data.functionCallCount>0,'tool not invoked '+name);
 }
 const unchanged=(await pool.query('select used from panthorium_entitlement_grants where order_id=$1',[order])).rows[0].used;assert.deepEqual(unchanged,{});
 const fallback=await api('/api/chat',{message:'ตอบคำเดียวว่า สวัสดี',voice:true,requestId:randomUUID()});assert.equal(fallback.data.provider,'local');results.push({test:'automatic zero-credit fallback',...fallback});
 const long=results.find(r=>r.test==='long voice').data.text;
 const sounds=[];for(const text of chunks(long)){const r=await api('/api/hybrid/speech',{text});assert.equal(r.status,200);assert.equal(r.data.subarray(0,4).toString(),'RIFF');sounds.push({chars:text.length,bytes:r.data.length,ms:r.ms});}
 results.push({test:'authenticated local TTS',clips:sounds});
 // Test a real Gemini completion and its actual credit debit on a test grant.
 if(process.env.TEST_GEMINI==='1'){
  await pool.query("update panthorium_entitlement_grants set snapshot=$2 where order_id=$1",[order,JSON.stringify({category:'membership',quotas:{aiCredits:100000}})]);
  const live=await api('/api/chat',{message:'ตอบสั้น ๆ ว่า สวัสดี',provider:'gemini-live',voice:true,requestId:randomUUID()});results.push({test:'Gemini actual debit',...live});assert.equal(live.data.provider,'gemini-live');assert.equal(live.data.ok,true);
  const spent=(await pool.query('select used from panthorium_entitlement_grants where order_id=$1',[order])).rows[0].used;assert(spent.aiCredits>0);results.at(-1).debit=spent.aiCredits;
  const mcp=await api('/api/chat',{message:'เรียก panthorium_mcp_call ด้วย name panthorium_profile และ argumentsJson {} เพื่อตรวจโปรไฟล์ผ่าน MCP แล้วตอบสั้น ๆ ว่าตรวจสำเร็จหรือไม่',provider:'gemini-live',voice:true,requestId:randomUUID()});results.push({test:'Gemini MCP actual call',...mcp});assert.equal(mcp.data.provider,'gemini-live');assert.equal(mcp.data.ok,true);assert(mcp.data.toolResults?.some(t=>t.toolId==='mcp.read'&&t.ok),'Gemini must execute MCP with current account identity');
 }
 assert(health.every(r=>r.ok),'primary health during inference');
 console.log(JSON.stringify({passed:true,cases:results.map(r=>({test:r.test,ms:r.ms,provider:r.data?.provider,tools:r.data?.functionCallCount,debit:r.debit,clips:r.clips})),healthSamples:health.length,maxHealthMs:Math.max(...health.map(h=>h.ms||0))}));
})().catch(error=>{results.push({error:error.message});console.error(error.message);process.exitCode=1;}).finally(async()=>{
 clearInterval(healthTimer);fs.writeFileSync(process.env.TEST_RESULT,JSON.stringify({results,health},null,2));
 await pool.query('delete from panthorium_conversation_messages where user_id=$1',[id]);
 await pool.query('delete from panthorium_entitlement_grants where order_id=$1 and user_id=$2',[order,id]);
 await pool.query('delete from panthorium_users where id=$1 and username=$2',[id,username]);await pool.end();
});
