'use strict';
// Explicit operator smoke: synthetic data in an isolated schema, removed in
// finally. Never logs keys, prompts, audio, transcripts or real account data.
process.env.PANTHORIUM_GEMINI_EXTENDED='1';
const {Pool}=require('pg');
const {randomBytes,randomUUID}=require('node:crypto');
const {EntitlementService}=require('../../services/entitlementService');
const {completeLive}=require('../../services/geminiLiveCompletion');
async function main(){
  if(!process.env.TEST_DATABASE_URL||!process.env.PANTHORIUM_GEMINI_API_KEY)throw new Error('smoke_configuration_required');
  const schema='extended_live_smoke_'+randomBytes(8).toString('hex');
  const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});let pool;
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:3,options:`-c search_path=${schema},public -c statement_timeout=10000`});
    const entitlements=new EntitlementService({pool,now:()=>Date.parse('2026-12-02T00:00:00+07:00')});await entitlements.init();
    const paid=randomUUID();await pool.query(`INSERT INTO panthorium_entitlement_grants(order_id,user_id,product_id,snapshot,starts_at,ends_at) VALUES($1,$2,'life',$3,NOW()-interval '1 hour',NOW()+interval '1 hour')`,[randomUUID(),paid,JSON.stringify({category:'membership',quotas:{aiCredits:750000}})]);
    const toolFixture=process.env.TEST_EXTENDED_TOOLS?require(process.env.TEST_EXTENDED_TOOLS):null;
    const cases=[{name:'paid_text',userId:paid,systemPrompt:'You are Sentinel AI. Answer briefly.',history:[{role:'user',content:'Say only the number four.'}]},
      {name:'paid_tool',userId:paid,systemPrompt:'You are Sentinel AI. The probe number is only available from panthorium_probe_number. Always call that tool when asked for the probe number. After the result, say only its number.',history:[{role:'user',content:'What is the probe number? Call the tool.'}],tools:[{name:'panthorium_probe_number',description:'Return the probe number.',parameters:{type:'OBJECT',properties:{}}}]},
      {name:'free_text',userId:randomUUID(),systemPrompt:'Ignored for the compact trial.',history:[{role:'user',content:'หนึ่งบวกหนึ่งเท่ากับเท่าไร ตอบสั้น ๆ'}]}];
    if(toolFixture)cases.push({name:'paid_full_tools',userId:paid,systemPrompt:'You are Sentinel AI. Use panthorium_calculate for arithmetic. After its result, answer only the number.',history:[{role:'user',content:'What is 2 + 2? Use the calculator.'}],tools:toolFixture});
    if(process.env.TEST_EXTENDED_CASE)cases.splice(0,cases.length,...cases.filter(item=>item.name===process.env.TEST_EXTENDED_CASE));
    let failed=false;
    for(const item of cases){let calls=0;const usage=[];
      try{const answer=await completeLive({...item,entitlements,onUsage:async event=>usage.push(event.usage),onFunctionCalls:async values=>{calls+=values.length;return values.map(value=>({id:value.id,name:value.name,response:{number:4}}));}});
        const rows=(await pool.query('SELECT reserved,actual_credits,nano_usd,state,usage FROM panthorium_ai_reservations WHERE user_id=$1 ORDER BY created_at',[item.userId])).rows;
        const ok=answer.text.length>0&&(!['paid_tool','paid_full_tools'].includes(item.name)||calls>0)&&rows.every(row=>row.state==='settled');failed ||=!ok;
        console.log(JSON.stringify({case:item.name,ok,responseCharacters:answer.text.length,calls,rows,providerUsage:usage}));
      }catch(error){failed=true;console.log(JSON.stringify({case:item.name,ok:false,error:String(error.message).replace(/AIza\S+/g,'[redacted]').slice(0,160),providerUsage:usage}));}
    }
    if(failed)process.exitCode=1;
  }finally{if(pool)await pool.end();await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}
}
main().catch(error=>{console.log(JSON.stringify({ok:false,errorType:error.name}));process.exitCode=1;});
