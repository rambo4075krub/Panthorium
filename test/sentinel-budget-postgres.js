'use strict';
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {EntitlementService}=require('../services/entitlementService');
const {AiBudgetReservationService}=require('../services/aiBudgetReservationService');
async function main(){
  const connectionString=process.env.TEST_DATABASE_URL;
  if(!connectionString)throw new Error('TEST_DATABASE_URL required for budget integration');
  const schema='sentinel_budget_test_'+randomBytes(8).toString('hex');
  const admin=new Pool({connectionString,max:1});let pool,created=false;
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    pool=new Pool({connectionString,max:6,options:`-c search_path=${schema},public -c statement_timeout=10000`});
    let now=Date.parse('2026-12-02T00:00:00+07:00');
    const rights=new EntitlementService({pool,now:()=>now}),budget=new AiBudgetReservationService({entitlements:rights});
    await budget.init();const user=randomUUID(),order=randomUUID();
    await pool.query(`INSERT INTO panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at) VALUES($1,$2,'life',$3,NOW()-interval '1 day',NOW()+interval '1 day')`,[order,user,JSON.stringify({category:'membership',quotas:{aiCredits:1000}})]);
    const raced=await Promise.allSettled([budget.reserve(user,'first',800),budget.reserve(user,'second',800)]);
    assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);
    const id=raced[0].status==='fulfilled'?'first':'second';
    assert.equal((await rights.state(user)).remaining.aiCredits,200);
    await assert.rejects(rights.consume(user,{textInputTokens:201}),/quota_exceeded/,'ordinary consumption cannot spend held credits');
    await assert.rejects(budget.reserve('another',id,10),/not_found/);
    const usage={textInputTokens:100,thinkingTokens:20};
    await budget.settle(user,id,usage,{final:true});assert.equal((await rights.state(user)).remaining.aiCredits,800);
    await budget.settle(user,id,usage,{final:true});assert.equal((await rights.state(user)).remaining.aiCredits,800,'settlement retries never refund twice');
    await assert.rejects(budget.settle(user,id,{textInputTokens:101,thinkingTokens:20},{final:true}),/already_settled/);
    await budget.reserve(user,'overrun',300);
    const recreated=new AiBudgetReservationService({entitlements:new EntitlementService({pool,now:()=>now})});
    await recreated.init();assert.equal((await rights.state(user)).remaining.aiCredits,500,'a process restart keeps holds deducted');
    await assert.rejects(recreated.settle(user,'overrun',{textInputTokens:400}),/budget_exceeded/);
    const overrun=(await pool.query("SELECT state,actual_credits,nano_usd FROM panthorium_ai_reservations WHERE id='overrun'")).rows[0];
    assert.equal(overrun.state,'overrun');assert.equal(Number(overrun.actual_credits),400);assert.equal(Number(overrun.nano_usd),300000);
    const free=randomUUID();await budget.reserve(free,'free-period',1000);
    now=Date.parse('2027-01-02T00:00:00+07:00');await budget.settle(free,'free-period',{textInputTokens:100},{final:true});
    assert.equal((await rights.state(free)).remaining.aiCredits,5000,'old-period refund cannot inflate the new monthly grant');
    now=Date.parse('2026-11-18T12:00:00+07:00');const promotional=randomUUID();
    await budget.reserve(promotional,'promotion',1000000);await budget.settle(promotional,'promotion',{textInputTokens:200},{final:true});
    assert.equal((await rights.state(promotional)).remaining.aiCredits,null,'Nov 30 promotion remains unlimited');
    console.log('Budget PostgreSQL: concurrent reservations, shared debit lock, durable holds, idempotent refund, overrun evidence, period rollover and promotion passed');
  }finally{if(pool)await pool.end();if(created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
