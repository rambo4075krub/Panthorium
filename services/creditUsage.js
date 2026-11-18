'use strict';
const {createHash}=require('node:crypto');
const catalog=require('../billing-catalog');
function creditUsage({rows=[],free={},period,membership,promotion}){
  if(promotion)return {unlimited:true,threshold:0,limit:null,remaining:null,spent:null,cycleId:null};
  const quotas=membership?[]:[{quotas:catalog.get('free').quotas,used:free}];
  quotas.push(...rows.map(r=>({quotas:r.snapshot.quotas||{},used:r.used||{}})));
  let limit=0,remaining=0;
  for(const q of quotas){limit+=q.quotas.aiCredits??catalog.creditCost(q.quotas);remaining+=catalog.creditBalance(q.quotas,q.used);}
  const spent=Math.max(0,limit-remaining);
  const threshold=limit>0?(remaining===0?100:spent>=Math.ceil(limit*.95)?95:spent>=Math.ceil(limit*.9)?90:0):0;
  const cycleId=createHash('sha256').update(JSON.stringify([membership?.order_id||'free:'+period,...rows.filter(r=>r.snapshot.quotas?.aiCredits||catalog.creditCost(r.snapshot.quotas||{})).map(r=>r.order_id).sort()])).digest('hex').slice(0,32);
  return {unlimited:false,limit,remaining,spent,threshold,cycleId};
}
module.exports={creditUsage};
