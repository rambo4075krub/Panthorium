const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BiometricIdentityService } = require('../services/biometricIdentityService');
const { JsonBiometricIdentityRepository } = require('../services/biometricIdentityRepository');

class Repository {
  constructor() { this.rows = []; }
  async init() {}
  async create(row) { const saved = { ...row, profileId: `p-${this.rows.length + 1}`, templateRevision: 1, status: 'active' }; this.rows.push(saved); return saved; }
  async get(id, owner) { return this.rows.find(row => row.profileId === id && row.ownerUserId === owner) || null; }
  async updateTemplate(id, owner, { encryptedTemplate, sampleCount, expectedRevision }) {
    const row = await this.get(id, owner);
    if (!row || row.templateRevision !== expectedRevision) return null;
    row.encryptedTemplate = encryptedTemplate; row.sampleCount = sampleCount; row.templateRevision += 1;
    return row;
  }
  async list(owner) { return this.rows.filter(row => row.ownerUserId === owner); }
  async remove(id, owner) { const before = this.rows.length; this.rows = this.rows.filter(row => row.profileId !== id || row.ownerUserId !== owner); return before !== this.rows.length; }
}

const audio = suffix => `data:audio/webm;codecs=opus;base64,${'A'.repeat(4100)}${suffix}`;
const vector = seed => Array.from({ length: 32 }, (_, index) => (index === seed ? 1 : 0.01));

(async () => {
  const originalFetch = global.fetch;
  let nextVector = vector(2), embeddingCalls = 0;
  global.fetch = async () => { embeddingCalls += 1; return { ok: true, json: async () => ({ signalPresent: true, embedding: nextVector }) }; };
  try {
    const repository = new Repository();
    const service = new BiometricIdentityService({ repository, providerUrl: 'https://speaker.test', providerToken: 'test-only-token', encryptionKey: 'test-only-key', matchThreshold: 0.82, enrollmentThreshold: 0.76 });
    await service.init();
    const beforeEmptyOwner = embeddingCalls;
    const emptyOwner = await service.verify({ ownerUserId: 'no-profile-owner', audio: audio(0) });
    assert.equal(emptyOwner.matched, false);
    assert.equal(emptyOwner.acceptCommands, false);
    assert.equal(embeddingCalls, beforeEmptyOwner, 'empty owner never calls speaker model');
    await assert.rejects(() => service.enroll({ ownerUserId: 'u1', actorRoles: ['user'], displayName: 'Fake admin', subjectType: 'administrator', consent: true, samples: [audio(1), audio(2), audio(3)] }), /administrator_role_required/);
    const user = await service.enroll({ ownerUserId: 'u1', actorRoles: ['user'], displayName: 'Owner', subjectType: 'user', consent: true, samples: [audio(1), audio(2), audio(3)] });
    assert.equal(user.encryptedTemplate, undefined);
    const callsBeforeDuplicate = embeddingCalls;
    await assert.rejects(() => service.enroll({ ownerUserId: 'u1', actorRoles: ['user'], displayName: 'Owner again', subjectType: 'user', consent: true, samples: [audio(1), audio(2), audio(3)] }), /voice_profile_exists/);
    assert.equal(embeddingCalls, callsBeforeDuplicate, 'duplicate account profile is rejected before embedding audio');
    const profileCountBeforeAppend = (await repository.list('u1')).length;
    const enriched = await service.addSamples({ ownerUserId: 'u1', actorRoles: ['user'], profileId: user.profileId, consent: true, samples: [audio(11), audio(12), audio(13)] });
    assert.equal(enriched.profileId, user.profileId, 'new samples update the logged-in user profile');
    assert.equal(enriched.sampleCount, 6);
    assert.equal(enriched.templateRevision, 2);
    assert.equal((await repository.list('u1')).length, profileCountBeforeAppend, 'adding samples does not create another profile');
    await assert.rejects(() => service.addSamples({ ownerUserId: 'different-owner', actorRoles: ['user'], profileId: user.profileId, consent: true, samples: [audio(14), audio(15), audio(16)] }), /voice_profile_not_found/);
    nextVector = vector(20);
    await assert.rejects(() => service.addSamples({ ownerUserId: 'u1', actorRoles: ['user'], profileId: user.profileId, consent: true, samples: [audio(17), audio(18), audio(19)] }), /voice_samples_do_not_match/);
    assert.equal((await repository.get(user.profileId, 'u1')).sampleCount, 6, 'rejected speaker samples leave the enrolled template unchanged');
    nextVector = vector(2);
    const family = await service.enroll({ ownerUserId: 'u1', actorRoles: ['user'], displayName: 'Family', subjectType: 'family', relationship: 'parent', consent: true, samples: [audio(1), audio(2), audio(3)] });
    assert.equal(family.subjectType, 'family');
    const administrator = await service.enroll({ ownerUserId: 'admin-1', actorRoles: ['administrator'], displayName: 'Admin', subjectType: 'administrator', consent: true, samples: [audio(1), audio(2), audio(3)] });
    assert.equal(administrator.subjectType, 'administrator');
    const deviceKey = 'a'.repeat(64);
    await assert.rejects(() => service.enroll({ ownerUserId: 'guest:tab-id', actorRoles: ['guest'], displayName: 'Guest', subjectType: 'user', consent: true, samples: [audio(1), audio(2), audio(3)], email: 'bad' }), /valid_email_required/);
    const guestProfile = await service.enroll({ ownerUserId: 'guest:tab-id', actorRoles: ['guest'], displayName: 'Guest', subjectType: 'user', consent: true, samples: [audio(1), audio(2), audio(3)], email: 'Guest@Example.com', deviceKey });
    assert.equal((await repository.list('guest:tab-id')).some(profile => profile.profileId === guestProfile.profileId), true, 'guest voice profiles remain available with no 24-hour expiry');
    assert.equal(guestProfile.contactEmailCiphertext, undefined);
    assert.equal(guestProfile.deviceKeyHash, undefined);
    assert.equal(service.decrypt(repository.rows.at(-1).contactEmailCiphertext), 'guest@example.com');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-guest-'));
    try {
      const persistent = new JsonBiometricIdentityRepository(path.join(dir, 'data.json'));
      await persistent.init();
      await persistent.create({ ...repository.rows.at(-1), createdAt: '2000-01-01T00:00:00.000Z' });
      const reopened = new JsonBiometricIdentityRepository(path.join(dir, 'data.json'));
      await reopened.init();
      assert.equal((await reopened.list('guest:tab-id')).length, 1, 'enrolled guest survives restart and 24 hours');
      const persistentProfile = (await reopened.list('guest:tab-id'))[0];
      const persistedUpdate = await reopened.updateTemplate(persistentProfile.profileId, 'guest:tab-id', { encryptedTemplate: 'updated-ciphertext', sampleCount: 6, expectedRevision: 1 });
      assert.equal(persistedUpdate.sampleCount, 6);
      assert.equal(persistedUpdate.templateRevision, 2, 'appending samples increments persistent template revision');
      assert.equal(await reopened.updateTemplate(persistentProfile.profileId, 'other-owner', { encryptedTemplate: 'wrong-owner', sampleCount: 9, expectedRevision: 2 }), null, 'owner isolation prevents cross-account profile updates');
      assert.equal(await reopened.updateTemplate(persistentProfile.profileId, 'guest:tab-id', { encryptedTemplate: 'stale-write', sampleCount: 9, expectedRevision: 1 }), null, 'stale template revisions cannot overwrite newer samples');
      assert.equal((await reopened.get(persistentProfile.profileId, 'guest:tab-id')).sampleCount, 6, 'new samples persist across repository reopen');
      assert.equal(await reopened.findGuestOwnerByDeviceKeyHash(crypto.createHash('sha256').update(deviceKey).digest('hex')), 'guest:tab-id');
      assert.equal(await reopened.isDeviceBoundGuestOwner('guest:tab-id'), true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    assert.ok(repository.rows[0].encryptedTemplate && !repository.rows[0].encryptedTemplate.includes('0.01'));
    const accepted = await service.verify({ ownerUserId: 'u1', audio: audio(4) });
    assert.equal(accepted.matched, true);
    const slightlyLoweredService = new BiometricIdentityService({
      repository, providerUrl: 'https://speaker.test', providerToken: 'test-only-token',
      encryptionKey: 'test-only-key', matchThreshold: 0.80, enrollmentThreshold: 0.76
    });
    const base = vector(2);
    const baseNorm = Math.sqrt(base.reduce((sum, value) => sum + value * value, 0));
    const unitBase = base.map(value => value / baseNorm);
    const axis = Array.from({ length: base.length }, (_, index) => index === 1 ? 1 : 0);
    const projection = axis.reduce((sum, value, index) => sum + value * unitBase[index], 0);
    const orthogonal = axis.map((value, index) => value - projection * unitBase[index]);
    const orthogonalNorm = Math.sqrt(orthogonal.reduce((sum, value) => sum + value * value, 0));
    const targetScore = 0.81;
    nextVector = unitBase.map((value, index) =>
      value * targetScore + (orthogonal[index] / orthogonalNorm) * Math.sqrt(1 - targetScore * targetScore)
    );
    const oldThresholdResult = await service.verify({ ownerUserId: 'u1', audio: audio(40) });
    assert.equal(oldThresholdResult.matched, false, 'a 0.81 match remains below the previous 0.82 threshold');
    const loweredThresholdResult = await slightlyLoweredService.verify({ ownerUserId: 'u1', audio: audio(41) });
    assert.equal(loweredThresholdResult.matched, true, 'a 0.81 match passes the small 0.80 staging adjustment');
    assert.ok(Math.abs(loweredThresholdResult.score - targetScore) < 0.001, 'test probe exercises the intended threshold boundary');
    nextVector = vector(20);
    const rejected = await service.verify({ ownerUserId: 'u1', audio: audio(5) });
    assert.equal(rejected.matched, false);
    const isolated = await service.verify({ ownerUserId: 'different-owner', audio: audio(6) });
    assert.equal(isolated.matched, false);
    const originalModuleLoad = Module._load;
    let authenticatedRequest = null;
    Module._load = function(request, parent, isMain) {
      if (request === 'google-auth-library') {
        return { GoogleAuth: class {
          async getIdTokenClient(audience) {
            assert.equal(audience, 'https://speaker.private.test', 'ID token audience must be the speaker service root URL');
            return { request: async options => {
              authenticatedRequest = options;
              return { data: { signalPresent: true, embedding: vector(7) } };
            } };
          }
        } };
      }
      return originalModuleLoad.call(this, request, parent, isMain);
    };
    try {
      const privateService = new BiometricIdentityService({ repository: new Repository(), providerUrl: 'https://speaker.private.test', encryptionKey: 'test-key' });
      const embedding = await privateService.extract(audio(7));
      assert.equal(embedding.length, 32);
      assert.equal(authenticatedRequest.url, 'https://speaker.private.test/embed');
      assert.equal(authenticatedRequest.method, 'POST');
      assert.deepEqual(authenticatedRequest.data, { audio: audio(7) });
      assert.equal(authenticatedRequest.timeout, 30000);
    } finally {
      Module._load = originalModuleLoad;
    }
    console.log('biometric voice identity tests passed');
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exit(1); });
