const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const normalizeEmail = value => String(value || '').trim().toLowerCase();
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

class EmailOtpService {
  constructor({ repository, authService, config, sender }) {
    this.repository = repository;
    this.authService = authService;
    this.config = config;
    this.senderConfigured = Boolean(sender || (config.resendApiKey && config.emailFrom));
    this.sender = sender || (async (email, code) => {
      if (!config.resendApiKey || !config.emailFrom) throw new Error('email_delivery_not_configured');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.emailFrom, to: [email], subject: 'Panthorium: รหัสยืนยัน 6 หลัก', text: `รหัสยืนยันของคุณคือ ${code} รหัสนี้ใช้ได้ 10 นาที หากไม่ได้ร้องขอ โปรดข้ามอีเมลนี้` }),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('email_delivery_failed');
    });
  }
  async init() { await this.repository.init(); }
  hash(key, code) { return crypto.createHmac('sha256', this.config.jwtSecret).update(key + ':' + code).digest('hex'); }
  async issue(key, email) {
    if (!validEmail(email)) throw new Error('valid_email_required');
    if (!this.senderConfigured) throw new Error('email_delivery_not_configured');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (!await this.repository.issue(key, this.hash(key, code))) return;
    try { await this.sender(email, code); }
    catch (error) { await this.repository.discard(key); throw error; }
  }
  async requestRegistration(emailValue, guestOwnerId) {
    const email = normalizeEmail(emailValue);
    if (!validEmail(email)) throw new Error('valid_email_required');
    if (await this.authService.repository.findUserByEmail(email)) return;
    await this.issue(`register:${guestOwnerId}:${email}`, email);
  }
  async verifyRegistration(emailValue, guestOwnerId, code) {
    const email = normalizeEmail(emailValue);
    if (!validEmail(email) || !/^\d{6}$/.test(String(code || ''))) throw new Error('invalid_otp');
    const key = `register:${guestOwnerId}:${email}`;
    if (!await this.repository.consume(key, this.hash(key, code))) throw new Error('invalid_otp');
    return jwt.sign({ purpose: 'voice_registration', sub: guestOwnerId, email }, this.config.jwtSecret, { expiresIn: '20m', issuer: 'panthorium', audience: 'panthorium-registration' });
  }
  verifyRegistrationToken(token, guestOwnerId, emailValue) {
    try {
      const payload = jwt.verify(String(token || ''), this.config.jwtSecret, { issuer: 'panthorium', audience: 'panthorium-registration' });
      return payload.purpose === 'voice_registration' && payload.sub === guestOwnerId && payload.email === normalizeEmail(emailValue);
    } catch (_) { return false; }
  }
  async requestReset(emailValue) {
    const email = normalizeEmail(emailValue);
    if (!validEmail(email)) throw new Error('valid_email_required');
    if (!this.senderConfigured) throw new Error('email_delivery_not_configured');
    const user = await this.authService.repository.findUserByEmail(email);
    if (user) await this.issue(`reset:${user.id}`, email);
  }
  async resetPassword(emailValue, code, password) {
    const email = normalizeEmail(emailValue);
    if (!validEmail(email) || !/^\d{6}$/.test(String(code || ''))) throw new Error('invalid_otp');
    if (typeof password !== 'string' || password.length < 10 || password.length > 256) throw new Error('invalid_password');
    const user = await this.authService.repository.findUserByEmail(email);
    if (!user) throw new Error('invalid_otp');
    const key = `reset:${user.id}`;
    if (!await this.repository.consume(key, this.hash(key, code))) throw new Error('invalid_otp');
    await this.authService.resetVoiceAccountPassword(user.id, password);
  }
}

module.exports = { EmailOtpService, normalizeEmail, validEmail };
