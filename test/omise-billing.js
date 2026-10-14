'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const {randomUUID}=require('crypto');
const {OmiseBillingService}=require('../services/omiseBillingService');
const {createBillingRouter}=require('../routes/billing');
class Pool {
  constructor(){this.orders=new Map();this.receipts=new Map();}
  async connect(){return this;}
  release(){}
  async query(sql,p=[]){
    if(sql.startsWith('CREATE') || ['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.startsWith('INSERT INTO panthorium_omise_test_orders')){
      if([...this.orders.values()].some(x=>x.user_id===p[1] && x.request_key===p[2]))return {rows:[]};
      const row={id:p[0],user_id:p[1],request_key:p[2],product_id:p[3],amount:p[4],currency:p[5],status:'creating'};this.orders.set(row.id,row);return {rows:[{...row}]};
    }
    if(sql.includes('SELECT * FROM panthorium_omise_test_orders')){
      const rows=sql.includes('request_key') ? [...this.orders.values()].filter(x=>x.user_id===p[0] && x.request_key===p[1]) : [...this.orders.values()].filter(x=>x.id===p[0] && (!sql.includes('AND user_id') || x.user_id===p[1]));return {rows:rows.map(x=>({...x}))};
    }
    if(sql.startsWith('UPDATE')){const row=this.orders.get(p[0]);if(sql.includes("status='verification_required'")){if(row.status==='creating')row.status='verification_required';}else Object.assign(row,{status:p[1],charge_id:p[2],qr_url:p[3],expires_at:p[4]});return {rows:[{...row}]};}
    if(sql.startsWith('INSERT INTO panthorium_omise_test_receipts')){if(!this.receipts.has(p[0]))this.receipts.set(p[0],p);return {rows:[]};}
    if(sql.startsWith('DELETE')){this.receipts.delete(p[0]);return {rows:[]};}
    throw new Error('unhandled SQL');
  }
}
async function main(){
 const pool=new Pool();let count=0,charge,event,unavailable=false;
 const service=new OmiseBillingService({pool,secret:'skey_test_fixture',fetcher:async(url,options)=>{
  assert.equal(new URL(url).hostname,'api.omise.co');assert(options.headers.Authorization);
  if(unavailable)throw new Error('timeout');
  let data;
  if(url.endsWith('/account'))data={object:'account',livemode:false};
  else if(options.method==='POST'){count++;const form=new URLSearchParams(options.body);assert.equal(form.get('amount'),'18900');assert.equal(form.get('source[type]'),'promptpay');
    charge={object:'charge',id:'chrg_test_fixture',livemode:false,amount:18900,currency:'thb',status:'pending',paid:false,metadata:{panthorium_order_id:form.get('metadata[panthorium_order_id]')},source:{scannable_code:{image:{download_uri:'https://api.omise.co/charges/chrg_test_fixture/documents/docu_test_fixture/downloads/fixture'}}}};data=charge;
  }else data=url.includes('/events/') ? event : charge;
  return {ok:true,status:200,json:async()=>structuredClone(data)};
 }});
 assert.equal((await service.status()).connected,true);
 assert.equal(new OmiseBillingService({pool,secret:'skey_live_fixture'}).configured(),false,'live keys cannot create charges');
 const key=randomUUID();let order=await service.checkout('owner','life',key);
 assert.equal(order.status,'pending');await service.checkout('owner','life',key);assert.equal(count,1,'repeat does not create a second charge');
 await assert.rejects(service.checkout('owner','work',key),/request_key_conflict/);
 await assert.rejects(service.order('other',order.id),/order_not_found/);
 assert.equal(pool.receipts.size,0,'pending does not get a receipt');
 charge.status='successful';charge.paid=true;
 event={id:'evnt_test_fixture',object:'event',livemode:false,data:{id:charge.id}};
 await service.webhook(event.id);await service.webhook(event.id);assert.equal(pool.receipts.size,1,'duplicate callbacks get one test receipt');
 assert.equal((await service.order('owner',order.id)).status,'paid');
 const good=structuredClone(charge);charge.amount=1;await assert.rejects(service.webhook(event.id),/charge_mismatch/);assert.equal(pool.receipts.size,1);charge=good;
 charge.livemode=true;await assert.rejects(service.webhook(event.id),/invalid_charge/);charge.livemode=false;
 charge.refunded_amount=18900;assert.equal((await service.order('owner',order.id)).status,'refunded');assert.equal(pool.receipts.size,0);
 unavailable=true;const uncertainKey=randomUUID();await assert.rejects(service.checkout('owner','life',uncertainKey),/omise_unavailable/);unavailable=false;
 const uncertain=await service.checkout('owner','life',uncertainKey);assert.equal(uncertain.status,'verification_required');assert.equal(count,1,'unknown outcome must not be charged again');
 const app=express();app.use(express.json());app.use('/api/billing',createBillingRouter({verifyAccessToken:t=>({sub:t,roles:t==='guest'?['guest']:['user']})},service));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{const base='http://127.0.0.1:'+server.address().port+'/api/billing';const send=(token,body)=>fetch(base+'/checkout',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 assert.equal((await send(null,{})).status,401);assert.equal((await send('guest',{})).status,403);
 assert.equal((await send('owner',{productId:'life'})).status,400);
 const response=await send('owner',{productId:'life',requestKey:key,testAcknowledged:true,amount:1,status:'paid'});assert.equal(response.status,200);assert.equal((await response.json()).order.amountSatang,18900);
 const forged=await fetch(base+'/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'evnt_live_fake',data:{status:'successful'}})});assert.equal(forged.status,400);
 }finally{await new Promise(r=>server.close(r));}
 console.log('Omise Test: fixed server prices, durable request ownership, duplicate prevention, verified callbacks, refunds, live-key rejection and auth passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
