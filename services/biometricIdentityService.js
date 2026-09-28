const crypto = require('crypto');
const { publicProfile } = require('./biometricIdentityRepository');

const TYPES = new Set(['user', 'family', 'administrator']);
const cosine = (a, b) => {
  if (!Array.isArray(a) || a.length !== b?.length || a.length < 16) return -1;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i += 1) { const x = Number(a[i]), y = Number(b[i]); if (!Number.isFinite(x) || !Number.isFinite(y)) return -1; dot += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : -1;
};
const mean = vectors => vectors[0].map((_, i) => vectors.reduce((sum, vector) => sum + Number(vector[i]), 0) / vectors.length);

class BiometricIdentityService {
  constructor({ repository, audit, providerUrl, providerToken, encryptionKey, matchThreshold = 0.82, enrollmentThreshold = 0.76 }) {
    this.repository = repository; this.audit = audit; this.providerUrl = String(providerUrl || '').replace(/\/$/, ''); this.providerToken = providerToken || '';
    this.key = encryptionKey ? crypto.createHash('sha256').update(encryptionKey).digest() : null;
    this.matchThreshold = Number(matchThreshold); this.enrollmentThreshold = Number(enrollmentThreshold);
  }
  async init() { await this.repository.init(); }
  status() { return { configured: Boolean(this.providerUrl && this.key), providerConfigured: Boolean(this.providerUrl), encryptionConfigured: Boolean(this.key), minEnrollmentSamples: 3, maxEnrollmentSamples: 5, allowedSubjects: [...TYPES] }; }
  validateAudio(audio) { return typeof audio === 'string' && /^data:audio\/[a-z0-9.+-]+;base64,/i.test(audio) && audio.length >= 4000 && audio.length <= 1400000; }
  encrypt(template) { if (!this.key) throw new Error('biometric_encryption_not_configured'); const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv); const body = Buffer.concat([cipher.update(JSON.stringify(template)), cipher.final()]); return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.'); }
  decrypt(value) { if (!this.key) throw new Error('biometric_encryption_not_configured'); const [iv, tag, body] = String(value).split('.'); const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url')); decipher.setAuthTag(Buffer.from(tag, 'base64url')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')); }
  async extract(audio) {
    if (!this.providerUrl) throw new Error('speaker_verification_not_configured');
    const response = await fetch(`${this.providerUrl}/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.providerToken ? { Authorization: `Bearer ${this.providerToken}` } : {}) }, body: JSON.stringify({ audio }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`speaker_verification_http_${response.status}`);
    const result = await response.json();
    if (result?.live !== true) throw new Error('voice_liveness_failed');
    if (!Array.isArray(result.embedding) || result.embedding.length < 16 || result.embedding.length > 4096) throw new Error('invalid_voice_embedding');
    return result.embedding.map(Number);
  }
  async enroll({ ownerUserId, actorRoles = [], displayName, subjectType, relationship, consent, samples }) {
    const name = String(displayName || '').trim();
    if (name.length < 1 || name.length > 80) throw new Error('invalid_display_name');
    if (!TYPES.has(subjectType)) throw new Error('invalid_subject_type');
    if (subjectType === 'administrator' && !actorRoles.includes('administrator')) throw new Error('administrator_role_required');
    if (consent !== true) throw new Error('biometric_consent_required');
    if (!Array.isArray(samples) || samples.length < 3 || samples.length > 5 || samples.some(sample => !this.validateAudio(sample))) throw new Error('invalid_voice_samples');
    const vectors = [];
    for (const sample of samples) vectors.push(await this.extract(sample));
    if (!vectors.every(vector => vector.length === vectors[0].length)) throw new Error('inconsistent_voice_embeddings');
    const template = mean(vectors);
    const consistency = Math.min(...vectors.map(vector => cosine(template, vector)));
    if (consistency < this.enrollmentThreshold) throw new Error('voice_samples_do_not_match');
    const profile = await this.repository.create({ ownerUserId, displayName: name, subjectType, relationship: String(relationship || '').trim().slice(0, 80) || null, encryptedTemplate: this.encrypt(template), templateVersion: 1, sampleCount: vectors.length, consentedAt: new Date().toISOString() });
    this.audit?.record('biometric.voice_enrolled', { ownerUserId, profileId: profile.profileId, subjectType, sampleCount: vectors.length });
    return publicProfile(profile);
  }
  async list(ownerUserId) { return (await this.repository.list(ownerUserId)).map(publicProfile); }
  async remove(ownerUserId, profileId) { const removed = await this.repository.remove(profileId, ownerUserId); if (removed) this.audit?.record('biometric.voice_removed', { ownerUserId, profileId }); return removed; }
  async verify({ ownerUserId, audio }) {
    if (!this.validateAudio(audio)) throw new Error('invalid_voice_sample');
    const probe = await this.extract(audio);
    const profiles = await this.repository.list(ownerUserId);
    let best = null;
    for (const profile of profiles) { const score = cosine(probe, this.decrypt(profile.encryptedTemplate)); if (!best || score > best.score) best = { profile, score }; }
    const matched = Boolean(best && best.score >= this.matchThreshold);
    this.audit?.record(matched ? 'biometric.voice_matched' : 'biometric.voice_rejected', { ownerUserId, profileId: matched ? best.profile.profileId : null, score: best ? Number(best.score.toFixed(4)) : null });
    return { ok: true, matched, score: best ? Number(best.score.toFixed(4)) : null, profile: matched ? publicProfile(best.profile) : null, acceptCommands: matched };
  }
}

module.exports = { BiometricIdentityService, cosine };
