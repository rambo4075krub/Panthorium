const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const EXPLICIT_OFFSET = /T.*(?:Z|[+-]\d{2}:\d{2})$/i;
const KINDS = ['medication','appointment','task','deadline','study'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
// Explicit DST policy: nonexistent local times are skipped; repeated times use the first occurrence.
function localToUtc(parts, timeZone) {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
  const offsets = new Set();
  for (const delta of [-36,-12,0,12,36]) {
    const probe = naive + delta * 3600000, p = localParts(probe, timeZone);
    offsets.add(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second) - probe);
  }
  const matches = [...offsets].map(offset => naive - offset).filter(instant => {
    const p = localParts(instant,timeZone);
    return ['year','month','day','hour','minute','second'].every(k => p[k] === (parts[k] || 0));
  });
  return matches.length ? Math.min(...matches) : null;
}
function nextOccurrence(reminder, now = Date.now()) {
  const recurrence = reminder.recurrence;
  if (!recurrence) return null;
  const start = localParts(reminder.scheduledAt || reminder.dueAt, reminder.timeZone);
  const days = recurrence.interval * (recurrence.frequency === 'weekly' ? 7 : 1);
  for (let occurrence = reminder.occurrence + 1; occurrence <= recurrence.maxOccurrences; occurrence++) {
    const offset = (occurrence - reminder.occurrence) * days;
    const date = new Date(Date.UTC(start.year,start.month-1,start.day + offset));
    const due = localToUtc({ year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate(),...recurrence.localTime }, reminder.timeZone);
    if (due == null || due <= now) continue; // Skip gaps and missed occurrences, never burst old emails.
    if (recurrence.until && due > Date.parse(recurrence.until)) return null;
    return { dueAt: new Date(due).toISOString(), occurrence };
  }
  return null;
}
function validateTime(dueAt, now = Date.now()) {
  if (typeof dueAt !== 'string' || !EXPLICIT_OFFSET.test(dueAt) || !Number.isFinite(Date.parse(dueAt))) return { ok:false,error:'invalid_reminder_time' };
  const due = Date.parse(dueAt);
  if (due < now + 30000) return { ok:false,error:'reminder_time_must_be_future' };
  if (due > now + 366 * 86400000) return { ok:false,error:'reminder_time_too_far' };
  return { ok:true,dueAt:new Date(due).toISOString() };
}

class ReminderService {
  constructor({ repository, authService, config = {}, audit, sender } = {}) {
    this.repository = repository; this.authService = authService; this.config = config; this.audit = audit;
    this.sender = sender || this.createSender(); this.deliveryAvailable = Boolean(this.sender);
  }
  async init() { await this.repository?.init?.(); await this.repository?.recoverStale?.(); }
  createSender() {
    if (!this.config.resendApiKey || !this.config.emailFrom) return null;
    return async ({ email, subject, text, idempotencyKey }) => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.config.resendApiKey, 'Content-Type':'application/json', 'Idempotency-Key':idempotencyKey },
        body: JSON.stringify({ from:this.config.emailFrom,to:[email],subject,text }), signal:AbortSignal.timeout(12000)
      });
      if (!response.ok) { const error = new Error('reminder_email_delivery_failed'); error.definitiveFailure = response.status >= 400 && response.status < 500 && ![408,409,429].includes(response.status); throw error; }
      const body = await response.json();
      return { providerMessageId:typeof body.id === 'string' ? body.id.slice(0,200) : null };
    };
  }
  allowed(user) { return !!user?.sub && !String(user.sub).startsWith('guest:') && !(user.roles || []).includes('guest') && Array.isArray(user.permissions) && user.permissions.includes('chat'); }
  validate({ kind, title, details = '', dueAt, timeZone, emailConsent, recurrence } = {}) {
    if (!KINDS.includes(kind)) return { ok:false,error:'invalid_reminder_kind' };
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 240) return { ok:false,error:'invalid_reminder_title' };
    if (typeof details !== 'string' || details.length > 1000) return { ok:false,error:'invalid_reminder_details' };
    const time = validateTime(dueAt); if (!time.ok) return time;
    if (typeof timeZone !== 'string' || timeZone.length > 64) return { ok:false,error:'invalid_time_zone' };
    try { localParts(time.dueAt,timeZone); } catch { return { ok:false,error:'invalid_time_zone' }; }
    if (emailConsent !== true) return { ok:false,error:'reminder_email_consent_required' };
    let repeat = null;
    if (recurrence != null) {
      if (!recurrence || typeof recurrence !== 'object' || Array.isArray(recurrence) || !['daily','weekly'].includes(recurrence.frequency)) return { ok:false,error:'invalid_reminder_recurrence' };
      const interval = recurrence.interval ?? 1, maxOccurrences = recurrence.maxOccurrences ?? 30;
      if (!Number.isInteger(interval) || interval < 1 || interval > 30 || !Number.isInteger(maxOccurrences) || maxOccurrences < 2 || maxOccurrences > 366) return { ok:false,error:'invalid_reminder_recurrence' };
      if (recurrence.until != null && (typeof recurrence.until !== 'string' || !EXPLICIT_OFFSET.test(recurrence.until) || !Number.isFinite(Date.parse(recurrence.until)) || Date.parse(recurrence.until) <= Date.parse(time.dueAt))) return { ok:false,error:'invalid_recurrence_until' };
      const local = localParts(time.dueAt,timeZone);
      // Bound the whole schedule to one year even when no end date is supplied.
      const until = new Date(Math.min(Date.parse(recurrence.until || '9999-01-01T00:00:00Z'),Date.now()+366*86400000)).toISOString();
      repeat = { frequency:recurrence.frequency,interval,maxOccurrences,until,localTime:{hour:local.hour,minute:local.minute,second:local.second},dstPolicy:'skip_gap_first_fold' };
    }
    return { ok:true,item:{kind,title:title.trim(),details:details.trim(),dueAt:time.dueAt,timeZone,recurrence:repeat} };
  }
  async create({ user, ...input } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'reminder_requires_account' };
    if (!this.deliveryAvailable) return { ok:false,error:'reminder_email_unavailable' };
    const checked = this.validate(input); if (!checked.ok) return checked;
    const account = await this.authService?.repository?.findUserById?.(user.sub);
    if (!account || !validEmail(account.email) || !account.emailVerifiedAt) return { ok:false,error:'verified_email_required' };
    const reminder = await this.repository.create({...checked.item,userId:user.sub,status:'scheduled',accountVersion:Number(user.accountVersion)||0});
    this.audit?.record('reminder.scheduled',{userId:user.sub,reminderId:reminder.reminderId,kind:reminder.kind,dueAt:reminder.dueAt});
    return { ok:true,reminder,deliveryChannel:'verified_email' };
  }
  async list({ user, limit = 50 } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'reminder_requires_account' };
    return { ok:true,reminders:await this.repository.list(user.sub,limit),deliveryAvailable:this.deliveryAvailable,deliveryChannel:'verified_email',deliverySemantics:'provider_accepted_not_confirmed_read',recurrenceDstPolicy:'skip_gap_first_fold' };
  }
  async cancel({ user, reminderId } = {}) {
    if (!this.allowed(user)) return { ok:false,error:'reminder_requires_account' };
    if (!UUID.test(String(reminderId || ''))) return { ok:false,error:'invalid_reminder_id' };
    const reminder = await this.repository.cancel(user.sub,reminderId);
    if (!reminder) return { ok:false,error:'reminder_not_found_or_already_started' };
    this.audit?.record('reminder.cancelled',{userId:user.sub,reminderId}); return {ok:true,reminder};
  }
  async snooze({ user, reminderId, dueAt } = {}) {
    if (!this.allowed(user)) return {ok:false,error:'reminder_requires_account'};
    if (!UUID.test(String(reminderId || ''))) return {ok:false,error:'invalid_reminder_id'};
    const time = validateTime(dueAt); if (!time.ok) return time;
    const reminder = await this.repository.snooze(user.sub,reminderId,time.dueAt);
    if (!reminder) return {ok:false,error:'reminder_not_found_or_already_started'};
    this.audit?.record('reminder.snoozed',{userId:user.sub,reminderId,dueAt:time.dueAt}); return {ok:true,reminder};
  }
  async deliverDue(limit = 10) {
    if (!this.deliveryAvailable) return {ok:false,error:'reminder_email_unavailable',sent:0};
    await this.repository.recoverStale?.();
    const due = await this.repository.claimDue(limit); let sent = 0, unknown = 0;
    for (const reminder of due) {
      let sending = false;
      try {
        const account = await this.authService?.repository?.findUserById?.(reminder.userId);
        if (!account || !validEmail(account.email) || !account.emailVerifiedAt) throw new Error('verified_email_required');
        if (this.authService?.validateAccountPrincipal) await this.authService.validateAccountPrincipal({sub:reminder.userId,roles:account.roles || [],permissions:account.permissions || [],accountVersion:reminder.accountVersion});
        const type = {medication:'เตือนทานยา',appointment:'เตือนนัดหมาย',task:'เตือนงาน',deadline:'เตือนกำหนดส่ง',study:'เตือนทบทวนบทเรียน'}[reminder.kind] || 'แจ้งเตือน';
        const when = new Intl.DateTimeFormat('th-TH',{dateStyle:'full',timeStyle:'short',timeZone:reminder.timeZone}).format(new Date(reminder.dueAt));
        const text = [type,reminder.title,when,reminder.details,'ส่งโดย Panthorium ตามการตั้งเตือนในบัญชีของคุณ','อีเมลอาจล่าช้า โปรดใช้ช่องทางสำรองสำหรับเรื่องสำคัญ'].filter(Boolean).join('\n');
        sending = true;
        const result = await this.sender({email:account.email,subject:'Panthorium: '+type,text,idempotencyKey:`reminder/${reminder.reminderId}/${reminder.occurrence}`});
        const next = nextOccurrence(reminder);
        const saved = await this.repository.finish(reminder.reminderId,{status:'sent',occurrence:reminder.occurrence,nextDueAt:next?.dueAt,nextOccurrence:next?.occurrence,providerMessageId:result?.providerMessageId || null});
        if (!saved) throw new Error('delivery_state_changed_manual_review');
        sent++; this.audit?.record('reminder.delivered',{userId:reminder.userId,reminderId:reminder.reminderId,occurrence:reminder.occurrence,kind:reminder.kind});
      } catch (error) {
        const status = sending && !error?.definitiveFailure ? 'delivery_unknown' : 'failed';
        if (status === 'delivery_unknown') unknown++;
        const code = String(error?.message || 'reminder_delivery_failed').slice(0,80);
        await this.repository.finish(reminder.reminderId,{status,lastError:code,occurrence:reminder.occurrence});
        this.audit?.record('reminder.delivery_failed',{userId:reminder.userId,reminderId:reminder.reminderId,attempt:reminder.attempts,error:code,status});
      }
    }
    return {ok:true,sent,unknown,attempted:due.length};
  }
}
module.exports = { ReminderService, validEmail, localParts, localToUtc, nextOccurrence, validateTime };
