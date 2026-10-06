const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

class ReminderService {
  constructor({ repository, authService, config = {}, audit, sender } = {}) {
    this.repository = repository;
    this.authService = authService;
    this.config = config;
    this.audit = audit;
    this.sender = sender || this.createSender();
    this.deliveryAvailable = Boolean(this.sender);
  }

  async init() { await this.repository?.init?.(); }

  createSender() {
    if (!this.config.resendApiKey || !this.config.emailFrom) return null;
    return async ({ email, subject, text }) => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.config.resendApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.config.emailFrom, to: [email], subject, text }),
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('reminder_email_delivery_failed');
    };
  }

  allowed(user) {
    const roles = user?.roles || [];
    return !!user?.sub && !String(user.sub).startsWith('guest:') && !roles.includes('guest') &&
      Array.isArray(user.permissions) && user.permissions.includes('chat');
  }

  validate({ kind, title, details = '', dueAt, timeZone, emailConsent } = {}) {
    if (!['medication','appointment'].includes(kind)) return { ok: false, error: 'invalid_reminder_kind' };
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 240) return { ok: false, error: 'invalid_reminder_title' };
    if (typeof details !== 'string' || details.length > 1000) return { ok: false, error: 'invalid_reminder_details' };
    const due = Date.parse(dueAt);
    if (!Number.isFinite(due)) return { ok: false, error: 'invalid_reminder_time' };
    if (due < Date.now() + 30000) return { ok: false, error: 'reminder_time_must_be_future' };
    if (due > Date.now() + 366 * 24 * 60 * 60 * 1000) return { ok: false, error: 'reminder_time_too_far' };
    if (typeof timeZone !== 'string' || timeZone.length > 64) return { ok: false, error: 'invalid_time_zone' };
    try { new Intl.DateTimeFormat('en', { timeZone }).format(new Date(due)); } catch (_) { return { ok: false, error: 'invalid_time_zone' }; }
    if (emailConsent !== true) return { ok: false, error: 'reminder_email_consent_required' };
    return { ok: true, item: { kind, title: title.trim(), details: details.trim(), dueAt: new Date(due).toISOString(), timeZone } };
  }

  async create({ user, ...input } = {}) {
    if (!this.allowed(user)) return { ok: false, error: 'reminder_requires_account' };
    if (!this.deliveryAvailable) return { ok: false, error: 'reminder_email_unavailable' };
    const checked = this.validate(input);
    if (!checked.ok) return checked;
    const account = await this.authService?.repository?.findUserById?.(user.sub);
    if (!account || !validEmail(account.email) || !account.emailVerifiedAt) return { ok: false, error: 'verified_email_required' };
    const reminder = await this.repository.create({ ...checked.item, userId: user.sub, status: 'scheduled' });
    this.audit?.record('reminder.scheduled', { userId: user.sub, reminderId: reminder.reminderId, kind: reminder.kind, dueAt: reminder.dueAt });
    return { ok: true, reminder };
  }

  async list({ user, limit = 50 } = {}) {
    if (!this.allowed(user)) return { ok: false, error: 'reminder_requires_account' };
    return { ok: true, reminders: await this.repository.list(user.sub, limit), deliveryAvailable: this.deliveryAvailable };
  }

  async cancel({ user, reminderId } = {}) {
    if (!this.allowed(user)) return { ok: false, error: 'reminder_requires_account' };
    const id = String(reminderId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'invalid_reminder_id' };
    const reminder = await this.repository.cancel(user.sub, id);
    if (!reminder) return { ok: false, error: 'reminder_not_found_or_already_started' };
    this.audit?.record('reminder.cancelled', { userId: user.sub, reminderId: id });
    return { ok: true, reminder };
  }

  async deliverDue(limit = 10) {
    if (!this.deliveryAvailable) return { ok: false, error: 'reminder_email_unavailable', sent: 0 };
    const due = await this.repository.claimDue(limit);
    let sent = 0;
    for (const reminder of due) {
      try {
        const account = await this.authService?.repository?.findUserById?.(reminder.userId);
        if (!account || !validEmail(account.email) || !account.emailVerifiedAt) throw new Error('verified_email_required');
        const type = reminder.kind === 'medication' ? 'เตือนทานยา' : 'เตือนนัดหมาย';
        const when = new Intl.DateTimeFormat('th-TH', { dateStyle: 'full', timeStyle: 'short', timeZone: reminder.timeZone }).format(new Date(reminder.dueAt));
        const text = [type, reminder.title, when, reminder.details, 'ส่งโดย Panthorium ตามการตั้งเตือนในบัญชีของคุณ'].filter(Boolean).join('\\n');
        await this.sender({ email: account.email, subject: 'Panthorium: ' + type, text });
        await this.repository.finish(reminder.reminderId, { status: 'sent' });
        sent++;
        this.audit?.record('reminder.delivered', { userId: reminder.userId, reminderId: reminder.reminderId, kind: reminder.kind });
      } catch (error) {
        const retryAt = reminder.attempts < 3 ? new Date(Date.now() + 60000).toISOString() : null;
        const status = retryAt ? 'scheduled' : 'failed';
        const code = String(error?.message || 'reminder_delivery_failed').slice(0,80);
        await this.repository.finish(reminder.reminderId, { status, lastError: code, retryAt });
        this.audit?.record('reminder.delivery_failed', { userId: reminder.userId, reminderId: reminder.reminderId, attempt: reminder.attempts, error: code });
      }
    }
    return { ok: true, sent, attempted: due.length };
  }
}

module.exports = { ReminderService, validEmail };