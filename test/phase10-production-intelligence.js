const assert=require('assert');
const{ProductionIntelligenceService,clampHours}=require('../services/productionIntelligenceService');

(async()=>{
  assert.equal(clampHours(0),24);
  assert.equal(clampHours(999),168);
  assert.equal(clampHours(6),6);

  const service=new ProductionIntelligenceService();
  const readiness=await service.readiness();
  assert.equal(readiness.ok,true);
  assert.equal(readiness.database.mode,'memory');

  const baseline={
    database:{ok:true},
    process:{heapUsedBytes:20,heapTotalBytes:100},
    aggregate:{
      audit:{total:100,httpErrors:1,rateLimited:0},
      agents:{total:20,failed:1,running:0,waitingConfirmation:0},
      jobs:{total:20,failed:0,running:0,scheduled:0,overdue:0},
      integrations:{total:0,failed:0,remoteErrors:0},
      multiAgent:{total:0,failed:0,running:0,waitingConfirmation:0}
    }
  };
  const healthy=service.evaluate(baseline);
  assert.equal(healthy.status,'healthy');
  assert.equal(healthy.score,100);

  const backlog=JSON.parse(JSON.stringify(baseline));
  backlog.aggregate.jobs.overdue=6;
  const degraded=service.evaluate(backlog);
  assert.equal(degraded.status,'degraded');
  assert(degraded.signals.some(s=>s.code==='AGENT_JOB_BACKLOG'));

  const databaseDown=JSON.parse(JSON.stringify(baseline));
  databaseDown.database.ok=false;
  const critical=service.evaluate(databaseDown);
  assert.equal(critical.status,'critical');

  const errors=JSON.parse(JSON.stringify(baseline));
  errors.aggregate.audit.httpErrors=20;
  assert.equal(service.evaluate(errors).status,'critical');

  const overview=await service.overview(24);
  assert.equal(overview.status,'healthy');
  assert.equal(overview.aggregate.mode,'memory');
  assert(Array.isArray(overview.recommendations));

  console.log('Phase 10 production intelligence tests passed');
})().catch(error=>{console.error(error);process.exit(1);});