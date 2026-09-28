const crypto = require('crypto');
const { getDatabasePool } = require('./databasePool');
const { JsonStore } = require('../repositories/jsonStore');

function publicProfile(profile) {
  if (!profile) return null;
  const { encryptedTemplate, ...safe } = profile;
  return safe;
}

class JsonBiometricIdentityRepository {
  constructor(file) { this.store = new JsonStore(file); }
  async init() { this.store.update(data => { data.biometricVoiceProfiles ||= []; return data; }); }
  async create(profile) {
    const row = { ...profile, profileId: profile.profileId || crypto.randomUUID(), createdAt: profile.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.store.update(data => { data.biometricVoiceProfiles ||= []; data.biometricVoiceProfiles.push(row); return data; });
    return row;
  }
  async list(ownerUserId) { return (this.store.read().biometricVoiceProfiles || []).filter(row => row.ownerUserId === ownerUserId && row.status === 'active'); }
  async get(profileId, ownerUserId) { return (this.store.read().biometricVoiceProfiles || []).find(row => row.profileId === profileId && row.ownerUserId === ownerUserId) || null; }
  async remove(profileId, ownerUserId) {
    let removed = false;
    this.store.update(data => { const rows = data.biometricVoiceProfiles || []; removed = rows.some(row => row.profileId === profileId && row.ownerUserId === ownerUserId); data.biometricVoiceProfiles = rows.filter(row => row.profileId !== profileId || row.ownerUserId !== ownerUserId); return data; });
    return removed;
  }
}

class PostgresBiometricIdentityRepository {
  constructor(connectionString, sslMode = 'require') { this.pool = getDatabasePool({ connectionString, ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false } }); }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS panthorium_voice_profiles (
      profile_id UUID PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      subject_type TEXT NOT NULL CHECK (subject_type IN ('user','family','administrator')),
      relationship TEXT,
      encrypted_template TEXT NOT NULL,
      template_version INTEGER NOT NULL DEFAULT 1,
      sample_count INTEGER NOT NULL,
      consented_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ); CREATE INDEX IF NOT EXISTS idx_voice_profiles_owner ON panthorium_voice_profiles(owner_user_id,status);`);
  }
  map(row) { return row ? { profileId: row.profile_id, ownerUserId: row.owner_user_id, displayName: row.display_name, subjectType: row.subject_type, relationship: row.relationship, encryptedTemplate: row.encrypted_template, templateVersion: row.template_version, sampleCount: row.sample_count, consentedAt: row.consented_at?.toISOString?.() || row.consented_at, status: row.status, createdAt: row.created_at?.toISOString?.() || row.created_at, updatedAt: row.updated_at?.toISOString?.() || row.updated_at } : null; }
  async create(profile) { const { rows } = await this.pool.query(`INSERT INTO panthorium_voice_profiles(profile_id,owner_user_id,display_name,subject_type,relationship,encrypted_template,template_version,sample_count,consented_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING *`, [profile.profileId || crypto.randomUUID(), profile.ownerUserId, profile.displayName, profile.subjectType, profile.relationship || null, profile.encryptedTemplate, profile.templateVersion || 1, profile.sampleCount, profile.consentedAt]); return this.map(rows[0]); }
  async list(ownerUserId) { const { rows } = await this.pool.query(`SELECT * FROM panthorium_voice_profiles WHERE owner_user_id=$1 AND status='active' ORDER BY created_at`, [ownerUserId]); return rows.map(row => this.map(row)); }
  async get(profileId, ownerUserId) { const { rows } = await this.pool.query(`SELECT * FROM panthorium_voice_profiles WHERE profile_id=$1 AND owner_user_id=$2 LIMIT 1`, [profileId, ownerUserId]); return this.map(rows[0]); }
  async remove(profileId, ownerUserId) { const { rowCount } = await this.pool.query(`DELETE FROM panthorium_voice_profiles WHERE profile_id=$1 AND owner_user_id=$2`, [profileId, ownerUserId]); return rowCount > 0; }
}

function createBiometricIdentityRepository(config) {
  return config.databaseUrl ? new PostgresBiometricIdentityRepository(config.databaseUrl, config.databaseSslMode) : new JsonBiometricIdentityRepository(config.dataFile);
}

module.exports = { createBiometricIdentityRepository, JsonBiometricIdentityRepository, PostgresBiometricIdentityRepository, publicProfile };
