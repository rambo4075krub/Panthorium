'use strict';
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const catalog = require('../billing-catalog');
const { RemoteWorkspaceRepository } = require('./remoteWorkspaceRepository');
const { ID, THREAD, CAPABILITIES, SCOPES, ACTIVE, hash, fail, owner, text, validateSteps, makeCipher } = require('./remoteWorkspaceProtocol');
const context = new AsyncLocalStorage();
const HOUR=3600000, DAY=24*HOUR;
const sameSecret = (value,digest) => typeof value === 'string' && value.length >= 32 && typeof digest === 'string' && digest.length === 64 && timingSafeEqual(Buffer.from(hash(value),'hex'),Buffer.from(digest,'hex'));
const publicDevice = d => ({ id:d.id,name:d.name,platform:d.platform,scopes:d.scopes,autoScopes:d.autoScopes,
  lastSeenAt:d.lastSeenAt || null,online:false,pairedAt:d.pairedAt,revoked:!!d.revokedAt,workspaceBytes:d.workspaceBytes || 0 });

class RemoteWorkspaceService {
  constructor({ repository, entitlements, notifications, validatePrincipal, secret, now = Date.now, externalUsage } = {}) {
    this.repository=repository || new RemoteWorkspaceRepository({now}); this.entitlements=entitlements;
    this.notifications=notifications; this.validatePrincipal=validatePrincipal; this.now=now;
    this.externalUsage=externalUsage; this.cipher=makeCipher(secret); this.cleanupAt=0;
  }
  async init() { await this.repository.init();await this.maintenance();if(!this.cleanupTimer){this.cleanupTimer=setInterval(()=>this.maintenance().catch(()=>{}),60000);this.cleanupTimer.unref?.();} }
  async maintenance() { if (this.now()-this.cleanupAt<60000) return; this.cleanupAt=this.now(); await this.repository.cleanup(); }
  async plan(userId,client) {
    const state=this.entitlements ? await (client&&this.entitlements.stateIn?this.entitlements.stateIn(client,userId):this.entitlements.state(userId)) : {plan:'free',remaining:{storageBytes:catalog.get('free').quotas.storageBytes}};
    const limit=Number(state.remaining.storageBytes);
    if (!Number.isSafeInteger(limit) || limit<0) fail('storage_entitlement_unavailable',503);
    return {plan:state.plan,limitBytes:limit};
  }
  async budgetIn(userId, plan, client, { excludeJob, externalBytes } = {}) {
    if(client&&this.entitlements?.stateIn)plan=await this.plan(userId,client);
    if(externalBytes===undefined)externalBytes=this.externalUsage?await this.externalUsage(userId):0;
    const items=await this.repository.list('storage',userId,client);
    const jobs=await this.repository.list('job',userId,client);
    const usedBytes=items.reduce((n,item)=>n+item.bytes,0)+externalBytes;
    const reservedBytes=jobs.filter(job=>job.id!==excludeJob && ACTIVE.has(job.state) && !job.settled && job.expiresAt>this.now()).reduce((n,job)=>n+(job.reservedBytes || 0),0);
    const ratio=plan.limitBytes ? usedBytes/plan.limitBytes : usedBytes ? 1 : 0;
    return {...plan,usedBytes,reservedBytes,availableBytes:Math.max(0,plan.limitBytes-usedBytes-reservedBytes),
      status:usedBytes>=plan.limitBytes ? 'full' : ratio>=0.95 ? 'critical' : ratio>=0.8 ? 'near_full' : 'normal',
      storageLocation:'user-owned',warningThresholds:[80,95,100]};
  }
  async managedUsage(userId) {
    const items=await this.repository.list('storage',userId);
    const jobs=await this.repository.list('job',userId);
    return items.reduce((n,item)=>n+item.bytes,0)+jobs.filter(j=>ACTIVE.has(j.state)&&!j.settled&&j.expiresAt>this.now()).reduce((n,j)=>n+(j.reservedBytes||0),0);
  }
  async quota(user) {
    const uid=owner(user), plan=await this.plan(uid);
    const externalBytes=this.externalUsage ? await this.externalUsage(uid) : 0;
    return this.repository.locked(uid,c=>this.budgetIn(uid,plan,c,{externalBytes}));
  }
  async warn(userId, budget, forceFull=false) {
    const band=forceFull ? 'full' : budget.status;
    const changed=await this.repository.locked(userId,async c=>{
      const previous=await this.repository.get('quota_notice',userId,userId,c);
      if (previous?.band===band && this.now()-previous.at<DAY) return false;
      await this.repository.put('quota_notice',userId,userId,{band,at:this.now()},c); return band!=='normal';
    });
    if (!changed) return;
    try { await this.notifications?.publish({userId,category:'files',type:'storage.'+band,
      title:band==='full'?'พื้นที่ส่วนตัวเต็มแล้ว':'พื้นที่ส่วนตัวใกล้เต็ม',
      body:band==='full'?'หยุดบันทึกเพิ่มแล้ว งานเดิมยังอยู่ กรุณาลบหรือส่งออกข้อมูล หรือเพิ่มพื้นที่ตามแพ็กเกจ':'ตรวจพื้นที่ของบัญชีใน Sentinel AI และสำรองข้อมูลก่อนพื้นที่เต็ม',
      sourceId:'personal-storage:'+band+':'+Math.floor(this.now()/DAY),sensitive:false}); } catch { /* The storage banner is authoritative. */ }
  }
  async startPairing(input={}) {
    await this.maintenance();
    if (!text(input.name,80) || !['win32','darwin','linux'].includes(input.platform) || !Array.isArray(input.scopes) || !input.scopes.length || input.scopes.some(s=>!SCOPES.includes(s))) fail('invalid_device_pairing');
    const autoScopes=Array.isArray(input.autoScopes)?input.autoScopes:[];
    if (autoScopes.some(s=>!input.scopes.includes(s))) fail('invalid_device_permissions');
    const id=randomUUID(), code=randomBytes(6).toString('hex').toUpperCase(), token=randomBytes(32).toString('base64url');
    const pairing={id,codeHash:hash(code),tokenHash:hash(token),name:input.name.trim(),platform:input.platform,
      scopes:[...new Set(input.scopes)],autoScopes:[...new Set(autoScopes)],expiresAt:this.now()+5*60000};
    await this.repository.put('pairing',pairing.codeHash,'pairing',pairing,null,5*60000);
    await this.repository.put('pairing_lookup',id,'pairing',{codeHash:pairing.codeHash,tokenHash:pairing.tokenHash},null,5*60000);
    return {pairingId:id,code,deviceSecret:token,expiresAt:pairing.expiresAt};
  }
  async inspectPairing(user, code) {
    owner(user); if (!/^[0-9A-F]{12}$/i.test(String(code))) fail('invalid_pairing_code');
    const p=await this.repository.get('pairing',hash(code.toUpperCase()),'pairing');
    if (!p || p.owner) fail('pairing_expired_or_used',404);
    return {name:p.name,platform:p.platform,scopes:p.scopes,autoScopes:p.autoScopes,expiresAt:p.expiresAt};
  }
  async confirmPairing(user, code) {
    const uid=owner(user); if (!/^[0-9A-F]{12}$/i.test(String(code))) fail('invalid_pairing_code');
    return this.repository.locked('pair:'+hash(code.toUpperCase()),async c=>{
      if(c){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['billing:'+uid]);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['remote:'+uid]);}
      const p=await this.repository.get('pairing',hash(code.toUpperCase()),'pairing',c);
      if (!p || p.owner) fail('pairing_expired_or_used',409);
      if ((await this.repository.list('device',uid,c)).filter(d=>!d.revokedAt).length>=10) fail('device_limit_reached',409);
      const d={id:p.id,owner:uid,accountVersion:user.accountVersion,name:p.name,platform:p.platform,scopes:p.scopes,autoScopes:p.autoScopes,
        localScopes:p.scopes,localAutoScopes:p.autoScopes,tokenHash:p.tokenHash,pairedAt:this.now(),lastSeenAt:0,workspaceBytes:0};
      await this.repository.put('device',d.id,uid,d,c);
      p.owner=uid; await this.repository.put('pairing',p.codeHash,'pairing',p,c,Math.max(1,p.expiresAt-this.now()));
      return {device:publicDevice(d)};
    });
  }
  async pairingStatus(id,secret) {
    const p=await this.repository.get('pairing_lookup',id,'pairing');
    if (!p || !sameSecret(secret,p.tokenHash)) fail('pairing_expired',401);
    const d=await this.repository.get('device',id);
    if (!d) return {state:'waiting'};
    if (d.revokedAt) fail('device_revoked',401);
    return {state:'paired',deviceId:d.id,userId:d.owner,scopes:d.scopes,autoScopes:d.autoScopes};
  }
  async authenticateDevice(id,secret) {
    if (!ID.test(String(id))) fail('invalid_device_token',401);
    const d=await this.repository.get('device',id);
    if (!d || d.revokedAt || !sameSecret(secret,d.tokenHash)) fail('invalid_device_token',401);
    if (this.validatePrincipal) { const current=await this.validatePrincipal({sub:d.owner,accountVersion:d.accountVersion}); owner(current); }
    return d;
  }
  async devices(user) {
    const uid=owner(user); return (await this.repository.list('device',uid)).filter(d=>!d.revokedAt).map(d=>({...publicDevice(d),online:d.lastSeenAt>this.now()-60000}));
  }
  async updateDevice(user,id,patch={}) {
    const uid=owner(user);
    return this.repository.locked(uid,async c=>{
      const d=await this.repository.get('device',id,uid,c); if(!d || d.revokedAt) fail('device_not_found',404);
      if(Object.keys(patch).some(k=>!['name','scopes','autoScopes','revoke'].includes(k))) fail('invalid_device_settings');
      if (patch.name!==undefined) { if(!text(patch.name,80)) fail('invalid_device_name'); d.name=patch.name.trim(); }
      if (patch.scopes!==undefined) { if(!Array.isArray(patch.scopes)||patch.scopes.some(s=>!d.localScopes.includes(s))) fail('local_permission_required',403); d.scopes=[...new Set(patch.scopes)]; }
      if (patch.autoScopes!==undefined) { if(!Array.isArray(patch.autoScopes)||patch.autoScopes.some(s=>!d.scopes.includes(s)||!d.localAutoScopes.includes(s))) fail('local_permission_required',403); d.autoScopes=[...new Set(patch.autoScopes)]; }
      d.autoScopes=d.autoScopes.filter(s=>d.scopes.includes(s));
      if (patch.revoke===true) {
        d.revokedAt=this.now();
        for (const job of await this.repository.list('job',uid,c)) if(job.deviceId===id && ACTIVE.has(job.state)) {
          job.state=['running','unknown','cancel_requested'].includes(job.state)?'cancel_requested':'cancelled'; job.reservedBytes=0; delete job.payload;
          await this.repository.put('job',job.id,uid,job,c,30*DAY);
        }
      }
      await this.repository.put('device',id,uid,d,c); return publicDevice(d);
    });
  }
  async putThread(user,input) {
    const uid=owner(user), plan=await this.plan(uid);
    if(!THREAD.test(input?.id)||!text(input.title,120)||!Number.isSafeInteger(input.bytes)||input.bytes<0||!Number.isSafeInteger(input.version)||input.version<0||!['text','voice','mixed'].includes(input.channel)||!text(input.vaultId,100)) fail('invalid_personal_chat');
    const result=await this.repository.locked(uid,async c=>{
      const old=await this.repository.get('thread',input.id,uid,c);
      if((old?.version||0)!==input.version) fail('chat_version_conflict',409);
      if(!old && (await this.repository.list('thread',uid,c)).length>=1000) fail('chat_count_limit',413);
      const budget=await this.budgetIn(uid,plan,c);
      if(input.bytes>(old?.bytes||0)+budget.availableBytes) fail('personal_storage_full',413);
      if(input.vaultId.startsWith('device:')) {const d=await this.repository.get('device',input.vaultId.slice(7),uid,c);if(!d||d.revokedAt||!d.scopes.includes('chat.sync'))fail('chat_vault_unavailable',409);}
      const thread={id:input.id,title:input.title.trim(),bytes:input.bytes,channel:input.channel,vaultId:input.vaultId,
        version:input.version+1,createdAt:old?.createdAt||this.now(),updatedAt:this.now(),storageLocation:'user-owned',syncedVersion:old?.syncedVersion||0};
      await this.repository.put('thread',thread.id,uid,thread,c);
      await this.repository.put('storage','thread:'+thread.id,uid,{id:'thread:'+thread.id,bytes:thread.bytes},c);
      return {thread,quota:await this.budgetIn(uid,plan,c)};
    });
    await this.warn(uid,result.quota); return result;
  }
  async threads(user) { return this.repository.list('thread',owner(user)); }
  async deleteThread(user,id) {
    const uid=owner(user);
    return this.repository.locked(uid,async c=>{
      if(!(await this.repository.get('thread',id,uid,c))) fail('chat_not_found',404);
      const active=(await this.repository.list('job',uid,c)).some(j=>j.chatId===id&&ACTIVE.has(j.state)&&!j.settled);
      if(active) fail('chat_has_active_jobs',409);
      await this.repository.remove('thread',id,uid,c); await this.repository.remove('storage','thread:'+id,uid,c);
      return {ok:true};
    });
  }
  async syncChat(user,id,content) {
    const uid=owner(user), thread=await this.repository.get('thread',id,uid);
    if(!thread || !thread.vaultId.startsWith('device:'))fail('chat_vault_unavailable',409);
    if(typeof content!=='string'||Buffer.byteLength(content)>512*1024)fail('personal_chat_too_large',413);
    let parsed;try{parsed=JSON.parse(content);}catch{fail('invalid_personal_chat');}
    if(parsed.id!==id||parsed.owner!==uid||parsed.serverVersion!==thread.version)fail('chat_version_conflict',409);
    const job=await this.submit(user,{deviceId:thread.vaultId.slice(7),chatId:id,title:'ซิงค์ประวัติแชท',steps:[{op:'chat.write',args:{id,version:thread.version,content}}]},'chat-sync:'+id+':'+thread.version);
    return job;
  }
  async retrieveChat(user,id) {
    const uid=owner(user), thread=await this.repository.get('thread',id,uid);
    if(!thread||!thread.vaultId.startsWith('device:'))fail('chat_vault_unavailable',409);
    return this.submit(user,{deviceId:thread.vaultId.slice(7),chatId:id,title:'เปิดประวัติแชท',steps:[{op:'chat.read',args:{id}}]});
  }
  async submit(user,input,requestId) {
    const uid=owner(user), steps=validateSteps(input?.steps), plan=await this.plan(uid);
    if(!ID.test(String(input.deviceId))||!text(input.title,120)) fail('invalid_remote_job');
    const current=context.getStore();
    const chatId=current?.userId===uid && THREAD.test(current.sessionId)?current.sessionId:(THREAD.test(input.chatId)?input.chatId:null);
    const id=requestId ? 'job_'+hash(uid+':'+String(requestId)).slice(0,48):randomUUID();
    const argsHash=hash(JSON.stringify({deviceId:input.deviceId,title:input.title,steps,chatId}));
    return this.repository.locked(uid,async c=>{
      const existing=await this.repository.get('job',id,uid,c);
      if(existing) { if(existing.argsHash!==argsHash) fail('remote_request_conflict',409); return this.publicJob(existing); }
      let syncChatId=null,syncVersion=null;
      for(const step of steps.filter(s=>s.op==='chat.write')){const thread=await this.repository.get('thread',step.args.id,uid,c);let data;try{data=JSON.parse(step.args.content);}catch{fail('invalid_personal_chat');}if(!thread||thread.vaultId!=='device:'+input.deviceId||thread.version!==step.args.version||data.id!==thread.id||data.owner!==uid||data.serverVersion!==thread.version||Buffer.byteLength(step.args.content)>thread.bytes+1024)fail('chat_version_conflict',409);syncChatId=thread.id;syncVersion=thread.version;}
      const d=await this.repository.get('device',input.deviceId,uid,c); if(!d||d.revokedAt) fail('device_not_found',404);
      const needed=[...new Set(steps.map(s=>CAPABILITIES[s.op]))];
      if(needed.some(s=>!d.scopes.includes(s))) fail('device_permission_denied',403);
      const jobs=await this.repository.list('job',uid,c);
      // Voice and streamed replies may update a vault faster than its computer
      // polls. Keep the newest unstarted snapshot; never cancel a running write.
      if(syncChatId)for(const previous of jobs)if(previous.syncChatId===syncChatId&&['queued','awaiting_confirmation'].includes(previous.state)) {
        previous.state='cancelled';previous.superseded=true;previous.reservedBytes=0;delete previous.payload;
        await this.repository.put('job',previous.id,uid,previous,c,30*DAY);
      }
      if(jobs.filter(j=>ACTIVE.has(j.state)&&!j.settled&&j.expiresAt>this.now()).length>=20) fail('remote_queue_full',429);
      const budget=await this.budgetIn(uid,plan,c);
      const writeBytes=steps.reduce((n,s)=>n+(s.op.endsWith('.write')&&!s.op.startsWith('chat.')?Buffer.byteLength(s.args.content):0),0);
      const reservedBytes=writeBytes+(steps.every(s=>s.op.startsWith('chat.')||['files.list','files.read','memory.read','files.remove'].includes(s.op))?0:4096);
      if(reservedBytes>budget.availableBytes) fail('personal_storage_full',413);
      const now=this.now(); const job={id,owner:uid,deviceId:d.id,deviceName:d.name,chatId,title:input.title.trim(),
        syncChatId,syncVersion,state:needed.every(s=>d.autoScopes.includes(s))?'queued':'awaiting_confirmation',scopes:needed,argsHash,
        payload:this.cipher.seal({steps},uid+':'+id),reservedBytes,createdAt:now,updatedAt:now,expiresAt:now+DAY,transitUntil:now+DAY};
      await this.repository.put('job',id,uid,job,c,30*DAY);
      // Keep a bounded metadata history; never evict active jobs.
      for(const old of jobs.slice(499)) if(!ACTIVE.has(old.state)) await this.repository.remove('job',old.id,uid,c);
      return this.publicJob(job);
    });
  }
  publicJob(job) {
    const {payload,resultEnvelope,owner:ignored,argsHash,leaseToken,...safe}=job;
    if(ACTIVE.has(safe.state)&&safe.expiresAt<=this.now()) safe.state=['running','unknown','cancel_requested'].includes(safe.state)?'unknown':'expired';
    if(safe.state==='running'&&safe.leaseUntil<this.now()) safe.state='unknown';
    return {...safe,approvalHash:argsHash,resultAvailable:!!resultEnvelope&&job.transitUntil>this.now(),resultRetentionSeconds:900};
  }
  async jobs(user,chatId) { return (await this.repository.list('job',owner(user))).filter(j=>!chatId||j.chatId===chatId).map(j=>this.publicJob(j)); }
  async job(user,id,{preview=false,result=false}={}) {
    const uid=owner(user), job=await this.repository.get('job',id,uid); if(!job) fail('remote_job_not_found',404);
    const out=this.publicJob(job);
    if(job.transitUntil>this.now()) {
      if(preview && job.payload) out.steps=this.cipher.open(job.payload,uid+':'+id).steps;
      if(result && job.resultEnvelope) out.result=this.cipher.open(job.resultEnvelope,uid+':result:'+id);
    }
    return out;
  }
  async approve(user,id,approvalHash) {
    const uid=owner(user);
    return this.repository.locked(uid,async c=>{
      const j=await this.repository.get('job',id,uid,c); if(!j) fail('remote_job_not_found',404);
      if(j.argsHash!==approvalHash) fail('remote_approval_conflict',409);
      if(j.state!=='awaiting_confirmation') return this.publicJob(j);
      if(j.expiresAt<=this.now()||!j.payload) fail('remote_job_expired',410);
      const d=await this.repository.get('device',j.deviceId,uid,c); if(!d||d.revokedAt||j.scopes.some(s=>!d.scopes.includes(s))) fail('device_permission_denied',403);
      j.state='queued';j.approvedAt=this.now();j.updatedAt=this.now();await this.repository.put('job',id,uid,j,c,30*DAY);return this.publicJob(j);
    });
  }
  async cancel(user,id) {
    const uid=owner(user);
    return this.repository.locked(uid,async c=>{
      const j=await this.repository.get('job',id,uid,c);if(!j) fail('remote_job_not_found',404);
      if(['queued','awaiting_confirmation'].includes(j.state)) {j.state='cancelled';j.reservedBytes=0;delete j.payload;}
      else if(['running','unknown'].includes(j.state)) j.state='cancel_requested';
      j.updatedAt=this.now();await this.repository.put('job',id,uid,j,c,30*DAY);return this.publicJob(j);
    });
  }
  async poll(device,input={}) {
    const uid=device.owner,plan=await this.plan(uid); await this.maintenance();
    if(!Number.isSafeInteger(input.workspaceBytes)||input.workspaceBytes<0) fail('invalid_workspace_usage');
    const result=await this.repository.locked(uid,async c=>{
      const d=await this.repository.get('device',device.id,uid,c);if(!d||d.revokedAt)fail('device_revoked',401);
      d.lastSeenAt=this.now();d.workspaceBytes=input.workspaceBytes;await this.repository.put('device',d.id,uid,d,c);
      await this.repository.put('storage','device:'+d.id,uid,{id:'device:'+d.id,bytes:input.workspaceBytes},c);
      const jobs=(await this.repository.list('job',uid,c)).filter(j=>j.deviceId===d.id);
      const running=jobs.find(j=>['running','unknown','cancel_requested'].includes(j.state)&&!j.settled);
      let active;
      if(running) {
        if(input.jobId===running.id && input.leaseToken===running.leaseToken) {
          running.leaseUntil=this.now()+45000;active=running;
          if(running.state==='unknown') running.state='running';
          await this.repository.put('job',running.id,uid,running,c,30*DAY);
        } else if(running.leaseUntil<this.now() && running.state==='running') {
          running.state='unknown';await this.repository.put('job',running.id,uid,running,c,30*DAY);
        }
      }
      const budget=await this.budgetIn(uid,plan,c,{excludeJob:active?.id});
      const maxWorkspaceBytes=Math.max(0,budget.limitBytes-(budget.usedBytes-input.workspaceBytes)-budget.reservedBytes);
      const response={quota:budget,maxWorkspaceBytes,scopes:d.scopes,autoScopes:d.autoScopes,pollAfterMs:15000,
        cancelRequested:active?.state==='cancel_requested',reconcile:running&&!active?{jobId:running.id,leaseToken:running.leaseToken,state:running.state}:null};
      if(running) return response;
      const next=jobs.filter(j=>j.state==='queued').sort((a,b)=>a.createdAt-b.createdAt)[0];
      if(!next) return response;
      if(next.expiresAt<=this.now()||!next.payload) {next.state='expired';next.reservedBytes=0;delete next.payload;await this.repository.put('job',next.id,uid,next,c,30*DAY);return response;}
      if(next.scopes.some(s=>!d.scopes.includes(s))) {next.state='failed';next.error='device_permission_denied';next.reservedBytes=0;delete next.payload;await this.repository.put('job',next.id,uid,next,c,30*DAY);return response;}
      next.state='running';next.startedAt=this.now();next.leaseToken=randomBytes(24).toString('base64url');next.leaseUntil=this.now()+45000;
      await this.repository.put('job',next.id,uid,next,c,30*DAY);
      return {...response,maxWorkspaceBytes:maxWorkspaceBytes+next.reservedBytes,job:{...this.publicJob(next),leaseToken:next.leaseToken,...this.cipher.open(next.payload,uid+':'+next.id)}};
    });
    await this.warn(uid,result.quota);return result;
  }
  async complete(device,id,input={}) {
    const uid=device.owner;
    if(!['succeeded','failed','cancelled','unknown'].includes(input.state)||!text(input.leaseToken,100)||!Number.isSafeInteger(input.workspaceBytes)||input.workspaceBytes<0||Buffer.byteLength(JSON.stringify(input.result||{}))>768*1024) fail('invalid_remote_result');
    const result=await this.repository.locked(uid,async c=>{
      const d=await this.repository.get('device',device.id,uid,c);if(!d||d.revokedAt)fail('device_revoked',401);
      const j=await this.repository.get('job',id,uid,c);
      if(!j||j.deviceId!==d.id||j.leaseToken!==input.leaseToken)fail('invalid_job_lease',409);
      if(!['running','cancel_requested','unknown'].includes(j.state)) return this.publicJob(j);
      j.state=input.state;j.completedAt=this.now();j.updatedAt=this.now();j.reservedBytes=0;j.transitUntil=this.now()+15*60000;
      j.resultEnvelope=this.cipher.seal(input.result||{},uid+':result:'+id);delete j.payload;
      if(input.state==='unknown') {j.settled=input.result?.inactive===true;if(!j.settled)j.reservedBytes=4096;}
      if(input.state==='succeeded'&&j.syncChatId) {const thread=await this.repository.get('thread',j.syncChatId,uid,c);if(thread&&thread.version===j.syncVersion){thread.syncedVersion=j.syncVersion;await this.repository.put('thread',thread.id,uid,thread,c);}}
      await this.repository.put('job',id,uid,j,c,30*DAY);
      d.workspaceBytes=input.workspaceBytes;d.lastSeenAt=this.now();await this.repository.put('device',d.id,uid,d,c);
      await this.repository.put('storage','device:'+d.id,uid,{id:'device:'+d.id,bytes:input.workspaceBytes},c);
      return this.publicJob(j);
    });
    try { await this.notifications?.publish({userId:uid,category:'operations',type:'remote.'+result.state,
      title:result.state==='succeeded'?'งานบนอุปกรณ์เสร็จแล้ว':'มีการอัปเดตงานบนอุปกรณ์',body:'เปิดรายการแชทใน Sentinel AI เพื่อตรวจผลการทำงาน',sourceId:id,sensitive:true}); } catch {}
    return result;
  }
}
module.exports={RemoteWorkspaceService,remoteWorkspaceContext:context};
