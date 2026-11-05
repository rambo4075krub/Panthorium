'use strict';
const assert = require('node:assert/strict');
const {randomUUID,randomBytes} = require('node:crypto');
const {Pool} = require('pg');
const {EntitlementService} = require('../services/entitlementService');
async function main(){
  const connectionString=process.env.TEST_DATABASE_URL;
  if(!connectionString){if(process.env.CI)throw new Error('TEST_DATABASE_URL required for shared quota integration');console.log('SKIP shared quota PostgreSQL integration: TEST_DATABASE_URL not set');return;}
  const schema='quota_ci_'+randomBytes(10).toString('hex');
  const admin=new Pool({connectionString,max:1,connectionTimeoutMillis:5000});let pool,created=false;
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    pool=new Pool({connectionString,max:6,options:`-c search_path=${schema},public -c statement_timeout=15000`});
    const rights=new EntitlementService({pool});await rights.init();
    const user=randomUUID(),order=randomUUID();
    await pool.query(`INSERT INTO panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at,used) VALUES($1,$2,'life',$3,NOW()-interval '1 day',NOW()+interval '1 day',$4)`,[order,user,JSON.stringify({category:'membership',quotas:{voiceInputSeconds:20,textInputTokens:1000,downloadBytes:10}}),JSON.stringify({voiceInputSeconds:10})]);
    assert.equal((await rights.state(user)).remaining.aiCredits,2000);
    const raced=await Promise.allSettled([rights.consume(user,{textInputTokens:2000}),rights.consume(user,{voiceInputSeconds:20})]);
    assert.equal(raced.filter(x=>x.status==='fulfilled').length,1,'concurrent text and voice cannot both spend the same shared balance');
    assert.match(raced.find(x=>x.status==='rejected').reason.message,/quota_exceeded/);
    assert.equal((await rights.state(user)).remaining.aiCredits,0);
    const stored=(await pool.query('SELECT used FROM panthorium_entitlement_grants WHERE order_id=$1',[order])).rows[0].used;
    assert.equal(stored.voiceInputSeconds,10);assert.equal(stored.aiCredits,2000);
    await assert.rejects(rights.consume(user,{downloadBytes:1,textInputTokens:1}),/quota_exceeded/);
    assert.equal((await rights.state(user)).remaining.downloadBytes,10,'transaction rollback also restores unrelated download units');
    console.log('Shared quota PostgreSQL: legacy conversion, concurrent text/voice exhaustion and mixed rollback passed');
  }finally{if(pool)await pool.end();if(created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
