'use strict';
const {advanceUsage,usageCost}=require('./sentinelUsage');
const valid=value=>Number.isSafeInteger(value)&&value>=0;
const identity=value=>typeof value==='string'&&/^[a-zA-Z0-9:_-]{1,180}$/.test(value);

// Debit a bounded request before contacting the provider. Holds survive process
// crashes and never expire into spendable credits without a verified settlement.
// Both holds and normal consumption use the SAME per-account PostgreSQL lock.
class AiBudgetReservationService {
  constructor({entitlements}){this.entitlements=entitlements;this.ready=null;}
  async init(){
    await this.entitlements.init();
    if(!this.ready)this.ready=this.entitlements.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_ai_reservations (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,reserved BIGINT NOT NULL DEFAULT 0,
      allocations JSONB NOT NULL DEFAULT '[]',usage JSONB NOT NULL DEFAULT '{}',
      actual_credits BIGINT NOT NULL DEFAULT 0,nano_usd BIGINT NOT NULL DEFAULT 0,
      promotion BOOLEAN NOT NULL DEFAULT FALSE,state TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE INDEX IF NOT EXISTS panthorium_ai_reservation_owner ON panthorium_ai_reservations(user_id,state);`).catch(error=>{this.ready=null;throw error;});
    await this.ready;
  }
  validate(userId,id){if(!identity(userId)||!identity(id))throw new Error('invalid_reservation_identity');}
  async reserve(userId,id,credits){
    this.validate(userId,id);if(!valid(credits)||credits<1)throw new Error('invalid_reservation_amount');
    await this.init();
    return this.entitlements.locked(userId,async c=>{
      await c.query('INSERT INTO panthorium_ai_reservations(id,user_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[id,userId]);
      const row=(await c.query('SELECT * FROM panthorium_ai_reservations WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId])).rows[0];
      if(!row)throw new Error('reservation_not_found');
      if(row.state!=='open')throw new Error('reservation_closed');
      const held=Number(row.reserved);
      if(credits<=held)return {reserved:held,promotion:row.promotion};
      const debit=await this.entitlements.consumeIn(c,userId,{},credits-held);
      // A promotion crossing its end must start a new reservation. Otherwise
      // free promotional work could refund credits that were never purchased.
      if(held&&row.promotion!==debit.promotion)throw new Error('reservation_period_changed');
      await c.query('UPDATE panthorium_ai_reservations SET reserved=$3,allocations=$4,promotion=$5,updated_at=NOW() WHERE id=$1 AND user_id=$2',
        [id,userId,credits,JSON.stringify([...row.allocations,...debit.allocations]),debit.promotion]);
      return {reserved:credits,promotion:debit.promotion};
    });
  }
  async settle(userId,id,usage,{final=false}={}){
    this.validate(userId,id);await this.init();
    const result=await this.entitlements.locked(userId,async c=>{
      const row=(await c.query('SELECT * FROM panthorium_ai_reservations WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId])).rows[0];
      if(!row)throw new Error('reservation_not_found');
      const next=advanceUsage(row.usage,usage),cost=usageCost(next);
      if(row.state==='settled'){
        if(cost.credits!==Number(row.actual_credits)||cost.nanoUsd!==Number(row.nano_usd))throw new Error('reservation_already_settled');
        return {ok:true,...cost,final:true};
      }
      const exceeded=cost.credits>Number(row.reserved);
      // Preserve known provider cost even if a provider exceeded its limit.
      // Do NOT roll this evidence back when the caller terminates the session.
      const state=exceeded?'overrun':final?'settled':row.state;
      if(final&&!exceeded&&row.state==='open'&&!row.promotion){
        let refund=Number(row.reserved)-cost.credits;
        for(const allocation of [...row.allocations].reverse()){
          const take=Math.min(refund,allocation.credits);if(!take)continue;
          if(allocation.orderId){
            await c.query(`UPDATE panthorium_entitlement_grants SET used=jsonb_set(used,'{aiCredits}',to_jsonb(GREATEST(0,COALESCE((used->>'aiCredits')::bigint,0)-$3::bigint))) WHERE order_id=$1 AND user_id=$2`,[allocation.orderId,userId,take]);
          }else{
            await c.query(`UPDATE panthorium_free_usage SET used=jsonb_set(used,'{aiCredits}',to_jsonb(GREATEST(0,COALESCE((used->>'aiCredits')::bigint,0)-$3::bigint))) WHERE user_id=$1 AND period=$2`,[userId,allocation.period,take]);
          }
          refund-=take;
        }
        if(refund)throw new Error('reservation_allocation_mismatch');
      }
      await c.query('UPDATE panthorium_ai_reservations SET usage=$3,actual_credits=$4,nano_usd=$5,state=$6,updated_at=NOW() WHERE id=$1 AND user_id=$2',
        [id,userId,JSON.stringify(next),cost.credits,cost.nanoUsd,state]);
      return {ok:!exceeded,...cost,final:state==='settled'};
    });
    if(!result.ok)throw Object.assign(new Error('provider_budget_exceeded'),{cost:result});
    return result;
  }
}
module.exports={AiBudgetReservationService};
