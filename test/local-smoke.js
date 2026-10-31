'use strict';
const assert=require('node:assert/strict');
const base='http://127.0.0.1:8787';
(async()=>{
 const health=await fetch(base+'/api/health');assert.equal(health.status,200);
 const h=await health.json();assert.equal(h.aiMode,'local-only');assert.equal(h.geminiLiveEnabled,false);
 for(const path of ['/','/local-ai']){const r=await fetch(base+path);assert.equal(r.status,200);assert.match(await r.text(),/Panthorium/);}
 const unauth=await fetch(base+'/api/local/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'hello'})});assert.equal(unauth.status,401);
 for(const path of ['/api/chat','/api/agent/run','/api/speech','/internal/jobs']){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,503);}
 const profile=JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../../panthorium-state/local-profile.json'),'utf8')); const session=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:profile.username,password:profile.password})});assert.equal(session.status,200);const auth=await session.json();assert.ok(auth.accessToken);
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+auth.accessToken};
 const providers=await fetch(base+'/api/ai/providers',{headers});assert.equal(providers.status,200);assert.deepEqual((await providers.json()).providers.map(p=>p.provider),['local']);
 if(process.argv.includes('--inference')){
  const started=Date.now();const response=await fetch(base+'/api/local/chat',{method:'POST',headers,body:JSON.stringify({message:'ตอบเป็นภาษาไทยสั้น ๆ ว่า 2 บวก 3 เท่ากับเท่าไร'}),signal:AbortSignal.timeout(100000)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.provider,'local');assert.equal(result.actionsEnabled,false);assert.ok(result.text.length>0);
  console.log(JSON.stringify({inference:'pass',elapsedMs:Date.now()-started,model:result.model,text:result.text}));
 }
 console.log('PASS local HTTP health/homepage/auth/provider catalog and action restrictions');
})().catch(error=>{console.error(error);process.exitCode=1;});
