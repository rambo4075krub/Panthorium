'use strict';
const assert = require('node:assert/strict');
const { CloudAppRuntime } = require('../services/cloudAppRuntime');
const { CloudAppRepository } = require('../services/cloudAppRepository');
async function main() {
  const repository = new CloudAppRepository({allowMemory:true}); await repository.init();
  let providerAborted = false;
  const workerA = new CloudAppRuntime({repository,complete:({signal}) => new Promise((resolve,reject) => {
    signal.addEventListener('abort',() => { providerAborted = true; reject(new Error('aborted')); },{once:true});
  })});
  const workerB = new CloudAppRuntime({repository});
  const user = {sub:'cancel-owner',permissions:['chat']};
  const session = await workerA.launch({user,packId:'profession_1',scope:'work'});
  const pending = workerA.execute({user,sessionId:session.id,featureId:'profession_1_f1',input:'เตรียมแผนการเรียนจากข้อมูลนี้',idempotencyKey:'cancel-across-workers'});
  let runs = [];
  for (let i=0;i<50 && !runs.length;i++) {
    await new Promise(resolve=>setImmediate(resolve));
    runs = await workerB.list({user,scope:'work'});
  }
  assert.equal(runs.length,1);
  assert.equal(workerB.controllers.size,0,'Cancelling replica does not hold the provider connection');
  assert.equal((await workerB.cancel({user,runId:runs[0].id})).status,'cancelled');
  const result = await Promise.race([pending,new Promise((_,reject)=>{
    const deadline=setTimeout(()=>reject(new Error('cross-worker provider was not aborted')),4000); deadline.unref();
  })]);
  assert.equal(result.status,'cancelled'); assert.equal(providerAborted,true);
  assert.equal(workerA.controllers.size,0);
  console.log('Cloud-app cancellation closes a provider owned by another replica');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
