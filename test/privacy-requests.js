'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const { newDb }=require('pg-mem');
const { PrivacyRequestService }=require('../services/privacyRequestService');
const { createPrivacyRequestsRouter }=require('../routes/privacyRequests');

const alice={sub:'alice',roles:['user'],permissions:['chat']};
const bob={sub:'bob',roles:['user'],permissions:['chat']};
const operator={sub:'operator-1',roles:['operator'],permissions:['chat']};
const administrator={sub:'admin-1',roles:['administrator'],permissions:['chat']};
async function main() {
  await assert.rejects(()=>new PrivacyRequestService({required:true}).init(),error=>error.code==='privacy_requests_database_required');
  const unavailable=new PrivacyRequestService(); await unavailable.init();
  await assert.rejects(()=>unavailable.accountDeletion({user:alice,confirmation:'DELETE_REQUEST'}),error=>error.status===503);
  const db=newDb({noAstCoverageCheck:true});
  const pool=new(db.adapters.createPg().Pool)();
  const audit=[]; let now=Date.now();
  const calls=[];
  const dependencies={
    pool,required:true,clock:()=>++now,audit:{record:(event,data)=>audit.push({event,data})},
    cloudApps:{get:async({user,runId})=>{
      calls.push({type:'run',owner:user.sub,id:runId});
      if (runId==='unavailable') throw new Error('database connection secret');
      if (runId!==user.sub+'-run') { const error=new Error('cloud_apps_run_not_found'); error.status=404; throw error; }
      return {id:runId,userId:user.sub,input:'PRIVATE_SOURCE_PROMPT',result:{text:'PRIVATE_SOURCE_TRANSCRIPT'}};
    }},
    agentService:{getAction:async({user,actionId})=>{
      calls.push({type:'action',owner:user.sub,id:actionId});
      return actionId===user.sub+'-action' ? {ok:true,action:{actionId,userId:user.sub,args:{password:'PRIVATE_TOOL_SECRET'},result:{output:'PRIVATE_TOOL_OUTPUT'}}} : {ok:false,error:'action_not_found'};
    }}
  };
  const first=new PrivacyRequestService(dependencies);
  const second=new PrivacyRequestService(dependencies);
  try {
    await first.init(); await second.init();
    assert.equal((await first.deletionStatus({user:alice})).request,null);
    for (const confirmation of [undefined,true,'delete_request','DELETE',' DELETE_REQUEST']) await assert.rejects(()=>first.accountDeletion({user:alice,confirmation}),error=>error.code==='privacy_requests_confirmation_required');
    await assert.rejects(()=>first.accountDeletion({user:{sub:'guest:x',roles:['guest']},confirmation:'DELETE_REQUEST'}),error=>error.status===403);
    await assert.rejects(()=>first.accountDeletion({user:alice,confirmation:'DELETE_REQUEST',reason:'x'.repeat(501)}),error=>error.code==='privacy_requests_invalid_reason');
    const request=await first.accountDeletion({user:alice,confirmation:'DELETE_REQUEST',reason:'Please review my deletion request'});
    const id=request.request.id;
    assert.equal(request.created,true); assert.equal(request.request.status,'requested');
    assert.equal(request.automaticErasure,false); assert.equal(request.manualProcessing,true);
    assert.equal(request.request.userId,undefined,'own response does not expose internal owner/handler metadata');
    const repeated=await second.accountDeletion({user:alice,confirmation:'DELETE_REQUEST',reason:'do not overwrite initial reason'});
    assert.equal(repeated.created,false); assert.equal(repeated.request.id,id); assert.equal(repeated.request.details,'Please review my deletion request');
    assert.equal((await second.list({user:alice})).requests.length,1,'cross-replica duplicate is one open request');
    const carol={sub:'carol',roles:['user']};
    const concurrent=await Promise.all([first.accountDeletion({user:carol,confirmation:'DELETE_REQUEST'}),second.accountDeletion({user:carol,confirmation:'DELETE_REQUEST'})]);
    assert.equal(new Set(concurrent.map(result=>result.request.id)).size,1,'unique open key survives concurrent replica submissions');
    assert.equal(concurrent.filter(result=>result.created).length,1);
    assert.equal((await second.deletionStatus({user:bob})).request,null);
    assert.deepEqual((await second.list({user:bob})).requests,[]);
    await assert.rejects(()=>first.operatorList({user:alice}),error=>error.status===403);
    await assert.rejects(()=>first.updateStatus({user:alice,requestId:id,status:'manual_processing'}),error=>error.status===403);
    await assert.rejects(()=>first.updateStatus({user:operator,requestId:id,status:'completed',resolution:'unchecked'}),error=>error.code==='privacy_requests_status_conflict');
    const reviewing=await first.updateStatus({user:operator,requestId:id,status:'manual_processing'});
    assert.equal(reviewing.request.status,'manual_processing'); assert.equal(reviewing.request.processedBy,operator.sub);
    assert.equal((await second.accountDeletion({user:alice,confirmation:'DELETE_REQUEST'})).request.id,id,'processing request remains idempotent');
    await assert.rejects(()=>second.updateStatus({user:administrator,requestId:id,status:'completed'}),error=>error.code==='privacy_requests_resolution_required');
    const completed=await second.updateStatus({user:administrator,requestId:id,status:'completed',resolution:'Manual processing recorded; retained records and scope communicated in case reference 123.'});
    assert.equal(completed.request.status,'completed'); assert(completed.request.completedAt); assert.equal(completed.automaticErasure,false,'closing the queue does not claim automated erasure');
    const result=await first.deletionStatus({user:alice});
    assert.equal(result.request.status,'completed'); assert.equal(result.request.processedBy,undefined);
    await assert.rejects(()=>first.updateStatus({user:operator,requestId:id,status:'manual_processing'}),error=>error.code==='privacy_requests_status_conflict');
    const next=await first.accountDeletion({user:alice,confirmation:'DELETE_REQUEST'});
    assert.notEqual(next.request.id,id,'completed request frees unique open request key');
    assert.equal((await first.deletionStatus({user:alice})).request.id,next.request.id);

    await assert.rejects(()=>first.report({user:alice,sourceType:'cloud_app_run',sourceId:'bob-run',category:'privacy'}),error=>error.status===404);
    await assert.rejects(()=>first.report({user:alice,sourceType:'action',sourceId:'bob-action',category:'other'}),error=>error.status===404);
    await assert.rejects(()=>first.report({user:alice,sourceType:'cloud_app_run',sourceId:'unavailable',category:'other'}),error=>error.code==='privacy_requests_source_unavailable' && !error.message.includes('secret'));
    const appReport=await first.report({user:alice,sourceType:'cloud_app_run',sourceId:'alice-run',category:'inaccurate',details:'The answer has an incorrect date.'});
    assert.equal(appReport.request.kind,'ai_output_report'); assert.equal(appReport.request.sourceId,'alice-run');
    const actionReport=await first.report({user:alice,sourceType:'action',sourceId:'alice-action',category:'harmful'});
    assert.equal(actionReport.request.details,'');
    const generic=await first.report({user:alice,sourceType:'general',category:'other',details:'I want to report a voice answer.'});
    assert.equal(generic.request.sourceId,null);
    for (const input of [{sourceType:'general',category:'other'},{sourceType:'general',sourceId:'bob-run',category:'other',details:'x'},{sourceType:'cloud_app_run',sourceId:'alice-run',category:'unknown'},{sourceType:'cloud_app_run',sourceId:'../alice-run',category:'other'},{sourceType:'general',category:'other',details:'x'.repeat(2001)}]) await assert.rejects(()=>first.report({user:alice,...input}),error=>error.status===400);
    const stored=(await pool.query('SELECT * FROM panthorium_privacy_requests')).rows;
    assert(!JSON.stringify(stored).includes('PRIVATE_'),'queue never copies source prompts, transcripts, outputs or tool secrets');
    assert(!JSON.stringify(audit).includes('incorrect date'),'audit retains ids/status only, not free-text report content');
    assert(calls.some(call=>call.type==='run' && call.owner==='alice' && call.id==='bob-run'),'source lookup uses authenticated reporter owner');
    assert.equal((await first.operatorList({user:operator,kind:'ai_output_report',status:'requested'})).requests.length,3);
    const statusEvents=(await pool.query('SELECT * FROM panthorium_privacy_request_events')).rows;
    assert.equal(statusEvents.length,2); assert.equal(statusEvents[0].actor_id,operator.sub);
    assert(!JSON.stringify(statusEvents).includes('Please review'));

    // Auth middleware validates the current account on every API request.
    const tokens={alice,bob,operator,administrator}; let validations=0;
    const auth={verifyAccessToken:token=>{if(!tokens[token]) throw new Error('invalid');return tokens[token];},validateAccountPrincipal:async user=>{validations++;return user;}};
    const app=express(); app.use(express.json()); app.use('/api/privacy',createPrivacyRequestsRouter(auth,first));
    const server=app.listen(0);
    try {
      const base='http://127.0.0.1:'+server.address().port+'/api/privacy';
      const request=async(path,method='GET',body,token='alice',headers={})=>{
        const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},...(body===undefined ? {} : {body:JSON.stringify(body)})});
        return {status:response.status,headers:response.headers,body:await response.json()};
      };
      assert.equal((await fetch(base+'/account-deletion')).status,401);
      const status=await request('/account-deletion'); assert.equal(status.status,200); assert.equal(status.headers.get('cache-control'),'no-store');
      assert.equal((await request('/account-deletion','GET',undefined,'bob')).body.request,null);
      assert.equal((await request('/account-deletion','POST',{confirmation:'DELETE_REQUEST',userId:'bob'})).status,400,'client owner cannot be supplied');
      assert.equal((await request('/account-deletion','POST',{confirmation:'DELETE_REQUEST'})).status,200,'existing request reused');
      assert.equal((await request('/account-deletion','POST',{confirmation:'DELETE_REQUEST'},'alice',{'sec-fetch-site':'cross-site'})).status,403);
      assert.equal((await request('/account-deletion','POST',{confirmation:'DELETE_REQUEST'},'alice',{'Content-Type':'text/plain'})).status,415);
      assert.equal((await request('/operator/requests')).status,403);
      assert.equal((await request('/operator/requests','GET',undefined,'operator')).status,200);
      assert.equal((await request('/operator/requests/'+next.request.id,'PATCH',{status:'completed',resolution:'not authorized'})).status,403);
      assert.equal((await request('/reports','POST',{sourceType:'cloud_app_run',sourceId:'bob-run',category:'privacy'})).status,404);
      assert.equal((await request('/reports','POST',{sourceType:'cloud_app_run',sourceId:'alice-run',category:'other',details:'Needs review'})).status,201);
      assert.equal((await request('/reports','POST',{sourceType:'general',category:'other',details:'x'.repeat(2001)})).status,400);
      assert((await request('/requests')).body.requests.every(row=>row.userId===undefined));
      assert(validations>=10,'current account validation reused across mutations and reads');
    } finally { await new Promise(resolve=>server.close(resolve)); }
    console.log('PASS privacy requests: durable idempotent manual deletion queue, exact confirmation, current auth, operator transitions, owner-verified AI reports, and minimized data');
  } finally { await pool.end(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
