'use strict';
const {randomUUID}=require('node:crypto');
const {AiBudgetReservationService}=require('./aiBudgetReservationService');
const {ExtendedUsageAccumulator,pricedUsage}=require('./extendedUsage');
const enabled=()=>process.env.PANTHORIUM_GEMINI_EXTENDED==='1';
const quota=()=>Object.assign(new Error('quota_exceeded'),{status:402});
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');
class ExtendedQuotaMeter{
  constructor({entitlements,userId,reservations=null}){
    if(!entitlements||!userId)throw new Error('metered_account_required');
    this.entitlements=entitlements;this.userId=userId;this.reservations=reservations||new AiBudgetReservationService({entitlements});
    this.id='extended:'+randomUUID();this.acc=new ExtendedUsageAccumulator();this.held=0;this.observed={};this.context=0;this.receivedUsage=false;this.idle=false;this.dispatched=false;this.started=false;this.closed=false;this.rounds=0;
  }
  async start({systemInstruction='',tools=[],maxOutputTokens=1024}={}){
    await this.reservations.init();const state=await this.entitlements.state(this.userId);
    this.free=state.plan==='free'&&!state.unlimited?.includes('aiCredits');
    this.maximum=state.unlimited?.includes('aiCredits')?Number.MAX_SAFE_INTEGER:Number(state.remaining.aiCredits);
    if(!this.maximum)throw quota();
    this.maxOutputTokens=Math.min(this.free?128:1536,Math.max(32,Number(maxOutputTokens)||1024));
    this.context=(this.free?3000:3500)+bytes(systemInstruction)+bytes(tools);
    this.maxContext=this.free?4096:96000;
    if(this.context>this.maxContext)throw quota();
    const minimum=this.context+this.maxOutputTokens*14;
    if(minimum>this.maximum)throw quota();
    await this.ensure(minimum);this.started=true;
    return {maxOutputTokens:this.maxOutputTokens,thinkingLevel:this.free?'LOW':'MEDIUM'};
  }
  async ensure(target){
    if(this.closed)throw new Error('meter_closed');
    if(target<=this.held)return;
    const state=await this.entitlements.state(this.userId);
    const available=state.unlimited?.includes('aiCredits')?Number.MAX_SAFE_INTEGER:Number(state.remaining.aiCredits);
    const extra=Math.min(Math.max(target-this.held,8192),available);
    if(extra<target-this.held)throw quota();
    this.held+=extra;
    try{await this.reservations.reserve(this.userId,this.id,this.held);}catch(e){this.held-=extra;throw e;}
  }
  async input(frame){
    if(!this.started)throw new Error('meter_not_started');
    let addition=0;
    const media=part=>{
      const mime=part?.mimeType||part?.mime_type||'';
      if(typeof part?.data!=='string')throw new Error('invalid_media_usage');
      const length=Buffer.from(part.data,'base64').length;
      if(/^audio\/pcm/.test(mime)){const rate=Number(/rate=(\d+)/.exec(mime)?.[1]);if(![16000,24000,48000].includes(rate))throw new Error('invalid_audio_usage');addition+=Math.ceil(length/(rate*2)*32)*4;}
      else if(/^image\/(png|jpeg|webp)$/.test(mime)){if(length>4*1024*1024)throw new Error('image_too_large');addition+=4096;}
      else throw new Error('unsupported_media_usage');
    };
    const realtime=frame.realtimeInput||frame.realtime_input;
    if(realtime){if(realtime.text)addition+=bytes(realtime.text);if(realtime.audio)media(realtime.audio);if(realtime.video)media(realtime.video);for(const p of realtime.mediaChunks||realtime.media_chunks||[])media(p);}
    for(const turn of (frame.clientContent||frame.client_content)?.turns||[])for(const p of turn.parts||[]){if(p.text)addition+=bytes(p.text);if(p.inlineData||p.inline_data)media(p.inlineData||p.inline_data);if(p.functionResponse||p.function_response)addition+=bytes(p.functionResponse||p.function_response);}
    if(frame.toolResponse||frame.tool_response){addition+=bytes(frame.toolResponse||frame.tool_response);if(++this.rounds>5)throw new Error('function_call_round_limit');}
    if(this.context+addition>this.maxContext)throw Object.assign(new Error('live_context_limit'),{status:413});
    const spent=pricedUsage(this.observed).credits;
    await this.ensure(spent+this.context+addition+this.maxOutputTokens*14);
    this.context+=addition;this.dispatched=true;this.idle=false;
  }
  async output(frame){
    const event=this.acc.add(frame);this.observed=event.usage;
    if(frame.usageMetadata||frame.usage_metadata)this.receivedUsage=true;
    if(frame.usageMetadata||frame.usage_metadata||event.complete)await this.reservations.settle(this.userId,this.id,this.observed);
    if(event.complete){const u=frame.usageMetadata||frame.usage_metadata;if(u){const measured=require('./extendedUsage').normalizeExtendedUsage(u);const prompt=Object.fromEntries(Object.entries(measured).filter(([key])=>/InputTokens$/.test(key)));this.context=Math.max(this.context,pricedUsage(prompt).credits+(measured.audioOutputTokens||0)*4+(measured.textOutputTokens||0));}}
    if(event.idle){this.idle=true;this.rounds=0;}
    const c=frame.serverContent||frame.server_content;
    if(c?.interactionStatus==='IN_PROGRESS'||c?.interaction_status==='IN_PROGRESS')this.idle=false;
  }
  async close(){
    if(this.closed)return;this.closed=true;
    if(!this.held)return;
    // A transport failure without final evidence keeps its durable hold. Never
    // auto-refund an unknown provider charge on timeout or process restart.
    if((this.idle&&this.receivedUsage)||!this.dispatched){await this.reservations.settle(this.userId,this.id,this.observed,{final:true});await this.entitlements.state(this.userId);}
  }
}
const compactFreeInstruction="You are Sentinel AI. Reply in under ten words in the user's language. No tools.";
module.exports={ExtendedQuotaMeter,enabled,compactFreeInstruction};
