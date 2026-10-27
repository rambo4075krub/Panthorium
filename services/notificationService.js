'use strict';
const { createHash, randomUUID } = require('crypto');
const { failure } = require('./notificationRepository');
const eventCatalog = require('../notification-event-catalog');

const CATEGORY_LABELS = Object.freeze({ system: 'ระบบ', security: 'ความปลอดภัยและบัญชี', operations: 'การดำเนินการ', reminders: 'การเตือนและกำหนดเวลา', calendar: 'ปฏิทิน', files: 'ไฟล์และเอกสาร', social: 'Social Media', billing: 'แพ็กเกจและชำระเงิน', ai: 'Sentinel AI' });
const DEFAULT_SETTINGS = Object.freeze({ enabled: true,
  channels: Object.freeze({ inApp: false, browser: false, sound: false, voice: false }),
  categories: Object.freeze(Object.fromEntries(Object.keys(CATEGORY_LABELS).map(key => [key,true]))),
  events: eventCatalog.defaults,
  quietHours: Object.freeze({ enabled: false, start: '22:00', end: '07:00', timeZone: 'Asia/Bangkok' }),
  privacyPreview: false, askBeforeNotify: true });
const RETENTION_DAYS = 90;
const NOTICE_ID = /^notice_[a-f0-9]{64}$/;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
function validateSettingsPatch(patch) {
  if (!plain(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !own(DEFAULT_SETTINGS,key))) return 'invalid_notification_settings';
  for (const key of ['enabled','privacyPreview','askBeforeNotify']) if (own(patch,key) && typeof patch[key] !== 'boolean') return 'invalid_notification_settings';
  for (const key of ['channels','categories','events']) {
    if (!own(patch,key)) continue;
    if (!plain(patch[key]) || !Object.keys(patch[key]).length || Object.entries(patch[key]).some(([field,value]) => !own(DEFAULT_SETTINGS[key],field) || typeof value !== 'boolean')) return 'invalid_notification_settings';
  }
  if (own(patch,'quietHours')) {
    const quiet = patch.quietHours;
    if (!plain(quiet) || !Object.keys(quiet).length || Object.keys(quiet).some(key => !own(DEFAULT_SETTINGS.quietHours,key))) return 'invalid_notification_quiet_hours';
    if (own(quiet,'enabled') && typeof quiet.enabled !== 'boolean') return 'invalid_notification_quiet_hours';
    for (const key of ['start','end']) if (own(quiet,key) && (typeof quiet[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet[key]))) return 'invalid_notification_quiet_hours';
    if (own(quiet,'timeZone')) {
      if (!text(quiet.timeZone,64)) return 'invalid_notification_quiet_hours';
      try { new Intl.DateTimeFormat('en-US',{timeZone:quiet.timeZone}).format(); } catch { return 'invalid_notification_quiet_hours'; }
    }
  }
  return null;
}
function validUserId(value) { return text(value,256) && !/^guest[:_-]/i.test(value); }
function publicItem(value) { if (!value) return null; const { userId, deletedAt, ...rest } = value; return {...rest,eventKey:eventCatalog.keyFor(rest)}; }
function operationTitle(state, toolId) {
  const title = ({awaiting_confirmation:'มีการดำเนินการรอการยืนยัน',running:'เริ่มดำเนินการแล้ว',succeeded:'ดำเนินการสำเร็จ',failed:'ดำเนินการไม่สำเร็จ',cancel_requested:'รับคำขอยกเลิกการดำเนินการแล้ว',unknown:'ยังยืนยันผลการดำเนินการไม่ได้'})[state];
  if (!title) return undefined;
  const prefix = String(toolId || '').split('.')[0];
  const domain = ({ calendar:'ปฏิทิน',reminders:'การตั้งเตือน',files:'ไฟล์',studio:'สร้างสรรค์และเอกสาร',media:'สื่อ',social:'Social Media',billing:'แพ็กเกจและชำระเงิน',notes:'บันทึก',goals:'เป้าหมาย',memory:'ความจำ Sentinel' })[prefix];
  return domain ? domain + ': ' + title : title;
}
function operationBody(state, startedAt) {
  return ({awaiting_confirmation:'ตรวจรายละเอียดและยืนยันในหน้าต่างคำสั่งก่อนระบบดำเนินการ',running:'ระบบกำลังดำเนินการตามคำขอของคุณ',succeeded:'ระบบบันทึกผลสำเร็จแล้ว ตรวจรายละเอียดได้ในประวัติการดำเนินการ',failed:'ระบบรายงานว่าไม่สำเร็จ ตรวจรายละเอียดก่อนลองใหม่',cancel_requested:startedAt?'งานเริ่มแล้ว คำขอยกเลิกยังไม่รับประกันว่าจะหยุดผลที่เกิดขึ้น':'ยกเลิกก่อนเริ่มดำเนินการแล้ว',unknown:'ยังไม่ทราบผลแน่นอน โปรดตรวจสถานะก่อนสั่งซ้ำ'})[state];
}

// Copy only generic, allowlisted descriptions. Audit metadata may contain private payloads.
const AUDIT_EVENTS = Object.freeze({
  'auth.login_success':['security','เข้าสู่ระบบสำเร็จ','มีการเข้าสู่ระบบด้วยบัญชีของคุณ'],
  'auth.user_access_updated':['security','สิทธิ์บัญชีมีการเปลี่ยนแปลง','ตรวจสอบสิทธิ์และเซสชันของคุณในหน้าบัญชี'],
  'auth.user_password_reset':['security','รหัสผ่านบัญชีถูกเปลี่ยนแล้ว','หากคุณไม่ได้ร้องขอ โปรดตรวจสอบความปลอดภัยของบัญชี'],
  'auth.voice_password_reset':['security','รหัสผ่านบัญชีถูกเปลี่ยนแล้ว','หากคุณไม่ได้ร้องขอ โปรดตรวจสอบความปลอดภัยของบัญชี'],
  'security.ip_blocked':['security','เพิ่มการป้องกันการเข้าถึงแล้ว','ตรวจสอบเหตุการณ์ได้ในหน้าความปลอดภัย'],
  'security.ip_unblocked':['security','ปรับการป้องกันการเข้าถึงแล้ว','ตรวจสอบเหตุการณ์ได้ในหน้าความปลอดภัย'],
  'agent.job_scheduled':['operations','ตั้งเวลาดำเนินงานแล้ว','ตรวจสอบงานที่ตั้งเวลาไว้ได้ในรายการงาน'],
  'agent.job_started':['operations','เริ่มงานตามกำหนดเวลา','ระบบกำลังทำงานที่คุณตั้งเวลาไว้'],
  'agent.job_waiting_confirmation':['operations','งานรอการยืนยัน','ตรวจรายละเอียดและยืนยันก่อนดำเนินการต่อ'],
  'agent.job_completed':['operations','งานตามกำหนดเวลาสำเร็จ','ตรวจผลได้ในรายการงาน'],
  'agent.job_failed':['operations','งานตามกำหนดเวลาไม่สำเร็จ','ตรวจรายละเอียดงานก่อนลองใหม่'],
  'agent.job_cancelled':['operations','ยกเลิกงานตามกำหนดเวลาแล้ว','ตรวจสถานะสุดท้ายได้ในรายการงาน'],
  'agent.workflow_plan_started':['operations','กำลังวางแผนการดำเนินงาน','Sentinel กำลังเตรียมขั้นตอนตามคำขอ'],
  'agent.workflow_completed':['operations','ขั้นตอนการดำเนินงานเสร็จแล้ว','ตรวจผลได้ในประวัติการดำเนินงาน'],
  'agent.workflow_cancelled':['operations','ยกเลิกขั้นตอนการดำเนินงานแล้ว','ตรวจผลของขั้นตอนที่ทำไปแล้วในประวัติ'],
  'agent.workflow_expired':['operations','คำขอรอยืนยันหมดอายุ','เปิดรายการงานเพื่อตรวจสถานะก่อนเริ่มใหม่'],
  'agent.orchestration_started':['operations','เริ่มการทำงานหลายขั้นตอน','ระบบกำลังประสานงานตามคำขอ'],
  'agent.orchestration_completed':['operations','การทำงานหลายขั้นตอนสำเร็จ','ตรวจผลได้ในประวัติการดำเนินงาน'],
  'agent.orchestration_cancelled':['operations','ยกเลิกการทำงานหลายขั้นตอนแล้ว','ตรวจผลของขั้นตอนที่ทำไปแล้วในประวัติ'],
  'reminder.scheduled':['reminders','บันทึกการตั้งเตือนแล้ว','ระบบจะส่งอีเมลตามเวลาที่คุณยืนยันไว้'],
  'reminder.cancelled':['reminders','ยกเลิกการตั้งเตือนแล้ว','ตรวจรายการเตือนที่ยังใช้งานได้ในตั้งค่าการแจ้งเตือน'],
  'reminder.snoozed':['reminders','เลื่อนเวลาการเตือนแล้ว','ตรวจเวลาใหม่ได้ในรายการเตือน'],
  'reminder.delivered':['reminders','ส่งการเตือนไปยังผู้ให้บริการอีเมลแล้ว','สถานะนี้ยังไม่ยืนยันว่าคุณได้รับหรืออ่านอีเมลแล้ว'],
  'reminder.delivery_failed':['reminders','การส่งเตือนมีปัญหา','ตรวจสถานะการส่งในรายการเตือนก่อนดำเนินการต่อ'],
  'studio.step_completed':['files','ขั้นตอนสร้างสื่อหรือเอกสารสำเร็จ','ตรวจผลงานได้ในหน้าสร้างสรรค์และเอกสาร'],
  'studio.step_failed':['files','ขั้นตอนสร้างสื่อหรือเอกสารมีปัญหา','ตรวจสถานะและรายละเอียดงานก่อนลองใหม่'],
  'media.ai_edit_plan_created':['files','เตรียมแผนแก้ไขสื่อแล้ว','ตรวจรายละเอียดแผนก่อนดำเนินการ'],
  'media.ai_edit_plan_failed':['files','เตรียมแผนแก้ไขสื่อไม่สำเร็จ','ตรวจสถานะงานในหน้าสร้างสื่อ'],
  'ai.gateway.provider_failed':['ai','บริการ AI ไม่พร้อมใช้งานบางส่วน','ระบบกำลังตรวจทางเลือกที่พร้อมใช้งาน'],
  'ai.gateway.stream_provider_failed':['ai','การตอบกลับ AI สะดุด','ตรวจคำตอบและสถานะก่อนส่งคำขอซ้ำ'],
});

class NotificationService {
  constructor({ repository, audit, actionLedger, socialVisibility, now = Date.now } = {}) {
    this.repository = repository; this.audit = audit; this.actionLedger = actionLedger; this.now = now;
    this.pending = new Set(); this.unsubscribe = null; this.initialized = false;
    this.socialVisibility = socialVisibility;
    this.reconciledActions = new Map();
  }
  async init() {
    await this.repository.init(); this.initialized = true;
    if (!this.unsubscribe && typeof this.audit?.subscribe === 'function') this.unsubscribe = this.audit.subscribe(entry => this.captureAudit(entry));
  }
  async close() { this.unsubscribe?.(); this.unsubscribe = null; await this.flush(); }
  async flush() { while (this.pending.size) await Promise.allSettled([...this.pending]); }
  allowed(user) { return validUserId(user?.sub) && user.isGuest !== true && !(user.roles || []).includes('guest') && Array.isArray(user.permissions) && user.permissions.includes('chat'); }
  assertUser(user) { if (!this.allowed(user)) throw failure('notifications_requires_account',403); return user.sub; }
  cutoff() { return new Date(this.now() - RETENTION_DAYS * 86400000).toISOString(); }
  async settings({ user } = {}) {
    const userId = this.assertUser(user);
    return { ok:true,settings:await this.repository.getSettings(userId,DEFAULT_SETTINGS),categories:CATEGORY_LABELS,eventCatalog:eventCatalog.entries,
      capabilities:{inApp:true,browser:true,sound:true,voice:true,backgroundPush:this.push?.ready===true,nativePush:this.push?.config().nativeAvailable===true,email:false},retentionDays:RETENTION_DAYS };
  }
  async updateSettings({ user, patch } = {}) {
    const userId = this.assertUser(user), error = validateSettingsPatch(patch);
    if (error) throw failure(error);
    return {ok:true,settings:await this.repository.patchSettings(userId,patch,DEFAULT_SETTINGS)};
  }
  async publish({ userId,category='system',type='system.notice',title,body='',sourceId=null,severity='info',sensitive=true,createdAt } = {}) {
    if (!validUserId(userId)) throw failure('invalid_notification_owner');
    if (!own(CATEGORY_LABELS,category) || !text(type,100) || !/^[a-z][a-z0-9_.:-]+$/i.test(type) || !text(title,240) || !text(body,2000,true) ||
      sourceId !== null && !text(sourceId,256) || !['info','success','warning','error'].includes(severity) || typeof sensitive !== 'boolean') throw failure('invalid_notification');
    const date = createdAt == null ? new Date(this.now()).toISOString() : new Date(createdAt).toISOString();
    if (date < this.cutoff()) return null;
    // Explicit self-send retries use one identity even when a caller changes category.
    const identityCategory = type === 'user.requested' && sourceId?.startsWith('request:') ? 'self-send' : category;
    const id = 'notice_' + createHash('sha256').update(JSON.stringify([userId,identityCategory,type,sourceId || randomUUID()])).digest('hex');
    const saved = await this.repository.put({id,userId,category,type,title:title.trim(),body:body.trim(),sourceId,severity,sensitive,createdAt:date,readAt:null,deletedAt:null});
    if (saved.category !== category || saved.title !== title.trim() || saved.body !== body.trim()) throw failure('notification_request_conflict',409);
    if (!saved.deletedAt && this.push?.ready) {
      // Await provider work during the producing request; failed deliveries remain queued.
      await this.push.tick(userId).catch(()=>{});
    }
    return saved.deletedAt ? null : publicItem(saved);
  }
  async announceUpdate({ user, platform, version } = {}) {
    const userId = this.assertUser(user);
    if (!['web', 'desktop'].includes(platform) || typeof version !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(version)) throw failure('invalid_update_notification');
    const notification = await this.publish({userId, category:'system', type:'app.update_available',
      title:'มีอัปเดต Panthorium', body:platform === 'desktop' ? 'Panthorium Browser รุ่น ' + version + ' พร้อมอัปเดต เปิดเมนูอัปเดตเพื่อดำเนินการ' : 'ระบบเว็บมีอัปเดตใหม่ ระบบจะโหลดให้อัตโนมัติเมื่อไม่มีงานค้างที่ยังไม่บันทึก',
      sourceId:platform + ':' + version, sensitive:false});
    return {ok:true,notification};
  }
  async send({ user,title,body='',category='system',requestId } = {}) {
    const userId = this.assertUser(user);
    if (requestId != null && !text(requestId,240)) throw failure('invalid_notification_request');
    const notification = await this.publish({userId,title,body,category,type:'user.requested',sourceId:requestId ? 'request:'+requestId : null,sensitive:true});
    const settings = await this.repository.getSettings(userId,DEFAULT_SETTINGS);
    return {ok:true,notification,deliveryChannel:'in_app',deliveryState:'saved',alertsEnabled:eventCatalog.enabled(settings,{category,type:'user.requested'}),backgroundPush:this.push?.ready===true};
  }
  async reconcileActions(userId) {
    if (!this.actionLedger?.ready || typeof this.actionLedger.list !== 'function') return;
    const actions = typeof this.actionLedger.listNotificationStates === 'function'
      ? await this.actionLedger.listNotificationStates(userId,100)
      : await this.actionLedger.list(userId,100);
    for (const action of actions) {
      if (action.userId !== userId || String(action.toolId).startsWith('notifications.') || !operationTitle(action.state)) continue;
      const key = JSON.stringify([userId,action.actionId,action.state]);
      if (this.reconciledActions.has(key)) continue;
      await this.publish({userId,category:'operations',type:'action.'+action.state,sourceId:action.actionId,
        title:operationTitle(action.state,action.toolId),body:operationBody(action.state,action.startedAt),severity:['failed','unknown'].includes(action.state)?'warning':action.state==='succeeded'?'success':'info',
        createdAt:action.updatedAt || action.createdAt,sensitive:true});
      this.reconciledActions.set(key,true);
      if (this.reconciledActions.size>10000) this.reconciledActions.delete(this.reconciledActions.keys().next().value);
    }
  }
  async revalidateSocial(userId, cutoff) {
    let cursor = null, unavailable = false;
    do {
      const rows = await this.repository.list(userId,{limit:200,cursor,cutoff,onlySocial:true});
      if (!rows.length) break;
      const invalid = [];
      for (const row of rows) {
        if (typeof this.socialVisibility !== 'function') { unavailable = true; continue; }
        try { if (await this.socialVisibility(userId,row.sourceId) !== true) invalid.push(row.id); }
        catch { unavailable = true; }
      }
      if (invalid.length) await this.repository.remove(userId,invalid);
      cursor = rows[rows.length-1];
      if (rows.length<200) break;
    } while (cursor);
    // An outage must not turn a previously authorized social record into a leak.
    return !unavailable;
  }
  async list({ user,limit=30,before,unreadOnly=false } = {}) {
    const userId = this.assertUser(user);
    if (!(typeof limit === 'number' || typeof limit === 'string' && /^\d+$/.test(limit)) || !Number.isInteger(Number(limit)) || Number(limit)<1 || Number(limit)>100 || typeof unreadOnly !== 'boolean') throw failure('invalid_notification_query');
    if (before != null && !NOTICE_ID.test(before)) throw failure('invalid_notification_cursor');
    await this.flush(); await this.reconcileActions(userId);
    const cutoff = this.cutoff();
    await this.repository.prune(userId,cutoff);
    const excludeSocial = !await this.revalidateSocial(userId,cutoff);
    const cursor = before ? await this.repository.get(userId,before,true) : null;
    if (before && !cursor) throw failure('invalid_notification_cursor');
    const rows = await this.repository.list(userId,{limit:Number(limit)+1,cursor,unreadOnly,cutoff,excludeSocial});
    const more = rows.length>Number(limit), items = rows.slice(0,Number(limit));
    const [unreadCount, settings] = await Promise.all([this.repository.unreadCount(userId,cutoff,excludeSocial),this.repository.getSettings(userId,DEFAULT_SETTINGS)]);
    return {ok:true,items:items.map(publicItem),unreadCount,nextCursor:more?items[items.length-1].id:null,settings,retentionDays:RETENTION_DAYS};
  }
  validIds(ids) { return Array.isArray(ids) && ids.length>0 && ids.length<=100 && ids.every(id => typeof id==='string' && NOTICE_ID.test(id)); }
  async markRead({ user,ids,all=false } = {}) {
    const userId = this.assertUser(user);
    if (typeof all!=='boolean' || all && ids != null || !all && !this.validIds(ids)) throw failure('invalid_notification_ids');
    const changed = await this.repository.markRead(userId,ids||[],all);
    const excludeSocial = !await this.revalidateSocial(userId,this.cutoff());
    return {ok:true,changed,unreadCount:await this.repository.unreadCount(userId,this.cutoff(),excludeSocial)};
  }
  async remove({ user,ids } = {}) {
    const userId = this.assertUser(user);
    if (!this.validIds(ids)) throw failure('invalid_notification_ids');
    const changed = await this.repository.remove(userId,ids);
    const excludeSocial = !await this.revalidateSocial(userId,this.cutoff());
    return {ok:true,changed,unreadCount:await this.repository.unreadCount(userId,this.cutoff(),excludeSocial)};
  }
  captureAudit(entry) {
    if (!this.initialized || !plain(entry)) return;
    const userId = entry.userId || entry.ownerUserId || entry.actorUserId;
    if (!validUserId(userId)) return;
    let spec = AUDIT_EVENTS[entry.event], type = entry.event;
    if (String(entry.toolId || '').startsWith('notifications.')) return;
    if (['agent.tool_started','agent.tool_completed','agent.tool_failed'].includes(entry.event)) {
      // Durable receipts are authoritative for results, particularly ambiguous failures.
      if (entry.actionId && entry.event !== 'agent.tool_started' || entry.mutates === false && entry.event !== 'agent.tool_failed') return;
      const state = ({'agent.tool_started':'running','agent.tool_completed':'succeeded','agent.tool_failed':'failed'})[entry.event];
      spec = ['operations',operationTitle(state,entry.toolId),operationBody(state)];
      if (entry.actionId) type = 'action.'+state;
    }
    if (['agent.memory_created','agent.memory_updated','agent.memory_deleted'].includes(entry.event)) {
      if (entry.kind === 'calendar-event') spec = ['calendar','ปฏิทินมีการเปลี่ยนแปลง','ตรวจรายละเอียดนัดหมายล่าสุดได้ในปฏิทิน'];
      else if (['note','goal'].includes(entry.kind)) spec = ['files','ข้อมูลที่บันทึกมีการเปลี่ยนแปลง','ตรวจรายการล่าสุดได้ในบันทึกหรือเป้าหมาย'];
    }
    if (entry.event === 'agent.job_terminal') {
      const title = ({completed:'งานตามกำหนดเวลาสำเร็จ',failed:'งานตามกำหนดเวลาไม่สำเร็จ',cancelled:'งานตามกำหนดเวลาถูกยกเลิก',expired:'งานตามกำหนดเวลาหมดอายุ'})[entry.status];
      if (title) { spec = ['operations',title,'ตรวจรายละเอียดได้ในรายการงาน']; type = entry.event + '.' + entry.status; }
    }
    if (!spec) return;
    const identity = entry.actionId || entry.runId || entry.jobId || entry.workflowId || entry.orchestrationId || entry.reminderId || entry.memoryId || entry.requestId || entry.alertId;
    let sourceId = identity ? String(identity).slice(0,180) + (entry.occurrence != null ? ':'+String(entry.occurrence).slice(0,20) : '') + (entry.pluginId ? ':'+String(entry.pluginId).slice(0,30) : '') : randomUUID();
    if (['agent.memory_updated','reminder.snoozed','auth.user_access_updated','auth.user_password_reset','auth.voice_password_reset'].includes(entry.event)) sourceId = sourceId.slice(0,180)+':'+String(entry.requestId||entry.time||randomUUID()).slice(0,64);
    const promise = this.publish({userId,category:spec[0],title:spec[1],body:spec[2],type,sourceId,sensitive:true,
      severity:/failed|expired/.test(entry.event)?'warning':/completed|delivered/.test(entry.event)?'success':'info',createdAt:entry.time})
      .catch(() => { /* Notification failure must not change the result of the original action. */ });
    this.pending.add(promise); promise.finally(()=>this.pending.delete(promise));
  }
}
module.exports = { NotificationService, DEFAULT_SETTINGS, CATEGORY_LABELS, validateSettingsPatch, RETENTION_DAYS, NOTICE_ID };
