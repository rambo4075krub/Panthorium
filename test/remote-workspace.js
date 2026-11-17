'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const {RemoteWorkspaceRepository}=require('../services/remoteWorkspaceRepository');
const {RemoteWorkspaceService,remoteWorkspaceContext}=require('../services/remoteWorkspaceService');
const {RemoteAgentCore}=require('../electron/remote-agent-core.cjs');
const {validateSteps}=require('../services/remoteWorkspaceProtocol');
const {createRemoteWorkspaceRouter}=require('../routes/remoteWorkspace');

async function run({pool}={}) {
  let now=Date.now();const uid=randomUUID(),other=randomUUID();
  const users={a:{sub:uid,roles:['user'],permissions:['chat'],accountVersion:1},b:{sub:other,roles:['user'],permissions:['chat'],accountVersion:1}};
  const limits=new Map([[uid,1024*1024],[other,100000]]),notices=[];let suspended=false;
  const repository=new RemoteWorkspaceRepository({pool,now:()=>now});
  const service=new RemoteWorkspaceService({repository,now:()=>now,secret:'remote-workspace-test-secret-not-production',
    entitlements:{state:async id=>({plan:'fixture',remaining:{storageBytes:limits.get(id)||100000}})},
    notifications:{publish:async n=>notices.push(n)},validatePrincipal:async p=>{if(suspended)throw Object.assign(Error('account_suspended'),{status:403});return {...users.a,...p};}});
  await service.init();
  const app=express();app.use(express.json({limit:'2mb'}));app.use('/api/remote',createRemoteWorkspaceRouter({verifyAccessToken:t=>{if(!users[t])throw Error('bad_token');return users[t];}},service));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/api/remote';
  const http=async(route,body,token='a',method='POST')=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:token.startsWith('Device ')?token:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,...await response.json()};};
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'panthorium-owned-'));
  try {
    const pair=await http('/pairing/start',{name:'Home test computer',platform:process.platform,scopes:['files.read','files.write','files.delete','process.run','chat.sync'],autoScopes:['files.read','chat.sync']},'');
    assert.equal(pair.ok,true);assert.equal((await http('/pairing/confirm',{code:pair.code})).ok,true);
    assert.equal((await http('/pairing/confirm',{code:pair.code},'b')).status,409,'a pairing cannot be claimed by a second account');
    const paired=await http('/pairing/status',{pairingId:pair.pairingId,deviceSecret:pair.deviceSecret},'');
    const credentials='Device '+paired.deviceId+':'+pair.deviceSecret;
    assert.equal((await http('/agent/poll',{workspaceBytes:0},credentials+'bad')).status,401);
    const device=await service.authenticateDevice(paired.deviceId,pair.deviceSecret);
    assert.equal((await http('/devices',undefined,'b','GET')).devices.length,0);
    const steps=[{op:'files.write',args:{path:'report.txt',content:'private owner report'}},{op:'files.read',args:{path:'report.txt'}}];
    const chatId='personal-'+randomUUID();
    const proposal=await remoteWorkspaceContext.run({userId:uid,sessionId:chatId},()=>service.submit(users.a,{deviceId:device.id,title:'Write a real local report',steps},'one-request'));
    assert.equal(proposal.chatId,chatId);assert.equal(proposal.state,'awaiting_confirmation');
    const repeat=await remoteWorkspaceContext.run({userId:uid,sessionId:chatId},()=>service.submit(users.a,{deviceId:device.id,title:'Write a real local report',steps},'one-request'));
    assert.equal(repeat.id,proposal.id);
    assert.equal((await http('/jobs/'+proposal.id,undefined,'b','GET')).status,404);
    assert.equal((await http('/agent/poll',{workspaceBytes:0},credentials)).job,undefined,'no job before approval');
    assert.equal((await http('/jobs/'+proposal.id+'/approve',{approvalHash:'forged'})).status,409);
    assert.equal((await http('/jobs/'+proposal.id+'/approve',{approvalHash:proposal.approvalHash})).job.state,'queued');
    const polls=await Promise.all([service.poll(device,{workspaceBytes:0}),service.poll(device,{workspaceBytes:0})]);
    assert.equal(polls.filter(r=>r.job).length,1,'concurrent pollers cannot claim the same job');
    const leased=polls.find(r=>r.job),core=new RemoteAgentCore({root,userId:uid,scopes:device.scopes,request:async()=>{}});
    await core.init();core.limitBytes=leased.maxWorkspaceBytes;
    const completed=await core.run(leased.job);assert.equal(completed.state,'succeeded');assert.equal(await fs.readFile(path.join(root,'report.txt'),'utf8'),'private owner report');
    const archived=JSON.parse(await fs.readFile(path.join(root,completed.result.archive.path),'utf8'));assert.equal(archived.id,leased.job.id);assert.equal(archived.result.steps[1].output.content,'private owner report');assert((await core.usage())>Buffer.byteLength('private owner report'),'result archives count toward the owner quota');
    const replay=await core.run(leased.job);assert.equal(replay.state,'succeeded','journal prevents executing the non-overwriting write twice');
    const resultBody={state:completed.state,leaseToken:completed.leaseToken,result:completed.result,workspaceBytes:await core.usage()};
    const ack=await http('/agent/jobs/'+proposal.id+'/result',resultBody,credentials);assert.equal(ack.job.state,'succeeded');
    assert.equal((await http('/agent/jobs/'+proposal.id+'/result',resultBody,credentials)).job.state,'succeeded');
    assert.equal((await http('/jobs/'+proposal.id,undefined,'a','GET')).job.result.steps[1].output.content,'private owner report');
    const stored=await repository.get('job',proposal.id,uid);assert(!JSON.stringify(stored).includes('private owner report'),'transit result must be encrypted at rest');assert(!stored.payload,'completed command envelope is removed');
    assert.equal((await http('/jobs/'+proposal.id,undefined,'b','GET')).status,404);
    now+=16*60000;await repository.cleanup();assert.equal((await service.job(users.a,proposal.id,{result:true})).result,undefined,'transit payload expires');assert.equal((await service.job(users.a,proposal.id)).state,'succeeded','routing receipt survives');
    const read=await service.submit(users.a,{deviceId:device.id,title:'Read after reconnect',steps:[{op:'files.read',args:{path:'report.txt'}}]},'read-once');assert.equal(read.state,'queued');
    const first=await service.poll(device,{workspaceBytes:await core.usage()});assert.equal(first.job.id,read.id);
    now+=46000;assert.equal((await service.poll(device,{workspaceBytes:0})).job,undefined,'expired lease is not replayed');
    assert.equal((await service.job(users.a,read.id)).state,'unknown');
    await service.complete(device,read.id,{state:'unknown',leaseToken:first.job.leaseToken,result:{inactive:true,error:'execution_outcome_unknown'},workspaceBytes:await core.usage()});
    const next=await service.submit(users.a,{deviceId:device.id,title:'Next safe read',steps:[{op:'files.read',args:{path:'report.txt'}}]});
    const after=await service.poll(device,{workspaceBytes:await core.usage()});assert.equal(after.job.id,next.id,'an acknowledged inactive unknown outcome does not block unrelated future work');
    await service.cancel(users.a,next.id);assert.equal((await service.poll(device,{workspaceBytes:0,jobId:next.id,leaseToken:after.job.leaseToken})).cancelRequested,true);
    await service.complete(device,next.id,{state:'cancelled',leaseToken:after.job.leaseToken,result:{},workspaceBytes:0});
    // A user-owned chat is indexed centrally, but its contents live in their vault.
    const threadId='personal-'+randomUUID(),thread={id:threadId,owner:uid,title:'Voice conversation',messages:[{role:'user',content:'เสียงส่วนตัว'}],serverVersion:1};
    await service.putThread(users.a,{id:threadId,title:thread.title,bytes:Buffer.byteLength(JSON.stringify(thread)),version:0,channel:'voice',vaultId:'device:'+device.id});
    const sync=await service.syncChat(users.a,threadId,JSON.stringify(thread));const syncLease=await service.poll(device,{workspaceBytes:0});assert.equal(syncLease.job.id,sync.id);
    core.running=null;core.limitBytes=syncLease.maxWorkspaceBytes;const saved=await core.run(syncLease.job);assert.equal(saved.state,'succeeded');
    await service.complete(device,sync.id,{state:saved.state,leaseToken:saved.leaseToken,result:saved.result,workspaceBytes:await core.usage()});
    assert.equal((await service.threads(users.a)).find(t=>t.id===threadId).syncedVersion,1);
    assert(!JSON.stringify(await repository.get('thread',threadId,uid)).includes('เสียงส่วนตัว'));
    const retrieve=await service.retrieveChat(users.a,threadId),fetchLease=await service.poll(device,{workspaceBytes:await core.usage()});core.running=null;
    const retrieved=await core.run(fetchLease.job);assert.equal(JSON.parse(retrieved.result.steps[0].output.content).messages[0].content,'เสียงส่วนตัว');
    await service.complete(device,retrieve.id,{state:retrieved.state,leaseToken:retrieved.leaseToken,result:retrieved.result,workspaceBytes:await core.usage()});
    // Frequent voice updates coalesce waiting snapshots without replaying writes.
    thread.serverVersion=2;await service.putThread(users.a,{id:threadId,title:thread.title,bytes:Buffer.byteLength(JSON.stringify(thread)),version:1,channel:'voice',vaultId:'device:'+device.id});
    const older=await service.syncChat(users.a,threadId,JSON.stringify(thread));
    thread.serverVersion=3;await service.putThread(users.a,{id:threadId,title:thread.title,bytes:Buffer.byteLength(JSON.stringify(thread)),version:2,channel:'voice',vaultId:'device:'+device.id});
    const latest=await service.syncChat(users.a,threadId,JSON.stringify(thread));
    assert.equal((await service.job(users.a,older.id)).state,'cancelled');assert.equal((await service.job(users.a,older.id)).superseded,true);
    assert.equal((await service.poll(device,{workspaceBytes:0})).job.id,latest.id);
    const expiringThread='personal-'+randomUUID();await service.putThread(users.a,{id:expiringThread,title:'Expired pending task',bytes:100,version:0,channel:'text',vaultId:'browser:fixture'});await service.submit(users.a,{deviceId:device.id,chatId:expiringThread,title:'Pending read',steps:[{op:'files.read',args:{path:'report.txt'}}]});await assert.rejects(service.deleteThread(users.a,expiringThread),/chat_has_active_jobs/);now+=24*3600000+1;await service.deleteThread(users.a,expiringThread);
    // Atomic accounting, package expiry, and notifications are account-scoped.
    const makeThread=bytes=>({id:'personal-'+randomUUID(),title:'Quota fixture',bytes,version:0,channel:'text',vaultId:'browser:test'});
    const writes=await Promise.allSettled([service.putThread(users.b,makeThread(80000)),service.putThread(users.b,makeThread(80000))]);
    assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);assert.equal(writes.filter(r=>r.status==='rejected')[0].reason.code,'personal_storage_full');
    assert(notices.some(n=>n.userId===other&&n.type==='storage.near_full'));
    limits.set(other,50000);assert.equal((await service.quota(users.b)).status,'full');assert.equal((await service.threads(users.b)).length,1,'downgrade must not delete data');
    await service.deleteThread(users.b,(await service.threads(users.b))[0].id);assert.equal((await service.quota(users.b)).usedBytes,0);
    for(const bad of ['../outside','/etc/passwd','C:\\Windows\\system.ini','report.txt:ads','CON','dir/../../escape'])assert.throws(()=>validateSteps([{op:'files.read',args:{path:bad}}]));
    const outside=await fs.mkdtemp(path.join(os.tmpdir(),'panthorium-outside-'));try{await fs.writeFile(path.join(outside,'secret'),'never read');await fs.symlink(outside,path.join(root,'outside'));await assert.rejects(core.executeStep({op:'files.read',args:{path:'outside/secret'}}),/symlink_denied/);}finally{await fs.rm(outside,{recursive:true,force:true});}
    core.limitBytes=0;await assert.rejects(core.executeStep({op:'files.write',args:{path:'too-large.txt',content:'x'}}),/personal_storage_full/);
    suspended=true;assert.equal((await http('/agent/poll',{workspaceBytes:0},credentials)).status,403);suspended=false;
    await service.updateDevice(users.a,device.id,{revoke:true});assert.equal(await repository.get('storage','device:'+device.id,uid),null,'revoking a workspace releases its stale quota accounting');assert.equal((await service.job(users.a,latest.id)).state,'unknown');assert.equal((await service.job(users.a,latest.id)).settled,true);await service.deleteThread(users.a,threadId);assert.equal((await service.quota(users.a)).usedBytes,0);await fs.access(path.join(root,completed.result.archive.path));assert.equal((await http('/agent/poll',{workspaceBytes:0},credentials)).status,401);
    console.log('PASS remote workspace: ownership, local execution, approval, idempotency, lease recovery, encrypted transit expiry, voice archive retrieval, atomic package quotas and revocation');
  } finally {await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});if(pool)await pool.query('DELETE FROM panthorium_remote_workspace WHERE user_id=ANY($1::text[])',[['pairing',uid,other]]);}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
