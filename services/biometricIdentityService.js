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
  constructor({ repository, audit, providerUrl, providerToken, encryptionKey, gateEnabled = false, matchThreshold = 0.82, enrollmentThreshold = 0.76 }) {
    this.repository = repository; this.audit = audit; this.providerUrl = String(providerUrl || '').replace(/\/$/, ''); this.providerToken = providerToken || '';
    this.key = encryptionKey ? crypto.createHash('sha256').update(encryptionKey).digest() : null;
    this.gateEnabled = gateEnabled === true;
    this.matchThreshold = Number(matchThreshold); this.enrollmentThreshold = Number(enrollmentThreshold);
  }
  async init() { await this.repository.init(); }
  status() { return { configured: Boolean(this.providerUrl && this.key), gateEnabled: this.gateEnabled, providerConfigured: Boolean(this.providerUrl), encryptionConfigured: Boolean(this.key), minEnrollmentSamples: 3, maxEnrollmentSamples: 5, allowedSubjects: [...TYPES] }; }
  validateAudio(audio) {
    if (typeof audio !== 'string' || audio.length < 4000 || audio.length > 1400000) return false;
    const comma = audio.indexOf(',');
    if (comma < 0) return false;
    // MediaRecorder commonly returns audio/webm;codecs=opus. Keep codec
    // parameters in the MIME header while still requiring a base64 data URL.
    const header = audio.slice(0, comma);
    return /^data:audio\/[a-z0-9.+-]+(?:;[a-z0-9!#$&^_.+-]+=[a-z0-9!#$&^_.+-]+)*;base64$/i.test(header);
  }
  encrypt(template) { if (!this.key) throw new Error('biometric_encryption_not_configured'); const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv); const body = Buffer.concat([cipher.update(JSON.stringify(template)), cipher.final()]); return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.'); }
  decrypt(value) { if (!this.key) throw new Error('biometric_encryption_not_configured'); const [iv, tag, body] = String(value).split('.'); const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url')); decipher.setAuthTag(Buffer.from(tag, 'base64url')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')); }
  async extract(audio) {
    if (!this.providerUrl) throw new Error('speaker_verification_not_configured');
    const requestUrl = `${this.providerUrl}/embed`;
    let result;
    if (this.providerToken) {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.providerToken}` },
        body: JSON.stringify({ audio }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`speaker_verification_http_${response.status}`);
      result = await response.json();
    } else {
      // Let IDTokenClient make the request so it attaches the Google-signed
      // Authorization header itself. The token audience is the receiving
      // service root URL, not the /embed path.
      const { GoogleAuth } = require('google-auth-library');
      const client = await new GoogleAuth().getIdTokenClient(this.providerUrl);
      try {
        const response = await client.request({
          url: requestUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          data: { audio },
          timeout: 30000,
        });
        result = response.data;
      } catch (error) {
        const status = Number(error?.response?.status);
        if (status) throw new Error(`speaker_verification_http_${status}`);
        throw error;
      }
    }
    // signalPresent means sufficient non-silent audio. It is not proof that
    // the recording is live; replay resistance requires a separate mechanism.
    if (result?.signalPresent !== true && result?.live !== true) throw new Error('voice_signal_missing');
    if (!Array.isArray(result.embedding) || result.embedding.length < 16 || result.embedding.length > 4096) throw new Error('invalid_voice_embedding');
    return result.embedding.map(Number);
  }
  async enroll({ ownerUserId, actorRoles = [], displayName, subjectType, relationship, consent, samples, email, deviceKey }) {
    const name = String(displayName || '').trim();
    if (name.length < 1 || name.length > 80) throw new Error('invalid_display_name');
    if (!TYPES.has(subjectType)) throw new Error('invalid_subject_type');
    if (subjectType === 'administrator' && !actorRoles.includes('administrator')) throw new Error('administrator_role_required');
    if (consent !== true) throw new Error('biometric_consent_required');
    const guest = actorRoles.includes('guest');
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (guest && (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))) throw new Error('valid_email_required');
    if (guest && !/^[0-9a-f]{64}$/i.test(String(deviceKey || ''))) throw new Error('device_key_required');
    if (!Array.isArray(samples) || samples.length < 3 || samples.length > 5 || samples.some(sample => !this.validateAudio(sample))) throw new Error('invalid_voice_samples');
    const vectors = [];
    for (const sample of samples) vectors.push(await this.extract(sample));
    if (!vectors.every(vector => vector.length === vectors[0].length)) throw new Error('inconsistent_voice_embeddings');
    const template = mean(vectors);
    const consistency = Math.min(...vectors.map(vector => cosine(template, vector)));
    if (consistency < this.enrollmentThreshold) throw new Error('voice_samples_do_not_match');
    const profile = await this.repository.create({ ownerUserId, displayName: name, subjectType, relationship: String(relationship || '').trim().slice(0, 80) || null, encryptedTemplate: this.encrypt(template), contactEmailCiphertext: guest ? this.encrypt(normalizedEmail) : null, deviceKeyHash: guest ? crypto.createHash('sha256').update(deviceKey.toLowerCase()).digest('hex') : null, templateVersion: 1, sampleCount: vectors.length, consentedAt: new Date().toISOString() });
    this.audit?.record('biometric.voice_enrolled', { ownerUserId, profileId: profile.profileId, subjectType, sampleCount: vectors.length });
    return publicProfile(profile);
  }
  async list(ownerUserId) { return (await this.repository.list(ownerUserId)).map(publicProfile); }
  async remove(ownerUserId, profileId) { const removed = await this.repository.remove(profileId, ownerUserId); if (removed) this.audit?.record('biometric.voice_removed', { ownerUserId, profileId }); return removed; }
  async verify({ ownerUserId, audio }) {
    if (!this.validateAudio(audio)) throw new Error('invalid_voice_sample');
    const profiles = await this.repository.list(ownerUserId);
    if (!profiles.length) {
      this.audit?.record('biometric.voice_rejected', { ownerUserId, profileId: null, score: null, reason: 'no_enrolled_profiles' });
      return { ok: true, matched: false, score: null, profile: null, acceptCommands: false };
    }
    const probe = await this.extract(audio);
    let best = null;
    for (const profile of profiles) { const score = cosine(probe, this.decrypt(profile.encryptedTemplate)); if (!best || score > best.score) best = { profile, score }; }
    const matched = Boolean(best && best.score >= this.matchThreshold);
    this.audit?.record(matched ? 'biometric.voice_matched' : 'biometric.voice_rejected', { ownerUserId, profileId: matched ? best.profile.profileId : null, score: best ? Number(best.score.toFixed(4)) : null });
    return { ok: true, matched, score: best ? Number(best.score.toFixed(4)) : null, profile: matched ? publicProfile(best.profile) : null, acceptCommands: matched };
  }
}

module.exports = { BiometricIdentityService, cosine };
