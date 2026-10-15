'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {createOrganizationGovernanceRouter}=require('../routes/organizationGovernance');
(async()=>{
  const calls=[];
  const authService={verifyAccessToken(token){if(token!=='valid')throw new Error('invalid');return{sub:'viewer',id:'viewer'};}};
  const service={
    async listRequests(user,orgId){calls.push({method:'list',user,orgId});return{ok:true,requests:[]};},
    async requestAccess(user,orgId,input){calls.push({method:'request',user,orgId,input});return{ok:true,request:{id:'request-one',status:'pending'}};},
    async approveRequest(user,orgId,requestId,input){calls.push({method:'approve',user,orgId,requestId,input});if(requestId==='internal-error')throw new Error('SECRET SQL AND RESOURCE DATA');return{ok:true,request:{id:requestId,status:'pending'}};},
    async rejectRequest(user,orgId,requestId,input){calls.push({method:'reject',user,orgId,requestId,input});return{ok:true,request:{id:requestId,status:'rejected'}};}
  };
  const app=express();app.use(express.json());app.use('/api/organizations',createOrganizationGovernanceRouter(authService,service));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/organizations/org-one/access-requests`;
  const request=async(path='',{method='GET',headers={},body}={})=>{const response=await fetch(base+path,{method,headers,body});return{status:response.status,headers:response.headers,body:await response.json()};};
  const auth={authorization:'Bearer valid'},json={...auth,'content-type':'application/json'};
  try{
    const noAuth=await request();assert.equal(noAuth.status,401);assert.equal(noAuth.headers.get('cache-control'),'no-store');
    assert.equal((await request('',{headers:{...auth,'sec-fetch-site':'cross-site'}})).status,403);
    assert.equal(calls.length,0);
    assert.equal((await request('',{method:'POST',headers:auth,body:'text'})).status,415);
    const injection=await request('',{method:'POST',headers:json,body:JSON.stringify({resourceId:'resource-one',access:'read',reason:'needed',requesterId:'different-user'})});
    assert.equal(injection.status,400);assert.equal(calls.length,0);
    const submitted=await request('',{method:'POST',headers:json,body:JSON.stringify({resourceId:'resource-one',access:'read',reason:'needed'})});
    assert.equal(submitted.status,201);assert.equal(submitted.body.request.status,'pending');assert.equal(calls[0].user.sub,'viewer');
    assert.deepEqual(calls[0].input,{resourceId:'resource-one',access:'read',reason:'needed'});
    assert.equal((await request('/request-one/approve',{method:'POST',headers:json,body:JSON.stringify({expectedVersion:1,approvedBy:'org-owner'})})).status,400);
    assert.equal((await request('/request-one/approve',{method:'POST',headers:json,body:JSON.stringify({expectedVersion:1})})).status,200);
    assert.deepEqual(calls[1].input,{expectedVersion:1});assert.equal(calls[1].user.id,'viewer');
    assert.equal((await request('/request-one/reject',{method:'POST',headers:json,body:JSON.stringify({expectedVersion:2})})).body.request.status,'rejected');
    const hidden=await request('/internal-error/approve',{method:'POST',headers:json,body:JSON.stringify({expectedVersion:1})});
    assert.equal(hidden.status,503);assert.equal(hidden.body.error,'organization_service_unavailable');assert(!JSON.stringify(hidden.body).includes('SECRET'));
    assert.equal(hidden.headers.get('cache-control'),'no-store');
    console.log('Organization governance routes: standalone authentication, no-store, cross-site and JSON defenses, strict fields and safe errors passed.');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
