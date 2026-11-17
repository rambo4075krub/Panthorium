'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const Stripe = require('stripe');
const { StripeBillingService } = require('../services/stripeBillingService');
const { CheckoutOrderStore } = require('../services/checkoutOrderStore');
const { BillingAdminService } = require('../services/billingAdminService');
async function run() {
  if (!process.env.TEST_DATABASE_URL) throw Error('TEST_DATABASE_URL is required; production databases are never used');
  const schema = 'stripe_test_' + randomUUID().replaceAll('-','');
  const admin = new Pool({connectionString:process.env.TEST_DATABASE_URL});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path='+schema});
  const sessions = new Map(), keys = new Map(), disputes = new Map(), refunds = new Map();
  const webhooks = new Stripe('sk_test_fixture').webhooks;
  let creates=0, loseResponse=false;
  const clone = value => structuredClone(value);
  const client = {webhooks,checkout:{sessions:{
    list:async()=>({data:[]}),
    create:async(params,options)=>{
      assert.equal(params.mode,'payment'); assert.equal(params.payment_method_types,undefined); assert.match(params.integration_identifier,/_[a-z]{8}$/);
      assert.equal(params.line_items.length,1); assert.equal(params.line_items[0].quantity,1);
      assert(!params.success_url.includes('token')); assert(!params.success_url.includes('user'));
      if(keys.has(options.idempotencyKey)){const old=keys.get(options.idempotencyKey);assert.deepEqual(params,old.params);return clone(sessions.get(old.id));}
      creates++;
      const id='cs_fixture_'+randomUUID();
      const session={id,object:'checkout.session',livemode:true,mode:'payment',metadata:params.metadata,client_reference_id:params.client_reference_id,amount_total:params.line_items[0].price_data.unit_amount,currency:params.line_items[0].price_data.currency,status:'open',payment_status:'unpaid',payment_intent:null,expires_at:Math.floor(Date.now()/1000)+86400,url:'https://checkout.stripe.com/c/pay/'+id};
      sessions.set(id,session); keys.set(options.idempotencyKey,{id,params:clone(params)});
      if(loseResponse){loseResponse=false;throw Error('timeout');} return clone(session);
    },
    retrieve:async id=>{if(!sessions.has(id))throw Error('not found');return clone(sessions.get(id));},
    expire:async id=>{sessions.get(id).status='expired';return clone(sessions.get(id));}
  }},refunds:{list:({charge})=>({async *[Symbol.asyncIterator](){for(const r of refunds.get(charge)||[])yield clone(r);}})},disputes:{retrieve:async id=>clone(disputes.get(id)),list:async()=>({data:[...disputes.values()],has_more:false})},paymentIntents:{retrieve:async id=>clone([...sessions.values()].find(s=>s.payment_intent?.id===id).payment_intent)},charges:{retrieve:async id=>clone([...sessions.values()].find(s=>s.payment_intent?.latest_charge?.id===id).payment_intent.latest_charge)}};
  const service = new StripeBillingService({pool,secret:'rk_live_fixture',webhookSecret:'whsec_fixture',mode:'live',liveEnabled:true,client});
  const event = async (type,object) => {
    const raw=Buffer.from(JSON.stringify({id:'evt_'+randomUUID(),object:'event',type,livemode:true,created:Math.floor(Date.now()/1000),data:{object:clone(object)}}));
    return service.webhook(raw,webhooks.generateTestHeaderString({payload:raw.toString(),secret:'whsec_fixture'}));
  };
  const pay = row => {
    const session=sessions.get(row.provider_id),piId='pi_'+row.id;
    session.status='complete';session.payment_status='paid';session.url=null;
    session.payment_intent={id:piId,livemode:true,amount:row.amount,currency:'thb',status:'succeeded',metadata:session.metadata,latest_charge:{id:'ch_'+row.id,payment_intent:piId,livemode:true,paid:true,captured:true,amount:row.amount,amount_captured:row.amount,currency:'thb',created:Math.floor(Date.now()/1000),amount_refunded:0,disputed:false}};
    session.payment_intent.latest_charge.balance_transaction={id:'txn_'+row.id,object:'balance_transaction',source:'ch_'+row.id,created:Math.floor(Date.now()/1000)};
    return session;
  };
  try {
    assert.equal((await service.status()).checkoutEnabled,true);
    const key=randomUUID();
    const pair=await Promise.all([service.checkout('alice','life',key),service.checkout('alice','life',key)]);
    assert.equal(pair[0].id,pair[1].id);assert.equal(creates,1);assert.equal(pair[0].amountSatang,18900);
    assert.equal((await pool.query('SELECT COUNT(*) FROM panthorium_entitlement_grants')).rows[0].count,'0');
    await assert.rejects(service.checkout('alice','work',key),/request_key_conflict/);
    await assert.rejects(service.order('bob',pair[0].id),/order_not_found/);
    const play=new CheckoutOrderStore({pool,live:true});
    await assert.rejects(play.begin('google_play','alice','work',randomUUID()),/pending_membership_exists/);
    const row=await service.store.get(pair[0].id,'stripe'); const session=pay(row);
    const validAmount=session.amount_total;session.amount_total=1;
    await assert.rejects(event('checkout.session.completed',session),/payment_mismatch/);session.amount_total=validAmount;
    session.payment_status='unpaid';await event('checkout.session.completed',session);
    assert.equal((await pool.query('SELECT COUNT(*) FROM panthorium_entitlement_grants')).rows[0].count,'0');
    session.payment_status='paid';
    const verifiedBalance=session.payment_intent.latest_charge.balance_transaction;
    session.payment_intent.latest_charge.balance_transaction=null;
    await assert.rejects(event('checkout.session.async_payment_succeeded',session),/payment_verification_required/);
    assert.equal((await pool.query('SELECT COUNT(*) FROM panthorium_entitlement_grants')).rows[0].count,'0');
    session.payment_intent.latest_charge.balance_transaction=verifiedBalance;
    session.payment_intent.latest_charge.created=verifiedBalance.created-86400;
    await Promise.all([event('checkout.session.async_payment_succeeded',session),event('checkout.session.completed',session),service.order('alice',row.id)]);
    let grants=(await pool.query('SELECT * FROM panthorium_entitlement_grants')).rows;
    assert.equal(grants.length,1);assert.equal(grants[0].user_id,'alice');const expiry=grants[0].ends_at.toISOString();
    assert.equal(grants[0].starts_at.toISOString(),new Date(verifiedBalance.created*1000).toISOString());
    assert.equal((await service.store.rights.state('alice')).plan,'life');
    assert.equal((await service.store.rights.state('alice')).automaticRenewal,false);
    await assert.rejects(service.checkout('alice','work',randomUUID()),/membership_already_active/);
    await assert.rejects(play.begin('google_play','alice','work',randomUUID()),/membership_already_active/);
    assert.equal((await pool.query("SELECT COUNT(*) FROM panthorium_finance_entries WHERE kind='income'")).rows[0].count,'1');
    // An expired session cannot retract a verified payment.
    session.status='expired';session.payment_status='unpaid';await event('checkout.session.expired',session);
    assert.equal((await service.store.get(row.id,'stripe')).status,'paid');session.status='complete';session.payment_status='paid';
    const charge=session.payment_intent.latest_charge;charge.disputed=true;
    const dispute={id:'dp_fixture',charge:charge.id,livemode:true,status:'needs_response'};disputes.set(dispute.id,dispute);
    await event('charge.dispute.created',dispute);assert.equal((await service.store.rights.state('alice')).plan,'free');
    dispute.status='won';await event('charge.dispute.closed',dispute);
    assert.equal((await service.store.rights.state('alice')).plan,'life');
    grants=(await pool.query('SELECT * FROM panthorium_entitlement_grants')).rows;assert.equal(grants[0].ends_at.toISOString(),expiry);
    charge.amount_refunded=100;
    refunds.set(charge.id,[{id:'re_fixture',charge:charge.id,status:'succeeded',amount:100,currency:'thb',created:Math.floor(Date.now()/1000)}]);
    await event('charge.refunded',charge);await event('charge.refunded',charge);
    assert.equal((await service.store.rights.state('alice')).plan,'free');
    assert.equal((await pool.query("SELECT COUNT(*) FROM panthorium_finance_entries WHERE kind='refund'")).rows[0].count,'1');
    await event('checkout.session.completed',session);assert.equal((await service.store.get(row.id,'stripe')).status,'refunded');
    // The same durable request recovers a lost creation response.
    loseResponse=true;const recoveryKey=randomUUID();await assert.rejects(service.checkout('bob','life',recoveryKey),/stripe_unavailable/);
    const before=creates;const recovered=await service.checkout('bob','life',recoveryKey);assert.equal(creates,before);assert.equal(recovered.status,'pending');
    assert.equal((await service.cancel('bob',recovered.id)).status,'expired');
    await assert.rejects(service.webhook(Buffer.from('{}'),'fake'),/invalid_signature/);
    const malformed=Buffer.from(JSON.stringify({livemode:false,type:'irrelevant'}));
    await assert.rejects(service.webhook(malformed,webhooks.generateTestHeaderString({payload:malformed.toString(),secret:'whsec_fixture'})),/payment_mismatch/);
    // Test mode uses a separate order table and never grants real quotas.
    const sandbox=new CheckoutOrderStore({pool,live:false});const trial=await sandbox.begin('stripe','test-owner','life',randomUUID());
    await sandbox.settle(trial,{status:'paid',providerId:'cs_test_only',paymentId:'pi_test_only',paidAt:new Date().toISOString()});
    assert.equal((await pool.query("SELECT COUNT(*) FROM panthorium_entitlement_grants WHERE user_id='test-owner'")).rows[0].count,'0');
    const adminService=new BillingAdminService({pool,live:false,primaryBilling:service,additionalBilling:[service],entitlements:()=>service.store.rights});
    const list=await adminService.orders({});assert(list.some(o=>o.id===row.id&&o.provider==='stripe'));
    await adminService.sync({},'admin');
    assert.equal((await pool.query("SELECT COUNT(*) FROM panthorium_finance_entries WHERE kind='income'")).rows[0].count,'1');
    console.log('Stripe/PostgreSQL: concurrency, server prices, ownership, signed events, async payment, retry recovery, shared grants, refund/dispute lifecycle and finance deduplication passed');
  } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
