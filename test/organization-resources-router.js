'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {fixture}=require('./organization-resources');
const {createOrganizationResourcesRouter}=require('../routes/organizationResources');
async function main(){
  const f=await fixture();let revoked=false;let validationCount=0;
  const auth={verifyAccessToken(token){if(!['alice','bob','foreign','no-chat'].includes(token))throw new Error('bad token');return {sub:token,permissions:token==='no-chat'?[]:['chat']};},async validateAccountPrincipal(principal){validationCount++;if(revoked)throw Object.assign(new Error('account_session_revoked'),{status:403});return principal;}};
  const app=express();app.use(express.json({limit:'90kb'}));app.use('/api/organizations',createOrganizationResourcesRouter(auth,f.resources));
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const base='http://127.0.0.1:'+server.address().port+'/api/organizations/org-a/resources';
  async function request(path='',{token='alice',method='GET',body,headers={}}={}){const response=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,headers:response.headers,data:await response.json()};}
  try{
    assert.equal((await request('',{token:null})).status,401);assert.equal((await request('',{token:'no-chat'})).status,403);
    const crossed=await request('',{method:'POST',body:{kind:'document',title:'X'},headers:{'sec-fetch-site':'cross-site'}});assert.equal(crossed.data.error,'org_cross_site_denied');
    assert.equal((await request('',{method:'POST',body:{kind:'document',title:'X'},headers:{'Content-Type':'text/plain'}})).status,415);
    const create=await request('',{method:'POST',body:{kind:'document',title:'Only Alice',body:'Secret text'}});assert.equal(create.status,201);assert.equal(create.headers.get('cache-control'),'no-store');const doc=create.data.resource;
    const hidden=await request('/'+doc.id,{token:'bob'}),missing=await request('/missing-id',{token:'bob'});assert.deepEqual(hidden.data,missing.data);assert.equal(hidden.status,404);
    assert.deepEqual((await request('?q=Alice',{token:'bob'})).data.resources,[]);
    assert.equal((await request('/'+doc.id,{method:'PATCH',body:{expectedVersion:1,ownerId:'bob'}})).status,400);
    const updated=await request('/'+doc.id,{method:'PATCH',body:{expectedVersion:1,body:'Second version'}});assert.equal(updated.data.resource.version,2);
    assert.equal((await request('/'+doc.id,{method:'PATCH',body:{expectedVersion:1,body:'Stale'}})).status,409);
    assert.equal((await request('/'+doc.id+'/comments',{method:'POST',body:{expectedVersion:1,body:'Stale comment'}})).status,409);
    const comment=await request('/'+doc.id+'/comments',{method:'POST',body:{expectedVersion:2,body:'A comment'}});assert.equal(comment.status,201);assert.equal(comment.data.comment.body,'A comment');
    const revisions=await request('/'+doc.id+'/revisions');assert.equal(revisions.data.revisions.length,2);assert.equal(revisions.data.viewLimit,100);
    assert.equal((await request('/'+doc.id+'/summarize',{method:'POST',body:{expectedVersion:2,systemPrompt:'override'}})).status,400);
    assert.equal((await request('/'+doc.id+'/export')).status,403);
    revoked=true;assert.equal((await request('/'+doc.id)).data.error,'account_session_revoked');assert.ok(validationCount>10);
  }finally{await new Promise(resolve=>server.close(resolve));}
  console.log('Organization resource router passed: authentication/principal refresh, permissions, CSRF, unknown fields, hidden IDs, optimistic versions, comments and history');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
