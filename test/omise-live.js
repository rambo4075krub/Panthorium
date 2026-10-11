'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('crypto');
const {OmiseBillingService}=require('../services/omiseBillingService');
const {EntitlementService}=require('../services/entitlementService');
const {LiveQuotaMeter}=require('../services/liveQuotaMeter');
class Pool {
  constructor(){this.orders=new Map();this.receipts=new Map();this.grants=new Map();this.free=new Map();}
  async connect(){return this;}
  release(){}
  async query(sql,p=[]){
    if(sql.startsWith('CREATE') || sql.includes('pg_advisory'))return {rows:[]};
    if(sql==='BEGIN'){this.backup=structuredClone({orders:this.orders,receipts:this.receipts,grants:this.grants,free:this.free});return {rows:[]};}
    if(sql==='ROLLBACK'){Object.assign(this,this.backup);return {rows:[]};}if(sql==='COMMIT')return {rows:[]};
    if(sql.startsWith('INSERT INTO panthorium_omise_live_orders')){if([...this.orders.values()].some(x=>x.user_id===p[1]&&x.request_key===p[2]))return {rows:[]};const r={id:p[0],user_id:p[1],request_key:p[2],product_id:p[3],amount:p[4],currency:p[5],product_snapshot:JSON.parse(p[6]),status:'creating'};this.orders.set(r.id,r);return {rows:[{...r}]};}
    if(sql.startsWith('SELECT * FROM panthorium_omise_live_orders')){return {rows:[...this.orders.values()].filter(r=>sql.includes('request_key') ? r.user_id===p[0]&&r.request_key===p[1] : r.id===p[0]&&(!sql.includes('AND user_id')||r.user_id===p[1])).map(r=>({...r}))};}
    if(sql.startsWith('UPDATE panthorium_omise_live_orders')){const r=this.orders.get(p[0]);if(sql.includes("status='failed'"))r.status='failed';else if(sql.includes("status='verification_required'"))r.status='verification_required';else Object.assign(r,{status:p[1],charge_id:p[2],qr_url:p[3],expires_at:p[4]});return {rows:[{...r}]};}
    if(sql.startsWith('INSERT INTO panthorium_omise_live_receipts')){if(!this.receipts.has(p[0]))this.receipts.set(p[0],p);return {rows:[]};}
    if(sql.startsWith('DELETE FROM panthorium_omise_live_receipts')){this.receipts.delete(p[0]);return {rows:[]};}
    if(sql.startsWith('INSERT INTO panthorium_entitlement_grants')){if(!this.grants.has(p[0])){const end=new Date(p[4]);if(p[5]==='1 month')end.setUTCMonth(end.getUTCMonth()+1);else end.setUTCDate(end.getUTCDate()+30);this.grants.set(p[0],{order_id:p[0],user_id:p[1],product_id:p[2],snapshot:JSON.parse(p[3]),starts_at:p[4],ends_at:end.toISOString(),used:{},revoked_at:null});}return {rows:[]};}
    if(sql.startsWith('SELECT * FROM panthorium_entitlement_grants'))return {rows:structuredClone([...this.grants.values()].filter(r=>r.user_id===p[0]&&!r.revoked_at&&new Date(r.starts_at)<=new Date()&&new Date(r.ends_at)>new Date()).sort((a,b)=>new Date(a.ends_at)-new Date(b.ends_at)))};
    if(sql.startsWith('UPDATE panthorium_entitlement_grants')){const r=this.grants.get(p[0]);if(sql.includes('revoked_at'))r.revoked_at=new Date().toISOString();else r.used=JSON.parse(p[1]);return {rows:[]};}
    if(sql.startsWith('INSERT INTO panthorium_free_usage')){if(!this.free.has(p.join(':')))this.free.set(p.join(':'),{});return {rows:[]};}
    if(sql.startsWith('SELECT used FROM panthorium_free_usage')){const used=this.free.get(p.join(':'));return {rows:used ? [{used:structuredClone(used)}]:[]};}
    if(sql.startsWith('UPDATE panthorium_free_usage')){this.free.set(p.slice(0,2).join(':'),JSON.parse(p[2]));return {rows:[]};}
    throw new Error('Unhandled SQL: '+sql);
  }
}
async function main(){
  const pool=new Pool();let charge;let creates=0;
  const service=new OmiseBillingService({pool,mode:'live',liveEnabled:true,secret:'skey_fixture',fetcher:async(url,options)=>{
    let data;
    if(url.endsWith('/account'))data={object:'account',livemode:true};
    else if(options.method==='POST'){creates++;const p=new URLSearchParams(options.body);assert.equal(p.get('amount'),'18900');assert(!p.get('description').includes('TEST'));charge={id:'chrg_fixture',object:'charge',livemode:true,amount:18900,currency:'thb',status:'pending',paid:false,metadata:{panthorium_order_id:p.get('metadata[panthorium_order_id]')},source:{scannable_code:{image:{download_uri:'https://api.omise.co/charges/chrg_fixture/documents/docu_fixture/downloads/code'}}}};data=charge;}
    else if(url.includes('/events/'))data={object:'event',id:'evnt_fixture',livemode:true,data:{id:charge.id}};
    else if(url.includes('/downloads/'))return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>',{headers:{'Content-Type':'image/svg+xml'}});
    else data=charge;
    return {ok:true,status:200,json:async()=>structuredClone(data)};
  }});
  assert.equal(new OmiseBillingService({pool,mode:'live',secret:'skey_fixture'}).configured(),false,'live needs explicit activation');
  assert.equal(new OmiseBillingService({pool,mode:'live',liveEnabled:true,secret:'skey_test_fixture'}).configured(),false,'test key cannot activate live');
  assert.equal((await service.status()).mode,'live');
  const user=randomUUID(),key=randomUUID();let order=await service.checkout(user,'life',key);
  await service.checkout(user,'life',key);assert.equal(creates,1);assert.equal(pool.grants.size,0);
  await assert.rejects(service.qr('other',order.id),/order_not_found/);
  assert.equal((await service.qr(user,order.id)).type,'image/svg+xml');
  const good=structuredClone(charge);charge.livemode=false;await assert.rejects(service.order(user,order.id),/invalid_charge/);charge=good;
  charge.status='successful';charge.paid=true;charge.paid_at=new Date().toISOString();
  await service.webhook('evnt_fixture');await service.webhook('evnt_fixture');assert.equal(pool.grants.size,1);assert.equal(pool.receipts.size,1);
  const rights=service.entitlements();let state=await rights.state(user);assert.equal(state.plan,'life');assert.equal(state.remaining.storageBytes,1024**3);
  await assert.rejects(rights.checkPurchase(user,require('../billing-catalog').get('work')),/membership_already_active/);
  await rights.consume(user,{voiceInputSeconds:10,textInputTokens:20});state=await rights.state(user);assert.equal(state.remaining.voiceInputSeconds,3890);assert.equal(state.remaining.textInputTokens,62480);
  await assert.rejects(rights.consume(user,{voiceInputSeconds:100000}),/quota_exceeded/);assert.equal((await rights.state(user)).remaining.voiceInputSeconds,3890,'failure rolls consumption back');
  assert.equal((await rights.state('other')).plan,'free');await assert.rejects(rights.checkPurchase('other',require('../billing-catalog').get('storage-5')),/paid_membership_required/);
  await rights.consume('free',{voiceInputSeconds:40,voiceOutputSeconds:20});await assert.rejects(rights.consume('free',{voiceOutputSeconds:1}),/dailyVoiceSeconds/);
  const expiry=pool.grants.get(order.id).ends_at;await service.webhook('evnt_fixture');assert.equal(pool.grants.get(order.id).ends_at,expiry,'retries never renew entitlement expiry');
  charge.refunded_amount=18900;await service.webhook('evnt_fixture');assert.equal((await rights.state(user)).plan,'free');assert.equal(pool.receipts.size,1,'live receipt retained for audit');
  const calls=[];const meter=new LiveQuotaMeter({userId:user,entitlements:{consume:async(id,amounts)=>calls.push({id,amounts})}});
  const pcm=Buffer.alloc(3200).toString('base64');await meter.input({realtimeInput:{audio:{mimeType:'audio/pcm;rate=16000',data:pcm}}});await meter.input({realtimeInput:{audio:{mimeType:'audio/pcm;rate=16000',data:pcm}}});
  assert.equal(calls.reduce((n,c)=>n+(c.amounts.voiceInputSeconds||0),0),1,'round cumulative audio, not each chunk');
  await meter.output({usageMetadata:{promptTokensDetails:[{modality:'TEXT',tokenCount:100}],responseTokensDetails:[{modality:'TEXT',tokenCount:20}]}});
  await meter.output({usageMetadata:{promptTokensDetails:[{modality:'TEXT',tokenCount:100}],responseTokensDetails:[{modality:'TEXT',tokenCount:20}]}});
  assert.equal(calls.reduce((n,c)=>n+(c.amounts.textInputTokens||0),0),100,'cumulative token report is billed once');
  console.log('Omise Live: activation gate, provider verification, owner-only QR, grants/refunds, expiry, quotas, daily Free limit and cumulative Live metering passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
