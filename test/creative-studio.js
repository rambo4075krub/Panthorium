'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { CreativeStudioService, CreativeStudioError } = require('../services/creativeStudioService');
const { MemoryCreativeStudioRepository, createCreativeStudioRepository } = require('../services/creativeStudioRepository');

function fixture() {
  const user = {sub:crypto.randomUUID(),roles:['user'],permissions:['chat'],accountVersion:2};
  const other = {...user,sub:crypto.randomUUID()};
  const repository = new MemoryCreativeStudioRepository(); const objects = new Map();
  const calls = {image:0,office:[],video:[],poll:0}; let current = user;
  const files = {
    bucket:'test-files',ensureConfigured(){},
    async findObject(owner,id) { const item = objects.get(id); if (!item || item.owner !== owner) throw Object.assign(new Error('file_not_found'),{code:'file_not_found',status:404}); const {body,owner:unused,...meta}=item; return meta; },
    async download(owner,id) { return {...await this.findObject(owner,id),body:objects.get(id).body}; },
    async upload(owner,name,contentType,body) { const id=crypto.randomUUID(),meta={id,name,contentType,size:body.length,updatedAt:new Date().toISOString()};objects.set(id,{...meta,owner,body});return meta; }
  };
  const office = {async create(args) { calls.office.push(args); return {files:[await files.upload(args.user.sub,args.pluginId+'.docx','application/octet-stream',Buffer.from('artifact'))],summary:'สร้างเอกสารแล้ว'}; }};
  const mediaStudio = {
    capabilities:()=>({videoGeneration:true}),
    async startGeneration(args) { calls.video.push(args);return {jobToken:'private-operation-token',status:'running'}; },
    async generationStatus(args) { calls.poll++;assert.equal(args.jobToken,'private-operation-token');return {status:'completed',file:await files.upload(args.user.sub,'movie.mp4','video/mp4',Buffer.from('video'))}; }
  };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2e8AAAAASUVORK5CYII=','base64');
  const service = new CreativeStudioService({repository,files,office,mediaStudio,gateway:{complete(){}},providers:{vertex:{project:'test-project'},vertexConfigured:()=>true,vertexAccessToken:async()=>'not-exposed'},resolveUser:async principal => principal.sub === current?.sub ? current : null,vertexFetch:async(url,options)=>{calls.image++;assert.match(url,/aiplatform\.googleapis\.com\/v1\/projects\/test-project/);assert.ok(!JSON.parse(options.body).contents[0].parts.some(part=>part.fileData));return {ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png.toString('base64')}},{text:'สร้างภาพแล้ว'}]}}]})};}});
  return {user,other,repository,files,office,mediaStudio,service,calls,objects,revoke:()=>{current=null;}};
}

(async()=>{
  assert.equal(createCreativeStudioRepository({}).available,false);
  const f=fixture(); await f.service.init();
  const catalog=await f.service.catalog({user:f.user});assert.equal(catalog.plugins.length,5);assert.equal(catalog.durable,false);assert.ok(catalog.plugins.every(p=>p.available));
  await assert.rejects(f.service.start({user:{...f.user,roles:['guest']},pluginId:'image',input:{prompt:'cat'},idempotencyKey:'guest-key-01',confirmed:true}),/account_required/);
  await assert.rejects(f.service.start({user:f.user,pluginId:'image',input:{prompt:'cat'},idempotencyKey:'no-confirm-01'}),/generation_confirmation_required/);
  await assert.rejects(f.service.start({user:f.user,pluginId:'image',input:{prompt:'cat',url:'http://169.254.169.254/'},idempotencyKey:'url-key-01',confirmed:true}),/unsupported_studio_input/);
  await f.service.setMode({user:f.user,pluginId:'image',mode:'never'});
  await assert.rejects(f.service.start({user:f.user,pluginId:'image',input:{prompt:'cat'},idempotencyKey:'denied-key-01',confirmed:true}),/studio_plugin_disabled/);assert.equal(f.calls.image,0);
  await f.service.setMode({user:f.user,pluginId:'image',mode:'auto'});
  const request={user:f.user,pluginId:'image',input:{prompt:'ภาพแมวสีส้ม',aspectRatio:'1:1'},idempotencyKey:'same-request-001',confirmed:true};
  const results=await Promise.all([f.service.start(request),f.service.start(request)]);assert.equal(results[0].job.id,results[1].job.id);assert.equal(f.calls.image,1);
  const completed=await f.service.get({user:f.user,jobId:results[0].job.id});assert.equal(completed.job.status,'completed');assert.equal(completed.job.files.length,1);
  assert.ok(!JSON.stringify(completed).includes('not-exposed'));assert.ok(!JSON.stringify(completed).includes('principal'));
  await assert.rejects(f.service.start({...request,input:{prompt:'different'}}),/studio_idempotency_conflict/);
  await assert.rejects(f.service.get({user:f.other,jobId:completed.job.id}),/studio_job_not_found/);
  const foreign=await f.files.upload(f.other.sub,'private.png','image/png',Buffer.from('private'));
  await assert.rejects(f.service.start({...request,idempotencyKey:'foreign-source-001',sourceFileIds:[foreign.id]}),/file_not_found/);assert.equal(f.calls.image,1);

  const flow=await f.service.start({user:f.user,idempotencyKey:'workflow-001',confirmed:true,steps:[{pluginId:'image',input:{prompt:'สร้างภาพประกอบ'}},{pluginId:'presentation',input:{prompt:'สร้างสไลด์จากภาพนี้'},usePrevious:true}]});
  assert.equal(flow.job.status,'queued');assert.equal(flow.job.currentStep,1);assert.equal(f.calls.office.length,0);
  const readOnly=await f.service.get({user:f.user,jobId:flow.job.id});assert.equal(readOnly.job.status,'queued');assert.equal(f.calls.office.length,0);
  await f.service.tick();const finished=await f.service.get({user:f.user,jobId:flow.job.id});assert.equal(finished.job.status,'completed');assert.deepEqual(f.calls.office[0].sourceFileIds,[flow.job.files[0].id]);assert.equal(finished.job.files[1].sourceFileIds[0],flow.job.files[0].id);

  const video=await f.service.start({user:f.user,idempotencyKey:'video-chain-001',confirmed:true,steps:[{pluginId:'image',input:{prompt:'ภาพแมว'}},{pluginId:'video',input:{prompt:'ทำให้แมวเคลื่อนไหว'},usePrevious:true}]});
  const submitted=await f.service.advance({user:f.user,jobId:video.job.id});assert.equal(submitted.job.status,'running');assert.equal(f.calls.video[0].sourceFileId,video.job.files[0].id);assert.ok(!JSON.stringify(submitted).includes('private-operation-token'));
  const early=await f.service.advance({user:f.user,jobId:video.job.id});assert.equal(early.job.status,'running');assert.equal(f.calls.poll,0,'public advance respects stored poll backoff');
  f.repository.jobs.get(video.job.id).nextRunAt=0;
  const filmed=await f.service.advance({user:f.user,jobId:video.job.id});assert.equal(filmed.job.status,'completed');assert.equal(f.calls.video.length,1);assert.equal(f.calls.poll,1);

  const disabled=await f.service.start({user:f.user,idempotencyKey:'workflow-disabled-01',steps:[{pluginId:'document',input:{prompt:'รายงาน'}},{pluginId:'spreadsheet',input:{prompt:'ตาราง'},usePrevious:true}]});
  await f.service.setMode({user:f.user,pluginId:'spreadsheet',mode:'never'});
  const denied=await f.service.advance({user:f.user,jobId:disabled.job.id});assert.equal(denied.job.status,'failed');assert.equal(denied.job.error,'studio_plugin_disabled');assert.equal(denied.job.files.length,1);

  const revoked=fixture();const queued=await revoked.service.start({user:revoked.user,idempotencyKey:'revocation-flow-01',steps:[{pluginId:'document',input:{prompt:'หนึ่ง'}},{pluginId:'document',input:{prompt:'สอง'},usePrevious:true}]});revoked.revoke();
  const deniedWorker=await revoked.service.advance({user:revoked.user,jobId:queued.job.id});assert.equal(deniedWorker.job.status,'failed');assert.equal(revoked.calls.office.length,1);

  const uncertain=fixture();uncertain.service.vertexFetch=async()=>{uncertain.calls.image++;throw new Error('socket reset after submission');};
  const timeout=await uncertain.service.start({user:uncertain.user,pluginId:'image',input:{prompt:'ภาพ'},idempotencyKey:'uncertain-provider-01',confirmed:true});assert.equal(timeout.job.status,'needs_review');
  await uncertain.service.advance({user:uncertain.user,jobId:timeout.job.id});await uncertain.service.tick();assert.equal(uncertain.calls.image,1);

  const crash=fixture();const crashJob=await crash.repository.create({id:crypto.randomUUID(),ownerId:crash.user.sub,principal:crash.user,idempotencyKey:'crash-recovery-key',fingerprint:'x',confirmed:true,status:'running',currentStep:0,files:[],steps:[{pluginId:'image',input:{prompt:'ภาพ'},sourceFileIds:[],usePrevious:false,status:'submitting',files:[]}]});
  const recovered=await crash.service.advance({user:crash.user,jobId:crashJob.job.id});assert.equal(recovered.job.status,'needs_review');assert.equal(crash.calls.image,0);
  const malformed=fixture();malformed.service.vertexFetch=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')}}]}}]})});
  const corrupt=await malformed.service.start({user:malformed.user,pluginId:'image',input:{prompt:'ภาพ'},idempotencyKey:'corrupt-image-data-01',confirmed:true});assert.equal(corrupt.job.status,'needs_review');assert.equal(corrupt.job.files.length,0);assert.equal(malformed.objects.size,0);

  const invalidOffice = fixture(); let officeAttempts = 0;
  invalidOffice.office.create = async () => { officeAttempts++; throw new (require('../services/officeArtifactService').OfficeArtifactError)(422, 'office_tabular_data_required'); };
  const tableFailure = await invalidOffice.service.start({ user: invalidOffice.user, pluginId: 'spreadsheet', input: { prompt: 'ตารางข้อมูล' }, idempotencyKey: 'invalid-table-output' });
  assert.equal(tableFailure.job.status, 'failed'); assert.equal(tableFailure.job.files.length, 0);
  await invalidOffice.service.advance({ user: invalidOffice.user, jobId: tableFailure.job.id }); assert.equal(officeAttempts, 1, 'known validation failure does not automatically spend another request');
  const legacy = invalidOffice.repository.jobs.get(tableFailure.job.id); legacy.status = legacy.steps[0].status = 'needs_review';
  const legacyDisplay = await invalidOffice.service.get({ user: invalidOffice.user, jobId: legacy.id });
  assert.equal(legacyDisplay.job.status, 'failed'); assert.equal(legacyDisplay.job.steps[0].status, 'failed');
  assert.equal(legacy.status, 'needs_review', 'read-only diagnosis preserves stored history');
  assert.equal(uncertain.repository.jobs.get(timeout.job.id).status, 'needs_review', 'uncertain paid image is not reclassified or retried');
  console.log('creative studio: ownership, policies, replay, workflow, image/video handoff, revocation, uncertain recovery passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
