const {createRequire}=require('node:module');
const req=createRequire(process.env.TEST_RELEASE+'/server.js');
const crypto=require('node:crypto'), fs=require('node:fs'),assert=require('node:assert/strict');
const {Pool}=req('pg'),bcrypt=req('bcryptjs');
const base=process.env.TEST_BASE||('http://127.0.0.1:'+process.env.TEST_PORT),stage=process.env.TEST_STAGE;
const url=process.env.TEST_DB, pool=new Pool({connectionString:url,ssl:false});
const {DatabaseSync}=require('node:sqlite');
const objects=new DatabaseSync(process.env.TEST_UPLOADS,{readOnly:true});
const people=[]; let created=null,token=null;
async function login(person){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:person.user,password:person.pw})});const j=await r.json();if(!r.ok||!j.accessToken)throw Error('login '+r.status+' '+String(j.error||''));return j.accessToken;}
function headers(t){return {authorization:'Bearer '+t};}
async function main(){
 const health=await (await fetch(base+'/api/health')).json();assert.equal(health.release,'notebook-'+stage+'-'+process.env.TEST_SHA.slice(0,12));assert.equal(health.deployment.sha,process.env.TEST_SHA);
 assert.match((await pool.query('select inet_server_addr()::text as host')).rows[0].host,/^127\.0\.0\.1/);
 const noauth=await fetch(base+'/api/files');assert.equal(noauth.status,401);
 for(let i=0;i<2;i++){let p={id:crypto.randomUUID(),user:'verify_'+crypto.randomBytes(8).toString('hex'),pw:crypto.randomBytes(24).toString('hex')};
 await pool.query("insert into panthorium_users(id,username,password_hash,roles,permissions) values($1,$2,$3,'[]','[\"chat\"]')",[p.id,p.user,await bcrypt.hash(p.pw,10)]);people.push(p);}
 token=await login(people[0]);const tokenB=await login(people[1]);
 const body=Buffer.from('Panthorium '+crypto.randomUUID()+' เธชเธงเธฑเธชเธ”เธต'),name='เธ•เธฃเธงเธเธชเธญเธ.txt';
 const up=await fetch(base+'/api/files',{method:'POST',headers:{...headers(token),'content-type':'application/octet-stream','x-file-name':encodeURIComponent(name),'x-file-content-type':'text/plain'},body});let u=await up.json();if(up.status!==201)throw Error('upload '+up.status+' '+u.error);
 created=u.file.id;
 const stored=objects.prepare('select body from objects where name=?').get('users/'+people[0].id+'/files/'+created+'/'+name);assert(stored);assert.deepEqual(Buffer.from(stored.body),body);
 const list=await fetch(base+'/api/files',{headers:headers(token)});assert.equal(list.status,200);assert((await list.text()).includes(created));
 const free=await fetch(base+'/api/files/'+created,{headers:headers(token)});assert.equal(free.status,402);
 await pool.query("insert into panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at) values($1,$2,'local-test',$3,now(),now()+interval '10 minutes')",[crypto.randomUUID(),people[0].id,JSON.stringify({category:'addon',quotas:{downloadBytes:2048}})]);
 for(const path of ['/preview','']){const r=await fetch(base+'/api/files/'+created+path,{headers:headers(token)});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),body);}
 const other=await fetch(base+'/api/files/'+created,{headers:headers(tokenB)});assert.equal(other.status,404);
 const del=await fetch(base+'/api/files/'+created,{method:'DELETE',headers:headers(token)});assert.equal(del.status,200);
 assert.equal((await fetch(base+'/api/files/'+created,{headers:headers(token)})).status,404);created=null;
 console.log(stage+' HTTP login/upload/disk-bytes/list/preview/download/delete/cross-owner/anonymous passed');
 if(stage==='production' && process.env.TEST_INFERENCE==='1'){const ai=await fetch(base+'/api/local/chat',{method:'POST',headers:{...headers(token),'content-type':'application/json'},body:JSON.stringify({message:'What is 2 + 3? Reply with just the number.'}),signal:AbortSignal.timeout(100000)});const result=await ai.json();if(!ai.ok||!String(result.text).includes('5'))throw Error('local AI test '+ai.status+' '+String(result.error||''));console.log('Authenticated Qwen 4B answer verified');}
}
main().catch(e=>{console.error('Verification failed: '+e.message.slice(0,200));process.exitCode=1}).finally(async()=>{
 if(created&&token)await fetch(base+'/api/files/'+created,{method:'DELETE',headers:headers(token)}).catch(()=>{});
 for(const p of people)await pool.query('delete from panthorium_entitlement_grants where user_id=$1 and product_id=$2',[p.id,'local-test']); for(const p of people)await pool.query('delete from panthorium_users where id=$1 and username=$2',[p.id,p.user]);objects.close();await pool.end();
});