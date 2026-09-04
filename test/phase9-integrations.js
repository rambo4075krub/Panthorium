const assert=require('assert');
const{IntegrationRepository}=require('../services/integrationRepository');
const{IntegrationService}=require('../services/integrationService');
(async()=>{
 const repo=new IntegrationRepository();await repo.init();const audit={record(){}};let called=0;
 const service=new IntegrationService({repository:repo,audit,allowedHosts:['hooks.example.com'],resolver:async()=>[{address:'8.8.8.8',family:4}],fetcher:async(url,options)=>{called++;assert.equal(url,'https://hooks.example.com/task');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');return{ok:true,status:200,async text(){return'ok';}};}});
 const admin={sub:'admin-1',permissions:['settings','core:command','chat']};const other={sub:'admin-2',permissions:['settings','core:command','chat']};const guest={sub:'guest:1',permissions:['settings','core:command']};
 assert.equal((await service.create({user:guest,name:'x',endpointUrl:'https://hooks.example.com/task'})).error,'integration_settings_required');
 assert.equal((await service.create({user:admin,name:'bad',endpointUrl:'http://hooks.example.com/task'})).error,'invalid_integration_endpoint');
 assert.equal((await service.create({user:admin,name:'bad',endpointUrl:'https://evil.example.com/task'})).error,'integration_host_not_allowed');
 assert.equal((await service.create({user:admin,name:'bad secret',endpointUrl:'https://hooks.example.com/task',secretEnvKey:'TOKEN'})).error,'invalid_integration_secret_ref');
 const created=await service.create({user:admin,name:'Webhook',endpointUrl:'https://hooks.example.com/task'});assert.equal(created.ok,true);const id=created.integration.integrationId;
 assert.equal((await service.list(admin)).integrations.length,1);assert.equal((await service.list(other)).integrations.length,0);
 assert.equal((await service.invoke({user:other,integrationId:id,payload:{a:1}})).error,'integration_not_found');
 const invoked=await service.invoke({user:admin,integrationId:id,payload:{a:1}});assert.equal(invoked.ok,true);assert.equal(called,1);
 await service.setEnabled({user:admin,integrationId:id,enabled:false});assert.equal((await service.invoke({user:admin,integrationId:id,payload:{}})).error,'integration_disabled');
 assert.equal((await service.remove({user:other,integrationId:id})).error,'integration_not_found');assert.equal((await service.remove({user:admin,integrationId:id})).ok,true);
 console.log('Phase 9 integration foundation tests passed');
})().catch(e=>{console.error(e);process.exit(1);});
