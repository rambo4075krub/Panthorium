const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BiometricIdentityService } = require('../services/biometricIdentityService');
const { JsonBiometricIdentityRepository } = require('../services/biometricIdentityRepository');

class Repository {
  constructor() { this.rows = []; }
  async init() {}
  async create(row) { const saved = { ...row, profileId: `p-${this.rows.length + 1}`, status: 'active' }; this.rows.push(saved); return saved; }
  async list(owner) { return this.rows.filter(row => row.ownerUserId === owner); }
  async remove(id, owner) { const before = this.rows.length; this.rows = this.rows.filter(row => row.profileId !== id || row.ownerUserId !== owner); return before !== this.rows.length; }
}

const audio = suffix => `data:audio/webm;base64,${'A'.repeat(4100)}${suffix}`;
const vector = seed => Array.from({ length: 32 }, (_, index) => (index === seed ? 1 : 0.01));

(async () => {
  const originalFetch = global.fetch;
  let nextVector = vector(2);
  global.fetch = async () => ({ ok: true, json: async () => ({ signalPresent: true, embedding: nextVector }) });
  try {
    const repository = new Repository();
    const service = new BiometricIdentityService({ repository, providerUrl: 'https://speaker.test', providerToken: 'test-only-token', encryptionKey: 'test-only-key', matchThreshold: 0.82, enrollmentThreshold: 0.76 });
    await service.init();
    await assert.rejects(() => service.enroll({ ownerUserId: 'u1', actorRoles: ['user'], displayName: 'Fake admin', subjectType: 'administrator', consent: true, samples: [audio(1), audio(2), audio(3)] }), /administrator_role_required/);
    const user = await service.enroll({ ownerUserId: 'u1', actorRoles: ['user'], displayName: 'Owner', subjectType: 'user', consent: true, samples: [audio(1), audio(2), audio(3)] });
    assert.equal(user.encryptedTemplate, undefined);
    const family = await service.enroll({ ownerUserId: 'u1', actorRoles: ['user'], displayName: 'Family', subjectType: 'family', relationship: 'parent', consent: true, samples: [audio(1), audio(2), audio(3)] });
    assert.equal(family.subjectType, 'family');
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
      assert.equal(await reopened.findGuestOwnerByDeviceKeyHash(crypto.createHash('sha256').update(deviceKey).digest('hex')), 'guest:tab-id');
      assert.equal(await reopened.isDeviceBoundGuestOwner('guest:tab-id'), true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    assert.ok(repository.rows[0].encryptedTemplate && !repository.rows[0].encryptedTemplate.includes('0.01'));
    const accepted = await service.verify({ ownerUserId: 'u1', audio: audio(4) });
    assert.equal(accepted.matched, true);
    nextVector = vector(20);
    const rejected = await service.verify({ ownerUserId: 'u1', audio: audio(5) });
    assert.equal(rejected.matched, false);
    const isolated = await service.verify({ ownerUserId: 'different-owner', audio: audio(6) });
    assert.equal(isolated.matched, false);
    console.log('biometric voice identity tests passed');
  } finally { global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exit(1); });
