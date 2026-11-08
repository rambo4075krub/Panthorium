'use strict';
const ipaddr = require('ipaddr.js');
const { canUseLocal, OWNER_EMAIL } = require('./localAiAccess');
const { accountKey } = require('./localWorkIdentity');
const { failure } = require('./notificationRepository');
const { hash } = require('./localInsightsRepository');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FEATURES = Object.freeze({ chat:'สนทนา AI', social:'โซเชียล', files:'ไฟล์', calendar:'ปฏิทิน', reminders:'เตือนความจำ', notes:'บันทึก', goals:'เป้าหมาย', studio:'สร้างสรรค์เอกสาร', mailbox:'อีเมล', voice:'เสียง' });
const RULES = Object.freeze({
  LOGIN_FAILURE_SPIKE: { family:'login', title:'พบการเข้าสู่ระบบไม่สำเร็จซ้ำ', advice:'ตรวจสอบว่าเป็นเจ้าของบัญชีหรือไม่ และตรวจเซสชันล่าสุด หากไม่รู้จักแหล่งที่มา ให้พิจารณาบล็อกชั่วคราว' },
  LOGIN_BRUTE_FORCE: { family:'login', title:'เสี่ยงถูกเดารหัสผ่าน', advice:'ตรวจเซสชันและบัญชีที่เกี่ยวข้อง ระบบป้องกันการเดารหัสผ่านเดิมยังทำงาน ตรวจการบล็อกก่อนเพิ่มมาตรการ' },
  AUTH_DENIED_SPIKE: { family:'denied', title:'พบคำขอที่ไม่มีสิทธิ์จำนวนมาก', advice:'ตรวจว่าเป็นเซสชันหมดอายุหรือการเข้าถึงผิดสิทธิ์ หากเป็นผู้ใช้งานจริงให้ลงชื่อเข้าใหม่ก่อนพิจารณาบล็อก' },
  AUTH_DENIED_FLOOD: { family:'denied', title:'เสี่ยงถูกยิงคำขอเข้าถึงโดยไม่มีสิทธิ์', advice:'ตรวจต้นทางและช่วงเวลาที่เกิดเหตุ ตรวจผลกระทบต่อผู้ใช้อื่นก่อนบล็อกชั่วคราว' },
  RATE_LIMIT_PRESSURE: { family:'rate', title:'พบคำขอเกินอัตราที่กำหนดซ้ำ', advice:'ตรวจการส่งคำขอซ้ำหรือบอต กฎจำกัดอัตราเดิมยังทำงาน ไม่เพิ่มโควต้าหรือปิดกฎป้องกันอัตโนมัติ' }
});
function featureFor(path) {
  const value = String(path || '').split('?')[0];
  const match = /^\/api\/(chat|social|files|calendar|reminders|notes|goals|studio|creative-studio|user-mailbox|voice|local-ai)(?:\/|$)/.exec(value);
  return match ? ({'creative-studio':'studio','user-mailbox':'mailbox','local-ai':'chat'}[match[1]] || match[1]) : null;
}
function publicIp(value) {
  try { const ip = ipaddr.process(value); return ip.range() === 'unicast' ? ip.toString() : null; } catch { return null; }
}
function summaryInput(counters, incidents) {
  return {
    windowDays:7, features:counters.map(c => ({ feature:FEATURES[c.feature] ? c.feature : 'other', total:Number(c.total)||0, errors:Number(c.errors)||0, denied:Number(c.denied)||0, slow:Number(c.slow)||0 })),
    security:incidents.slice(0,10).filter(i => RULES[i.code]).map(i => ({ code:i.code, count:Math.min(1000000,Number(i.count)||0), severity:i.severity===3?'critical':'warning' }))
  };
}
class LocalInsightsService {
  constructor({ repository, auth, providers, audit, notifications, security, agent, brokerUrl = 'http://127.0.0.1:8765', fetchImpl = global.fetch } = {}) {
    Object.assign(this,{ repository,auth,providers,audit,notifications,security,agent,brokerUrl,fetchImpl });
    this.enabled=false; this.monitoring=false; this.batch=new Map(); this.running=false; this.analyzing=false; this.lastCleanup=0; this.lastScan=0;
  }
  async init() { await this.repository.init(); }
  async operator(userId) { if (!await canUseLocal(this.providers,userId)) throw failure('insights_operator_required',403); }
  async recipients() {
    const admin = await this.auth.repository.findUserByUsername('admin');
    const owner = await this.auth.repository.findUserByEmail(OWNER_EMAIL);
    const result=[];
    if (admin?.roles?.includes('administrator') && await canUseLocal(this.providers,admin.id)) result.push(admin.id);
    if (owner?.emailVerifiedAt && String(owner.email).toLowerCase()===OWNER_EMAIL && await canUseLocal(this.providers,owner.id)) result.push(owner.id);
    return [...new Set(result)];
  }
  start() {
    if (this.timer || !this.repository.ready) return;
    this.unsubscribe=this.audit.subscribe(entry => this.observe(entry));
    this.timer=setInterval(()=>this.tick().catch(()=>{}),15000); this.timer.unref();
    this.tick().catch(()=>{});
  }
  stop() { clearInterval(this.timer); clearTimeout(this.scanTimer); this.timer=null; this.unsubscribe?.(); this.unsubscribe=null; this.abort?.abort(); this.batch.clear(); }
  async setEnabled(userId, enabled) {
    await this.operator(userId); await this.repository.setEnabled(userId,enabled); this.enabled=enabled;
    if (!enabled) { this.abort?.abort(); this.batch.clear(); }
    this.audit.record('insights.control_changed',{actorUserId:userId,enabled});
  }
  observe(entry) {
    if (!this.monitoring) return;
    if (entry.event==='auth.login_failed' || entry.event==='security.ip_blocked' || entry.event==='http.request' && [401,403,429].includes(entry.status)) {
      // Debounce burst traffic; a durable scan recovers missed or restarted observers.
      if (!this.scanTimer) { this.scanTimer=setTimeout(()=>{this.scanTimer=null;this.tick().catch(()=>{});},1000); this.scanTimer.unref(); }
    }
    if (!this.enabled) return;
    const feature=entry.event==='http.request' && featureFor(entry.path);
    if (!feature || !UUID.test(entry.userId||'') || !Number.isInteger(entry.status)) return;
    const now=Date.now(), day=new Date(now).toISOString().slice(0,10), key=[entry.userId,feature,day].join(':');
    if (this.batch.size>=1000 && !this.batch.has(key)) return;
    const item=this.batch.get(key)||{userId:entry.userId,feature,day,since:now,total:0,errors:0,denied:0,slow:0};
    item.total++; item.errors+=Number(entry.status>=500); item.denied+=Number([401,403,429].includes(entry.status)); item.slow+=Number(Number(entry.durationMs)>5000);
    this.batch.set(key,item);
  }
  async signals() {
    if (!this.audit.pool) return (await this.audit.securityAlerts()).alerts.filter(a=>RULES[a.code]);
    // Aggregate the full detection window; do not rely on the dashboard's 500-row sample.
    const rows=(await this.audit.pool.query(`SELECT ip,
      COUNT(*) FILTER(WHERE event='auth.login_failed')::int AS login,
      COUNT(*) FILTER(WHERE event='http.request' AND status IN (401,403) AND time>NOW()-INTERVAL '10 minutes')::int AS denied,
      COUNT(*) FILTER(WHERE event='http.request' AND status=429 AND time>NOW()-INTERVAL '10 minutes')::int AS rate
      FROM panthorium_audit_events WHERE time>NOW()-INTERVAL '15 minutes'
      AND (event='auth.login_failed' OR (event='http.request' AND status IN (401,403,429)))
      AND ip IS NOT NULL GROUP BY ip HAVING COUNT(*)>=5 ORDER BY COUNT(*) DESC LIMIT 200`)).rows;
    const result=[];
    for (const r of rows) {
      if(r.login>=5) result.push({ip:r.ip,count:r.login,code:r.login>=10?'LOGIN_BRUTE_FORCE':'LOGIN_FAILURE_SPIKE',level:r.login>=10?'critical':'warning'});
      if(r.denied>=10) result.push({ip:r.ip,count:r.denied,code:r.denied>=20?'AUTH_DENIED_FLOOD':'AUTH_DENIED_SPIKE',level:r.denied>=20?'critical':'warning'});
      if(r.rate>=5) result.push({ip:r.ip,count:r.rate,code:'RATE_LIMIT_PRESSURE',level:'warning'});
    }
    return result;
  }
  async tick() {
    if(this.running || !this.repository.ready) return;
    this.running=true;
    try {
      const control=await this.repository.control();
      const recipients=await this.recipients();
      // Revoking the model operator cannot silence alerts to the remaining valid recipient.
      this.monitoring=recipients.length>0;
      this.enabled=control.enabled===true && !!control.actor_id && await canUseLocal(this.providers,control.actor_id);
      if(!this.enabled) { this.batch.clear(); this.abort?.abort(); }
      if(!this.monitoring)return;
      const batch=[...this.batch.values()]; this.batch.clear();
      await this.repository.addCounters(batch);
      for(const alert of await this.signals()) {
        const rule=RULES[alert.code]; if(!rule || !this.security.normalizeIp(alert.ip)) continue;
        const incident=await this.repository.recordIncident(alert,rule.family);
        const level=incident.severity===3?'สูง':'ควรตรวจสอบ';
        for(const userId of recipients) await this.repository.enqueue(incident,userId,'detected',{
          userId,category:'security',type:'security.incident',severity:incident.severity===3?'error':'warning',sensitive:true,
          title:rule.title+' • ความเสี่ยง'+level,
          body:`พบ ${incident.count} ครั้ง จาก ${incident.ip} ใน ${incident.family==='login'?15:10} นาที ${rule.advice} เปิด “ความปลอดภัยและสถิติ” เพื่อดูแผนและอนุมัติ การวิเคราะห์ของ Sentinel AI จะตามมาเมื่อเครื่องพร้อม`
        });
      }
      for(const notice of await this.repository.pendingNotices()) {
        if(!recipients.includes(notice.user_id)) { await this.repository.delivered(notice.id); continue; }
        try { await this.notifications.publish(notice.payload); await this.repository.delivered(notice.id); } catch { /* durable retry next tick */ }
      }
      this.lastScan=Date.now();
      if(Date.now()-this.lastCleanup>3600000) { await this.repository.cleanup(); this.lastCleanup=Date.now(); }
      // Inference never delays rule notifications or the request that produced the event.
      if(this.enabled && !this.analyzing) this.analyze().catch(()=>{});
    } catch { this.audit.record('insights.worker_failed',{reason:'monitor_unavailable'}); }
    finally { this.running=false; }
  }
  async analyze() {
    if(this.analyzing) return {ok:false,error:'insights_busy'};
    this.analyzing=true; let control;
    try {
      control=await this.repository.claimAnalysis(); if(!control) return {ok:false,error:'insights_waiting'};
      await this.operator(control.actor_id);
      const counters=await this.repository.aggregate(), incidents=await this.repository.incidents();
      const input=summaryInput(counters,incidents);
      if(!input.features.length && !input.security.length) { await this.repository.finishAnalysis(control,null,'waiting_data'); return {ok:true,state:'waiting_data'}; }
      const url=new URL(this.brokerUrl);
      if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.port!=='8765' || url.username || url.password) throw failure('invalid_insights_broker',503);
      this.abort=new AbortController(); const signal=AbortSignal.any([this.abort.signal,AbortSignal.timeout(35000)]);
      const health=await this.fetchImpl(url+'/health',{signal,redirect:'error'}).then(r=>r.json());
      if(health.backgroundPreemption!==true) throw failure('insights_broker_upgrade_required',503);
      const response=await this.fetchImpl(url+'/v1/chat/completions',{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json','X-Panthorium-Account':accountKey(control.actor_id),'X-Panthorium-Background':'1'},body:JSON.stringify({
        model:'panthorium-local',stream:false,max_tokens:256,temperature:0.2,chat_template_kwargs:{enable_thinking:false},
        messages:[{role:'system',content:'You are Sentinel AI. Analyze these numeric usage/security summaries only. Answer in Thai with at most 3 short improvement or incident-response recommendations, total at most 240 Thai characters, noting uncertainty. No tools, code, personal profiling or instructions to change permissions. Security actions require human approval. Never claim an incident was fixed.'},{role:'user',content:JSON.stringify(input)}]
      })});
      if(!response.ok) throw failure('insights_waiting_idle',503);
      const output=await response.json(), choice=output.choices?.[0];
      if(choice?.finish_reason!=='stop' || choice.message?.tool_calls || typeof choice.message?.content!=='string' || !choice.message.content.trim()) throw failure('insights_incomplete_analysis',503);
      await this.operator(control.actor_id);
      const text=choice.message.content.trim().slice(0,2000);
      const saved=await this.repository.finishAnalysis(control,{text,windowDays:7,featureCount:counters.length,incidentCount:input.security.length,model:'Qwen3.5-9B',advisory:true},'ready');
      if(!saved)return {ok:false,error:'insights_data_changed'};
      const recipients=await this.recipients();
      for(const incident of incidents.filter(i=>i.state==='observed' && Date.now()-new Date(i.last_seen)<15*60000).slice(0,10)) {
        for(const userId of recipients) await this.repository.enqueue(incident,userId,'plan_ready',{
          userId,category:'security',type:'security.plan_ready',severity:'warning',sensitive:true,
          title:'Sentinel AI เตรียมข้อเสนอแนะรับมือแล้ว',
          body:`${RULES[incident.code]?.title||'เหตุการณ์ความปลอดภัย'} จาก ${incident.ip} เปิด “ความปลอดภัยและสถิติ” เพื่อตรวจข้อเสนอแนะ แผน ผลกระทบ และอนุมัติก่อนดำเนินการ`
        });
      }
      // The report is aggregate and advisory. Its text is never interpreted as an action.
      this.audit.record('insights.analysis_completed',{actorUserId:control.actor_id,featureCount:counters.length,incidentCount:input.security.length});
      return {ok:true,state:'ready'};
    } catch { if(control) await this.repository.finishAnalysis(control,null,'waiting_idle').catch(()=>{}); return {ok:false,error:'insights_waiting_idle'}; }
    finally { this.abort=null; this.analyzing=false; }
  }
  async overview(userId) {
    await this.operator(userId);
    const control=await this.repository.control();
    const incidents=await this.repository.incidents();
    const active=new Map((await this.security.listBlocks()).map(b=>[b.source,b]));
    return {enabled:control.enabled,workerStatus:control.worker_status,lastScanAt:this.lastScan?new Date(this.lastScan).toISOString():null,
      report:control.report_at && Date.now()-new Date(control.report_at)<7*86400000?control.report:null,reportAt:control.report_at,
      recipients:await this.recipients(),incidents:incidents.map(i=>({...i,title:RULES[i.code]?.title,advice:RULES[i.code]?.advice,blockActive:active.has('ai:'+i.id),blockExpiresAt:active.get('ai:'+i.id)?.expiresAt||null})),trainingEnabled:false};
  }
  async eligible(incident, userId) {
    const ip=publicIp(incident.ip); if(!ip || !RULES[incident.code] || Date.now()-new Date(incident.last_seen)>15*60000) return false;
    const recipients=[...new Set([userId,...await this.recipients()])];
    const aliases=[...new Set([incident.ip,ip,...(ip.includes(':')?[]:['::ffff:'+ip])])];
    const rows=(await this.repository.pool.query("SELECT 1 FROM panthorium_audit_events WHERE ip=ANY($1::text[]) AND actor_user_id=ANY($2::text[]) AND time>NOW()-INTERVAL '24 hours' LIMIT 1",[aliases,recipients])).rows;
    return !rows.length;
  }
  async plan(user, id, requestIp) {
    await this.operator(user.sub);
    const control=await this.repository.control(); if(!control.enabled) throw failure('insights_disabled',409);
    let incident=await this.repository.incident(id); if(!incident) throw failure('incident_not_found',404);
    if(incident.state!=='observed') throw failure('incident_already_handled',409);
    if(this.security.normalizeIp(requestIp)===this.security.normalizeIp(incident.ip) || !await this.eligible(incident,user.sub)) throw failure('incident_manual_review_required',409);
    if(!incident.plan || Date.parse(incident.plan.expiresAt)<=Date.now()) {
      const targetIp=this.security.normalizeIp(incident.ip);
      const plan={incidentId:id,revision:incident.revision,action:'temporary_ip_block',ip:targetIp,durationMinutes:10,expiresAt:new Date(Date.now()+5*60000).toISOString(),
        summary:`บล็อก IP ${targetIp} ชั่วคราว 10 นาที เพื่อลดคำขอผิดปกติ`,impact:'ผู้ใช้งานที่ใช้ IP เดียวกันอาจเข้าใช้งานไม่ได้ชั่วคราว',rollback:'ยกเลิกการบล็อกนี้ได้ หรือรอครบ 10 นาที',generation:control.action_epoch,
        analysisAvailable:!!(control.report_at && Date.now()-new Date(control.report_at)<7*86400000)};
      plan.hash=hash(plan); incident=await this.repository.savePlan(incident,plan);
    }
    if(!incident?.plan) throw failure('incident_changed',409);
    const result=await this.agent.execute({user,toolId:'security.incident_response',args:{incidentId:id,planHash:incident.plan.hash},requestId:'incident:'+id+':'+incident.plan.hash});
    return {ok:true,plan:incident.plan,approval:result};
  }
  async execute({ user, args }) {
    // Called only after the durable action ledger validates an exact, expiring approval.
    await this.operator(user.sub);
    const evidence=await this.repository.incident(args.incidentId);
    if(!evidence || !await this.eligible(evidence,user.sub)) throw failure('incident_manual_review_required',409);
    const signals=await this.signals();
    if(!signals.some(s=>RULES[s.code]?.family===evidence.family && s.ip===evidence.ip)) throw failure('incident_evidence_expired',409);
    await this.operator(user.sub);
    const result=await this.repository.transaction(async c=>{
      const control=(await c.query('SELECT * FROM panthorium_insights_control WHERE id=1 FOR UPDATE')).rows[0];
      const i=(await c.query('SELECT * FROM panthorium_insights_incidents WHERE id=$1 FOR UPDATE',[args.incidentId])).rows[0];
      const p=i?.plan;
      if(!control.enabled || !p || p.generation!==control.action_epoch || p.hash!==args.planHash || p.revision!==i.revision || Date.parse(p.expiresAt)<=Date.now()) throw failure('incident_plan_expired',409);
      if(i.state!=='observed') throw failure('incident_already_handled',409);
      const source='ai:'+i.id;
      await c.query('DELETE FROM panthorium_security_ip_blocks WHERE ip=$1 AND expires_at<=NOW()',[p.ip]);
      const insert=await c.query(`INSERT INTO panthorium_security_ip_blocks(ip,reason,source,created_at,expires_at,created_by)
        VALUES($1,$2,$3,NOW(),NOW()+INTERVAL '10 minutes',$4) ON CONFLICT(ip) DO NOTHING RETURNING ip`,[p.ip,'Approved incident response',source,user.sub]);
      // Do not extend or overwrite a block installed by another protection rule.
      const state=insert.rowCount?'blocked':'already_protected';
      await c.query('UPDATE panthorium_insights_incidents SET state=$2 WHERE id=$1',[i.id,state]);
      return {ok:true,state,incidentId:i.id,ip:p.ip,durationMinutes:insert.rowCount?10:0};
    });
    this.audit.record('insights.response_completed',{actorUserId:user.sub,incidentId:result.incidentId,state:result.state});
    return result;
  }
  async undo(userId,id) {
    await this.operator(userId);
    const result=await this.repository.transaction(async c=>{
      const incident=(await c.query('SELECT * FROM panthorium_insights_incidents WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!incident || incident.state!=='blocked') throw failure('incident_not_blocked',409);
      // Source ownership prevents removing a newer/manual/automatic protection.
      const removed=await c.query('DELETE FROM panthorium_security_ip_blocks WHERE ip=$1 AND source=$2 RETURNING ip',[this.security.normalizeIp(incident.ip),'ai:'+id]);
      await c.query("UPDATE panthorium_insights_incidents SET state='reverted' WHERE id=$1",[id]);
      return {ok:true,removed:removed.rowCount>0};
    });
    this.audit.record('insights.response_reverted',{actorUserId:userId,incidentId:id,removed:result.removed});
    return result;
  }
}
module.exports={LocalInsightsService,featureFor,publicIp,summaryInput,FEATURES,RULES,UUID};
