'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {createProfileStore, windowsProtector} = require('../scripts/local-secret-store.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panthorium-secret-tests-'));
const key = crypto.randomBytes(32);
const protector = {
  restrict: p => fs.chmodSync(p, fs.statSync(p).isDirectory() ? 0o700 : 0o600),
  protect: plain => {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  },
  unprotect: value => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0,12));
    decipher.setAuthTag(value.subarray(12,28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
  }
};
const fresh = name => { const p=path.join(root,name);fs.mkdirSync(p);return p; };
const profile = () => ({username:'localadmin', password:crypto.randomBytes(24).toString('base64url'), jwtSecret:crypto.randomBytes(48).toString('base64url')});
function legacy(state, value) {
  fs.writeFileSync(path.join(state,'local-profile.json'), JSON.stringify(value));
  fs.writeFileSync(path.join(state,'LOCAL_LOGIN.txt'), 'Username: '+value.username+'\nPassword: '+value.password);
}
function assertProtected(state,value) {
  assert.equal(fs.existsSync(path.join(state,'local-profile.json')),false);
  assert.equal(fs.existsSync(path.join(state,'LOCAL_LOGIN.txt')),false);
  const disk=fs.readFileSync(path.join(state,'local-profile.dpapi'),'utf8');
  assert.equal(disk.includes(value.password),false);
  assert.equal(disk.includes(value.jwtSecret),false);
  assert.equal(disk.includes(Buffer.from(JSON.stringify(value)).toString('base64')),false);
  assert.deepEqual(fs.readdirSync(state),['local-profile.dpapi']);
}
try {
  const load=createProfileStore(protector);
  const state=fresh('migration'),old=profile();legacy(state,old);
  assert.deepEqual(load({statePath:state}),old,'migration preserves login and signing key');
  assertProtected(state,old);
  assert.deepEqual(load({statePath:state,create:false}),old,'restart decrypts existing profile');
  if(process.platform!=='win32') {
    assert.equal(fs.statSync(state).mode & 0o777,0o700);
    assert.equal(fs.statSync(path.join(state,'local-profile.dpapi')).mode & 0o777,0o600);
  }
  const created=fresh('new'),generated=load({statePath:created});assertProtected(created,generated);
  assert.notEqual(generated.password,old.password);
  const absent=fresh('absent');assert.throws(()=>load({statePath:absent,create:false}),/not_initialized/);
  assert.deepEqual(fs.readdirSync(absent),[]);

  const failed=fresh('failure'),original=profile();legacy(failed,original);
  const fail=createProfileStore({...protector,protect(){throw new Error('test_encryption_unavailable');}});
  assert.throws(()=>fail({statePath:failed}),/encryption_unavailable/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(failed,'local-profile.json'))),original);
  assert.equal(fs.existsSync(path.join(failed,'LOCAL_LOGIN.txt')),true);
  assert.equal(fs.existsSync(path.join(failed,'local-profile.dpapi')),false);

  const tampered=fresh('tampered'),before=load({statePath:tampered});
  const disk=path.join(tampered,'local-profile.dpapi'),parts=fs.readFileSync(disk,'utf8').split('\n');
  const ciphertext=Buffer.from(parts[1],'base64');ciphertext[ciphertext.length-1]^=1;
  fs.writeFileSync(disk,parts[0]+'\n'+ciphertext.toString('base64'));legacy(tampered,before);
  assert.throws(()=>load({statePath:tampered}),'corrupt ciphertext must not fall back to plaintext');
  assert.equal(fs.existsSync(path.join(tampered,'local-profile.json')),true);

  const conflict=fresh('conflict');load({statePath:conflict});legacy(conflict,profile());
  assert.throws(()=>load({statePath:conflict}),/migration_conflict/);
  assert.equal(fs.existsSync(path.join(conflict,'LOCAL_LOGIN.txt')),true);
  const invalid=fresh('invalid'),privateText=crypto.randomBytes(20).toString('hex');
  fs.writeFileSync(path.join(invalid,'local-profile.json'),'{'+privateText);
  assert.throws(()=>load({statePath:invalid}),e=>e.message==='local_profile_invalid'&&!e.message.includes(privateText));

  const held=fresh('locked');fs.writeFileSync(path.join(held,'local-profile.lock'),'');
  assert.throws(()=>load({statePath:held}),/busy_or_stale_lock/);
  if(process.platform!=='win32') {
    const target=fresh('outside'),symlink=path.join(root,'symlink');fs.symlinkSync(target,symlink,'dir');
    assert.throws(()=>load({statePath:symlink}),/unsafe_path/);
    const linked=fresh('linked'),secret=path.join(root,'outside-secret');fs.writeFileSync(secret,JSON.stringify(profile()));
    fs.linkSync(secret,path.join(linked,'local-profile.json'));
    assert.throws(()=>load({statePath:linked}),/unsafe_path/);
    assert.throws(()=>windowsProtector(),/requires_windows_dpapi/);
  }
  const show=spawnSync(process.execPath,[path.join(__dirname,'../scripts/local-credentials.cjs'),'show'],{encoding:'utf8'});
  assert.equal(show.status,1);assert.equal(show.stdout,'');assert.match(show.stderr,/require_interactive_terminal/);

  if(process.platform==='win32') {
    const native=createProfileStore(windowsProtector()),state=fresh('windows-dpapi'),original=profile();legacy(state,original);
    assert.deepEqual(native({statePath:state}),original);assertProtected(state,original);
    assert.deepEqual(native({statePath:state,create:false}),original);
    const target=path.join(state,'local-profile.dpapi'),data=fs.readFileSync(target,'utf8').split('\n');
    const bytes=Buffer.from(data[1],'base64');bytes[bytes.length-1]^=1;
    fs.writeFileSync(target,data[0]+'\n'+bytes.toString('base64'));
    assert.throws(()=>native({statePath:state}),/local_secret_operation_failed/);
    console.log('PASS native Windows DPAPI migration, restart, restricted ACLs and tamper rejection');
  }
  console.log('PASS local secret storage migration, no plaintext fallback, atomic failure, conflict, path and output protections');
} finally { fs.rmSync(root,{recursive:true,force:true});key.fill(0); }
